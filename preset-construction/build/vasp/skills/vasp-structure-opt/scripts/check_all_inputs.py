"""
Comprehensive input file checker.
Usage: python scripts/check_all_inputs.py dir1 dir2 dir3 ...
Outputs: POSCAR-POTCAR match, SD/F-T flags, INCAR key params, KPOINTS summary.

- POTCAR parsing is pseudopotential-family agnostic (PAW_PBE / PAW_GGA / US /
  OEPC ...) via the TITEL line; POSCAR-POTCAR match requires EQUAL length and
  order (VASP requirement: POTCAR species order must equal POSCAR order).
- Coordinates WITHOUT flags (3-column rows) are reported as FLAG_MISSING, never
  silently counted as "F F F".
- Each directory is checked independently: an exception in one directory is
  reported inline and does NOT abort the remaining checks.
"""
import os, sys, re

SCALE_HINT_LINES = 5


def is_elem_token(t):
    """1-2 char element symbol: Fe, Cu, N, O, ..."""
    return len(t) <= 2 and t[0].isupper() and (len(t) == 1 or t[1].islower())


def is_flag(t):
    return t in ("T", "F")


def parse_poscar_header(lines):
    """Returns (elements, counts, counts_idx, sd_idx, coord_start, error).
    Never mistakes the scale factor (line 1) for counts: scanning starts after
    the 5 header lines and requires an element-name line before any counts line.
    """
    elements, counts = [], []
    elem_idx = counts_idx = None
    sd_idx = None
    coord_start = None

    for i in range(SCALE_HINT_LINES, min(len(lines), 14)):
        line = lines[i].strip()
        if not line:
            continue
        tokens = line.split()
        if elem_idx is None and all(is_elem_token(t) for t in tokens):
            elements, elem_idx = tokens, i
            continue
        if elem_idx is not None and counts_idx is None and all(t.lstrip("-").isdigit() for t in tokens):
            nums = [int(t) for t in tokens]
            if sum(nums) > 0:
                counts, counts_idx = nums, i
                continue
        if elem_idx is not None and counts_idx is not None:
            lower = line.lower()
            if lower == "selective dynamics":
                sd_idx = i
                continue
            if lower in ("direct", "cartesian"):
                coord_start = i + 1
                break
            coord_start = i
            break

    if not elements:
        return None, None, None, None, None, "POSCAR 头部解析失败：未找到元素名行"
    if not counts:
        return None, None, None, None, None, "POSCAR 头部解析失败：未找到元素计数行"
    if coord_start is None:
        coord_start = counts_idx + 1
    return elements, counts, counts_idx, sd_idx, coord_start, None


def potcar_elements(path, expected=None):
    """Extract element symbols from POTCAR TITEL lines (family-agnostic;
    '_sv' style suffixes stripped). Stops after 'expected' elements."""
    elems = []
    titel = re.compile(r"^\s*TITEL\s*=\s*(\S+)\s+(\S+)")
    try:
        with open(path, "r", errors="ignore") as f:
            for line in f:
                m = titel.match(line)
                if m:
                    elems.append(m.group(2).split("_")[0])
                    if expected is not None and len(elems) >= expected:
                        break
    except OSError:
        return None
    return elems


def check_poscar_potcar(d):
    """POSCAR-POTCAR species match: EQUAL length AND order."""
    poscar = os.path.join(d, "POSCAR")
    potcar = os.path.join(d, "POTCAR")
    if not os.path.exists(poscar):
        return "POSCAR_MISSING"
    if not os.path.exists(potcar):
        return "POTCAR_MISSING"

    try:
        with open(poscar, "r", errors="ignore") as f:
            pos_lines = f.read().splitlines()
    except OSError:
        return "POSCAR_UNREADABLE"

    elements, counts, *_ = parse_poscar_header(pos_lines)
    if elements is None:
        return "POSCAR_PARSE_ERROR"
    if counts and sum(counts) == 0:
        return "POSCAR_PARSE_ERROR"

    pot_elems = potcar_elements(potcar, expected=len(elements))
    if pot_elems is None:
        return "POTCAR_UNREADABLE"
    if not pot_elems:
        return "POTCAR_NO_TITEL"

    if len(pot_elems) != len(elements):
        return "MISMATCH(长度): POSCAR=%s 共%d种 vs POTCAR=%s 共%d种" % (elements, len(elements), pot_elems, len(pot_elems))
    if pot_elems == elements:
        return "OK"
    return "MISMATCH(顺序): POSCAR=%s vs POTCAR=%s" % (elements, pot_elems)


def check_sd(d):
    """Check Selective dynamics and F/T flags. Coordinates without flag columns
    are reported as FLAG_MISSING, never silently counted as fixed."""
    poscar = os.path.join(d, "POSCAR")
    if not os.path.exists(poscar):
        return "POSCAR_MISSING"

    try:
        with open(poscar, "r", errors="ignore") as f:
            lines = f.read().splitlines()
    except OSError:
        return "POSCAR_UNREADABLE"

    sd_count = sum(1 for l in lines if l.strip() == "Selective dynamics")
    elements, counts, counts_idx, sd_idx, coord_start, herr = parse_poscar_header(lines)
    if herr:
        return "POSCAR_PARSE_ERROR(%s)" % herr
    expected = sum(counts)

    f_cnt = t_cnt = no_flag = 0
    coords = []
    for line in lines[coord_start:]:
        parts = line.split()
        if len(parts) >= 6:
            coords.append(parts)
        elif len(parts) == 3:
            try:
                float(parts[0]); float(parts[1]); float(parts[2])
            except ValueError:
                continue
            coords.append(parts)
            no_flag += 1
    for c in coords:
        if len(c) >= 6:
            if c[-3] == "F":
                f_cnt += 1
            elif c[-3] == "T":
                t_cnt += 1

    total = len(coords)
    issues = []
    if sd_count == 0:
        issues.append("NO_SD")
    elif sd_count > 1:
        issues.append("SD_DUP(x%d)" % sd_count)
    if total != expected:
        issues.append("COUNT_MISMATCH(%d vs %d)" % (total, expected))
    if sd_count > 0 and no_flag > 0:
        issues.append("FLAG_MISSING(%d)" % no_flag)

    status = "OK" if not issues else ", ".join(issues)
    return "SDx%d %dat(%dF,%dT%s) [%s]" % (sd_count, total, f_cnt, t_cnt, (",%dnoflag" % no_flag if no_flag else ""), status)


def check_incar(d):
    """Extract key INCAR parameters."""
    incar = os.path.join(d, "INCAR")
    if not os.path.exists(incar):
        return "INCAR_MISSING"

    key_params = ["SYSTEM", "ENCUT", "ALGO", "IBRION", "NSW", "ISIF",
                  "EDIFF", "EDIFFG", "POTIM", "ISPIN", "IVDW", "ISMEAR", "SIGMA",
                  "NELM", "NFREE", "LREAL", "LWAVE", "LCHARG", "NUPDOWN", "LORBIT"]
    found = {}
    try:
        with open(incar, "r", errors="ignore") as f:
            for l in f:
                for k in key_params:
                    if re.match(r"^\s*" + k + r"\s*=", l):
                        val = l.split("=")[-1].strip().split(";")[0].strip().split()[0].strip()
                        found[k] = val
    except OSError:
        return "INCAR_UNREADABLE"
    return found


def check_kpoints(d):
    """Read KPOINTS summary."""
    kpt = os.path.join(d, "KPOINTS")
    if not os.path.exists(kpt):
        return "KPOINTS_MISSING"
    try:
        with open(kpt, "r", errors="ignore") as f:
            lines = f.readlines()
    except OSError:
        return "KPOINTS_UNREADABLE"
    grid = "?"
    for i, l in enumerate(lines):
        parts = l.split()
        if len(parts) == 3 and i >= 3:
            try:
                int(parts[0])
                grid = "%sx%sx%s" % (parts[0], parts[1], parts[2])
                break
            except ValueError:
                pass
    return "Gamma %s" % grid if "Gamma" in "".join(lines) else grid


def main():
    if len(sys.argv) < 2:
        print("Usage: python check_all_inputs.py dir1 [dir2 dir3 ...]")
        sys.exit(1)

    dirs = sys.argv[1:]
    print("Checking %d directories...\n" % len(dirs))
    print("%-40s %-20s %-30s %-34s %-12s" % ("Directory", "POSCAR-POTCAR", "SD", "INCAR_keys", "KPOINTS"))
    print("-" * 140)

    for d in dirs:
        if not os.path.isdir(d):
            print("%-40s %-20s" % (d, "NOT_FOUND"))
            continue
        try:
            pp = check_poscar_potcar(d)
            sd = check_sd(d)
            inc = check_incar(d)
            kpt = check_kpoints(d)
        except Exception as e:  # noqa: BLE001  keep per-directory isolation
            print("%-40s %-20s CHECK_CRASH: %s" % (d, "?", e))
            continue

        inc_str = ""
        if isinstance(inc, dict):
            inc_str = "; ".join("%s=%s" % (k, v) for k, v in sorted(inc.items())[:8])
        print("%-40s %-20s %-30s %-34s %-12s" % (d, pp, sd, inc_str, kpt))


if __name__ == "__main__":
    main()
