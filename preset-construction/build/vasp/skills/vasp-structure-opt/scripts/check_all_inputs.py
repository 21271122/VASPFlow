"""
Comprehensive input file checker.
Usage: python scripts/check_all_inputs.py dir1 dir2 dir3 ...
Outputs: POSCAR-POTCAR match, SD/F-T flags, INCAR key params, KPOINTS summary.
"""
import os, sys, re

def check_poscar_potcar(d):
    """Check POSCAR-POTCAR element match."""
    poscar = os.path.join(d, "POSCAR")
    potcar = os.path.join(d, "POTCAR")
    if not os.path.exists(poscar):
        return "POSCAR_MISSING"
    if not os.path.exists(potcar):
        return "POTCAR_MISSING"

    with open(poscar) as f:
        plines = f.readlines()
    pos_elems = []
    for l in plines[1:8]:
        parts = l.split()
        if not parts: continue
        if parts[0] in ("Selective", "Direct", "Cartesian"): continue
        if all(len(p) <= 2 and p[0].isupper() for p in parts):
            pos_elems = parts; break

    pot_elems = []
    with open(potcar) as f:
        for l in f:
            if "TITEL" in l:
                pot_elems.append(l.split("PAW_PBE")[1].strip().split()[0].split("_")[0])

    n_pos = min(len(pos_elems), len(pot_elems))
    if n_pos == 0:
        return "PARSE_ERROR"
    if pos_elems[:n_pos] == pot_elems[:n_pos]:
        return "OK"
    return f"MISMATCH: POSCAR={pos_elems} POTCAR={pot_elems}"


def check_sd(d):
    """Check Selective dynamics and F/T flags."""
    poscar = os.path.join(d, "POSCAR")
    if not os.path.exists(poscar):
        return "POSCAR_MISSING"

    with open(poscar) as f:
        lines = f.readlines()

    sd_count = sum(1 for l in lines if l.strip() == "Selective dynamics")

    # Find Direct line
    hd = 0
    for i, l in enumerate(lines):
        if l.strip() in ("Direct", "Cartesian"):
            hd = i
            break

    coords = []
    for j in range(hd + 1, len(lines)):
        parts = lines[j].split()
        if len(parts) >= 6:
            coords.append(parts)
        elif len(parts) == 3:
            try:
                float(parts[0])
                coords.append(parts + ["F", "F", "F"])  # default to F F F
            except ValueError:
                pass

    f_cnt = sum(1 for c in coords if "F" in c[-3])
    t_cnt = sum(1 for c in coords if c[-3] == "T")
    total = len(coords)

    # Read expected counts from header
    expected = 0
    for l in lines[:hd]:
        parts = l.split()
        if parts and all(p.lstrip("-").isdigit() for p in parts):
            expected = sum(int(p) for p in parts)
            break

    issues = []
    if sd_count == 0:
        issues.append("NO_SD")
    elif sd_count > 1:
        issues.append(f"SD_DUP(x{sd_count})")
    if total != expected and expected > 0:
        issues.append(f"COUNT_MISMATCH({total} vs {expected})")

    status = "OK" if not issues else ", ".join(issues)
    return f"SDx{sd_count} {total}at({f_cnt}F,{t_cnt}T) [{status}]"


def check_incar(d):
    """Extract key INCAR parameters."""
    incar = os.path.join(d, "INCAR")
    if not os.path.exists(incar):
        return "INCAR_MISSING"

    key_params = ["SYSTEM", "ENCUT", "ALGO", "IBRION", "NSW", "ISIF",
                  "EDIFF", "EDIFFG", "POTIM", "ISPIN", "IVDW", "ISMEAR", "SIGMA",
                  "NELM", "NFREE", "LREAL", "LWAVE", "LCHARG", "NUPDOWN", "LORBIT", "NELM"]

    found = {}
    with open(incar) as f:
        for l in f:
            for k in key_params:
                if re.match(rf"^\s*{k}\s*=", l):
                    val = l.split("=")[-1].strip().split(";")[0].strip().split()[0].strip()
                    found[k] = val

    return found


def check_kpoints(d):
    """Read KPOINTS summary."""
    kpt = os.path.join(d, "KPOINTS")
    if not os.path.exists(kpt):
        return "KPOINTS_MISSING"

    with open(kpt) as f:
        lines = f.readlines()
    # Try to extract grid
    grid = "?"
    for i, l in enumerate(lines):
        parts = l.split()
        if len(parts) == 3 and i >= 3:
            try:
                int(parts[0])
                grid = f"{parts[0]}x{parts[1]}x{parts[2]}"
                break
            except ValueError:
                pass

    return f"Gamma {grid}" if "Gamma" in "".join(lines) else grid


def main():
    if len(sys.argv) < 2:
        print("Usage: python check_all_inputs.py dir1 [dir2 dir3 ...]")
        sys.exit(1)

    dirs = sys.argv[1:]
    print(f"Checking {len(dirs)} directories...\n")
    print(f"{'Directory':40s} {'POSCAR-POTCAR':>20s} {'SD':>25s} {'INCAR_keys':>30s} {'KPOINTS':>10s}")
    print("-" * 130)

    for d in dirs:
        if not os.path.isdir(d):
            print(f"{d:40s} {'NOT_FOUND':>20s}")
            continue

        pp = check_poscar_potcar(d)
        sd = check_sd(d)
        inc = check_incar(d)
        kpt = check_kpoints(d)

        inc_str = ""
        if isinstance(inc, dict):
            inc_str = "; ".join(f"{k}={v}" for k, v in sorted(inc.items())[:8])

        print(f"{d:40s} {pp:>20s} {sd:>25s} {inc_str:>30s} {kpt:>10s}")


if __name__ == "__main__":
    main()
