"""
Batch create directories and copy POSCAR + INCAR + KPOINTS + POTCAR + submit script.

Input: JSON file with list of tasks. Each task:
{
    "dir": "1-ABN/1-NO3",                       # target directory (required)
    "poscar_src": "struc/ABN/1-NO3.vasp",       # POSCAR source (required)
    "template": "TWIST/25-Surface_Nanorod",     # template dir: auto-fills INCAR/KPOINTS/POTCAR/submit script
    "incar_src": "TWIST/25/INCAR",              # INCAR source (overrides template)
    "kpoints_src": "TWIST/25/KPOINTS",          # KPOINTS source (overrides template)
    "potcar_src": "TWIST/25/POTCAR",            # POTCAR source (overrides template)
    "submit_src": "TWIST/25/submit.sh",        # submit script source (overrides template); "lqf_src" is a legacy alias
    "incar_overrides": {"ALGO": "Normal"},      # INCAR parameter replacements (adds missing tags)
    "free_atoms": [54, 55, 56, 57, 58],         # 1-indexed atoms to set T T T (everything else F F F)
    "fixed_atoms": [1, 2, 3]                    # 1-indexed atoms to set F F F (everything else T T T)
}

Rules:
- Selective-dynamics flags are NEVER inferred from element order. Give
  free_atoms (rest = F F F) or fixed_atoms (rest = T T T). If neither is given
  the task is reported as an error and no SD rewrite happens.
- Submit script detection in templates is generic (submit.sh / run.sh / job.sh,
  then *.slurm / *.sbatch / *.pbs). It keeps its original file name when copied;
  no particular name is treated as special.
- POTCAR element parsing is pseudopotential-family agnostic (PAW_PBE / PAW_GGA /
  US / OEPC ...) via the TITEL line; POSCAR-POTCAR match requires EQUAL length
  and order (VASP requirement).
- Coordinate type (Direct/Cartesian) of the source POSCAR is preserved; scale and
  lattice lines are kept verbatim.
- template paths may be absolute, or relative to the project root (cwd).

Usage: python scripts/batch_build_dirs.py [--dry-run] [--link] tasks.json
  --dry-run  preview everything without touching the filesystem
  --link     hard-link POTCAR from source/template instead of copying
"""
import os, sys, json, shutil, re
from datetime import datetime

# config
SUBMIT_SCRIPT_PRIORITY = ["submit.sh", "run.sh", "job.sh"]
SUBMIT_SCRIPT_EXTS = (".slurm", ".sbatch", ".pbs")
LOG_MAX_SIZE = 50 * 1024
TEMPLATE_COPY_FILES = ["INCAR", "KPOINTS", "POTCAR"]
SCALE_HINT_LINES = 5

# POSCAR parsing

def is_elem_token(t):
    """1-2 char element symbol: Fe, Cu, N, O, ..."""
    return len(t) <= 2 and t[0].isupper() and (len(t) == 1 or t[1].islower())


def is_flag(t):
    return t in ("T", "F")


def parse_poscar_header(lines):
    """Parse POSCAR header.

    Returns (elements, counts, elem_idx, counts_idx, sd_idx, coord_type,
    coord_start, error). coord_type is "Direct" or "Cartesian" (VASP default when
    the line is omitted). Never mistakes the scale factor (line 1) for counts:
    scanning starts after the 5 header lines and requires an element-name line
    before any counts line.
    """
    elements, counts = [], []
    elem_idx = counts_idx = None
    sd_idx = None
    coord_type = "Direct"
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
                coord_type = "Direct" if lower == "direct" else "Cartesian"
                coord_start = i + 1
                break
            coord_start = i
            break

    if not elements:
        return None, None, None, None, None, None, None, "POSCAR 头部解析失败：未找到元素名行"
    if not counts:
        return None, None, None, None, None, None, None, "POSCAR 头部解析失败：未找到元素计数行"
    if coord_start is None:
        coord_start = counts_idx + 1
    return (elements, counts, elem_idx, counts_idx, sd_idx, coord_type, coord_start, None)


def parse_coords(lines, coord_start, n_total):
    """Collect coordinate rows from coord_start.

    Each row may be 3 columns (no flags yet) or 6 columns (x y z fx fy fz).
    Returns (coords, error).
    """
    coords = []
    for line in lines[coord_start:]:
        stripped = line.strip()
        if not stripped:
            continue
        tokens = stripped.split()
        if len(tokens) < 3:
            continue
        try:
            float(tokens[0]); float(tokens[1]); float(tokens[2])
        except ValueError:
            continue
        if len(tokens) >= 6 and all(is_flag(t) for t in tokens[3:6]):
            coords.append((tokens[:3], tokens[3:6]))
        else:
            coords.append((tokens[:3], None))
        if len(coords) == n_total:
            break
    if len(coords) < n_total:
        return coords, "坐标解析失败：读取 %d，预期 %d" % (len(coords), n_total)
    return coords, None


def plan_flags(n_total, free_atoms, fixed_atoms):
    """Decide F/T per atom from EXPLICIT input only. Returns (flags, error)."""
    free = set(free_atoms or [])
    fixed = set(fixed_atoms or [])
    if not free and not fixed:
        return None, "必须显式指定 free_atoms（其余 F F F）或 fixed_atoms（其余 T T T），不按元素序推断"
    conflict = free & fixed
    if conflict:
        return None, "free_atoms 与 fixed_atoms 重叠：%s" % sorted(conflict)
    for idx in free | fixed:
        if idx < 1 or idx > n_total:
            return None, "原子序号越界：%d（任务共 %d 个原子，1-indexed）" % (idx, n_total)
    if free:
        flags = ["F   F   F"] * n_total
        for idx in free:
            flags[idx - 1] = "T   T   T"
    else:
        flags = ["T   T   T"] * n_total
        for idx in fixed:
            flags[idx - 1] = "F   F   F"
    return flags, None


def build_poscar_with_sd(src_path, free_atoms, fixed_atoms):
    """In-memory: parse source POSCAR and produce SD-annotated text.

    Preserves header (incl. scale), element order, coordinates and coordinate
    type verbatim; only adds/rewrites the flag column. Returns
    (new_text, meta, error); on error returns (None, None, error).
    """
    try:
        with open(src_path, "r", errors="ignore") as f:
            lines = f.read().splitlines(keepends=True)
    except OSError as e:
        return None, None, "无法读取 POSCAR：%s" % e

    (elements, counts, _ei, counts_idx, _sd, coord_type, coord_start, herr) = parse_poscar_header(lines)
    if herr:
        return None, None, herr

    n_total = sum(counts)
    coords, cerr = parse_coords(lines, coord_start, n_total)
    if cerr:
        return None, None, cerr

    flags, ferr = plan_flags(n_total, free_atoms, fixed_atoms)
    if ferr:
        return None, None, ferr

    head = "".join(lines[:counts_idx + 1])
    body = ["Selective dynamics\n", coord_type + "\n"]
    for (xyz, _old), flag in zip(coords, flags):
        body.append("  " + "  ".join(xyz) + "   " + flag + "\n")
    body.append("\n")

    meta = {
        "elements": elements,
        "counts": counts,
        "n_atoms": n_total,
        "coord_type": coord_type,
        "t_flags": sum(1 for f in flags if f == "T   T   T"),
        "f_flags": sum(1 for f in flags if f == "F   F   F"),
    }
    return head + "".join(body), meta, None


def poscar_elements_from_text(poscar_text):
    """Element symbols from POSCAR header text (already validated upstream)."""
    elements, counts, *_ = parse_poscar_header(poscar_text.splitlines())
    return elements, counts

# POTCAR parsing (family-agnostic, cached, header-first)

_potcar_cache = {}


def potcar_elements(path, expected=None):
    """Extract element symbols from POTCAR TITEL lines.

    Family-agnostic: the family token (PAW_PBE / PAW_GGA / US / OEPC ...) is
    ignored; suffixes like "_sv" are stripped. Cached by (path, size, mtime).
    Stops after 'expected' elements when given, so a giant POTCAR is not read
    past its header blocks.
    """
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (os.path.realpath(path), st.st_size, st.st_mtime_ns)
    if key in _potcar_cache:
        return _potcar_cache[key]
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
    _potcar_cache[key] = elems
    return elems


def check_poscar_potcar(pos_elems, pot_elems):
    """VASP requires POTCAR species order == POSCAR species order, EQUAL length."""
    if not pos_elems or not pot_elems:
        return "PARSE_ERROR"
    if len(pos_elems) != len(pot_elems):
        return "MISMATCH(长度): POSCAR=%s 共%d种 vs POTCAR=%s 共%d种" % (pos_elems, len(pos_elems), pot_elems, len(pot_elems))
    if pos_elems == pot_elems:
        return "OK"
    return "MISMATCH(顺序): POSCAR=%s vs POTCAR=%s" % (pos_elems, pot_elems)


# INCAR overrides

def apply_incar_overrides(incar_text, overrides):
    """Replace existing tags; ADD missing ones (a missing tag is a real config
    difference, not a no-op)."""
    for key, val in overrides.items():
        pattern = re.compile(r"(?m)^\s*" + re.escape(key) + r"\s*=\s*[^\r\n]*")
        if pattern.search(incar_text):
            incar_text = pattern.sub(lambda m: key + " = " + str(val), incar_text, count=1)
        else:
            incar_text += "\n" + key + " = " + str(val) + "\n"
    return incar_text


# submit-script detection

def find_submit_script(dirpath):
    """Find a submit script: priority exact names, then *.slurm / *.sbatch /
    *.pbs. Returns the file name or None. Nothing is hard-coded."""
    for name in SUBMIT_SCRIPT_PRIORITY:
        if os.path.isfile(os.path.join(dirpath, name)):
            return name
    try:
        names = sorted(os.listdir(dirpath))
    except OSError:
        return None
    for name in names:
        if name.lower().endswith(SUBMIT_SCRIPT_EXTS) and os.path.isfile(os.path.join(dirpath, name)):
            return name
    return None

def build_one_task(task, project, dry_run, use_link):
    """Returns (sources, summary, errors, warnings)."""
    errors, warnings = [], []
    sources = {}
    dir_path = os.path.join(project, task.get("dir", ""))

    if not task.get("dir"):
        errors.append("缺少必需字段: dir")

    # template
    template = task.get("template")
    if template and not os.path.isdir(template):
        errors.append("模板目录不存在: %s" % template)

    copies = {}  # dest name -> source path

    poscar_src = task.get("poscar_src")
    if not poscar_src:
        errors.append("缺少必需字段: poscar_src")
    elif not os.path.exists(poscar_src):
        errors.append("POSCAR 源文件不存在: %s" % poscar_src)
    else:
        copies["POSCAR"] = poscar_src

    # INCAR / KPOINTS / POTCAR: explicit _src > template auto-fill
    if template and os.path.isdir(template):
        for fname in TEMPLATE_COPY_FILES:
            key = fname.lower() + "_src"
            if key not in task:
                cand = os.path.join(template, fname)
                if os.path.isfile(cand):
                    task[key] = cand
    for fname in TEMPLATE_COPY_FILES:
        key = fname.lower() + "_src"
        src = task.get(key)
        if src and os.path.isfile(src):
            copies[fname] = src
        else:
            errors.append("%s 源不存在: %s" % (fname, src or "(未指定)"))

    # submit script: explicit submit_src (alias lqf_src) > template detection
    submit_src = task.get("submit_src") or task.get("lqf_src")
    if submit_src:
        if os.path.isfile(submit_src):
            copies[os.path.basename(submit_src)] = submit_src
        else:
            errors.append("提交脚本源不存在: %s" % submit_src)
    elif template and os.path.isdir(template):
        found = find_submit_script(template)
        if found:
            copies[found] = os.path.join(template, found)
        else:
            warnings.append("模板目录中未找到提交脚本（submit.sh/run.sh/job.sh/*.slurm/*.sbatch/*.pbs），未复制")

    # in-memory SD plan (works in dry-run AND real run)
    sd_meta, sd_error = None, None
    if copies.get("POSCAR"):
        new_text, sd_meta, sd_error = build_poscar_with_sd(
            copies["POSCAR"], task.get("free_atoms"), task.get("fixed_atoms"))
        if sd_error:
            errors.append("Selective dynamics: %s" % sd_error)

    # POTCAR-POSCAR match
    potcar_ok = "N/A"
    pos_elems = None
    poscar_path = copies.get("POSCAR")
    potcar_path = copies.get("POTCAR")
    if poscar_path and potcar_path:
        if sd_meta:
            pos_elems = sd_meta["elements"]
        else:
            try:
                with open(poscar_path, "r", errors="ignore") as f:
                    pos_elems, _ = poscar_elements_from_text(f.read())
            except OSError:
                pass
        fut = potcar_elements(potcar_path, expected=len(pos_elems) if pos_elems else None)
        if fut is None:
            errors.append("无法读取 POTCAR: %s" % potcar_path)
        else:
            result = check_poscar_potcar(pos_elems, fut)
            potcar_ok = result if result == "OK" else result
            if result != "OK":
                errors.append("POTCAR 不匹配: %s" % result)

    # apply (only when this task is sound; dry-run never writes)
    if not dry_run and not errors:
        os.makedirs(dir_path, exist_ok=True)
        for dest, src in copies.items():
            if dest == "POSCAR":
                with open(os.path.join(dir_path, "POSCAR"), "w", encoding="utf-8") as f:
                    f.write(new_text)
            elif dest == "POTCAR" and use_link:
                link = os.path.join(dir_path, "POTCAR")
                if os.path.exists(link):
                    os.remove(link)
                os.link(src, link)
            else:
                shutil.copy2(src, os.path.join(dir_path, dest))

        # INCAR overrides after copying
        if copies.get("INCAR") and task.get("incar_overrides"):
            incar_path = os.path.join(dir_path, "INCAR")
            with open(incar_path, "r", encoding="utf-8") as f:
                incar = f.read()
            with open(incar_path, "w", encoding="utf-8") as f:
                f.write(apply_incar_overrides(incar, task["incar_overrides"]))

    summary = {
        "sources": sources if dry_run else dict(copies),
        "sd": ("%dF, %dT (%s, %d atoms)"
               % (sd_meta["f_flags"], sd_meta["t_flags"], sd_meta["coord_type"], sd_meta["n_atoms"]))
              if sd_meta else (sd_error or "n/a"),
        "potcar": potcar_ok,
    }
    sources.update(copies)
    return sources, summary, errors, warnings

def main():
    dry_run = "--dry-run" in sys.argv
    use_link = "--link" in sys.argv
    args = [a for a in sys.argv[1:] if a not in ("--dry-run", "--link")]
    if len(args) < 1:
        print("Usage: python batch_build_dirs.py [--dry-run] [--link] tasks.json")
        sys.exit(1)

    tasks_file = args[0]
    with open(tasks_file, encoding="utf-8") as f:
        tasks = json.load(f)

    project = os.getcwd()

    if dry_run:
        print("=" * 60)
        print("DRY RUN MODE — no files will be created")
        print("=" * 60)
        print("Tasks file: %s" % tasks_file)
        print("Number of tasks: %d\n" % len(tasks))

    log_path = os.path.join(project, "structure_optimization.txt")
    log_lines = []
    log_lines.append("\n[%s]\n" % ("=" * 60))
    log_lines.append("[%s] Batch Build Dirs\n" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    log_lines.append("Tasks file: %s\n" % tasks_file)
    log_lines.append("Number of tasks: %d\n\n" % len(tasks))

    for i, task in enumerate(tasks):
        dir_name = task.get("dir", "")
        sources, summary, errors, warnings = build_one_task(task, project, dry_run, use_link)

        status = "OK" if not errors else "ERRORS: " + "; ".join(errors)
        if dry_run:
            print("  [%d/%d] %s: %s" % (i + 1, len(tasks), "WOULD CREATE" if not errors else "WOULD CREATE (WITH ERRORS)", dir_name))
            print("    Sources: %s" % json.dumps(sources, ensure_ascii=False))
            print("    SD plan: %s" % summary["sd"])
            print("    POTCAR-POSCAR: %s" % summary["potcar"])
            if warnings:
                print("    Warnings: %s" % "; ".join(warnings))
            if errors:
                print("    Errors: %s" % "; ".join(errors))
            print()
        else:
            log_lines.append("  Task %d: %s\n" % (i + 1, dir_name))
            log_lines.append("    Sources: %s\n" % json.dumps(sources, ensure_ascii=False))
            log_lines.append("    SD check: %s\n" % summary["sd"])
            log_lines.append("    POTCAR-POSCAR: %s\n" % summary["potcar"])
            if warnings:
                log_lines.append("    Warnings: %s\n" % "; ".join(warnings))
            log_lines.append("    Status: %s\n\n" % status)
            prefix = "WARN" if (warnings and not errors) else "OK" if not errors else "ERROR"
            print("[%d/%d] [%s] %s: %s" % (i + 1, len(tasks), prefix, dir_name, status))

    if dry_run:
        print("Dry run done. %d tasks would be processed." % len(tasks))
    else:
        mode = "a"
        if os.path.exists(log_path) and os.path.getsize(log_path) > LOG_MAX_SIZE:
            mode = "w"
        with open(log_path, mode, encoding="utf-8") as log:
            for line in log_lines:
                log.write(line)
        print("\nDone. %d tasks processed. Log: %s" % (len(tasks), log_path))


if __name__ == "__main__":
    main()
