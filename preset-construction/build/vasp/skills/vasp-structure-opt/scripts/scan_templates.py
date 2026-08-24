"""
Scan project directories for VASP input file templates.
Finds directories containing INCAR and extracts key parameters,
plus presence of KPOINTS, POTCAR, lqf.sh.
Usage: python scripts/scan_templates.py [target_dir] [max_depth]
"""
import os, sys, re

KEY_PARAMS = ["IBRION", "NSW", "ISIF", "ENCUT", "ALGO", "EDIFF", "EDIFFG",
              "ISPIN", "IVDW", "ISMEAR", "SIGMA", "NFREE", "POTIM", "NELM"]


def extract_incar_params(incar_path):
    """Read INCAR and return dict of key parameters."""
    params = {}
    with open(incar_path) as f:
        for line in f:
            for k in KEY_PARAMS:
                if re.match(rf"^\s*{k}\s*=", line):
                    val = line.split("=")[-1].split(";")[0].strip().split()[0]
                    params[k] = val
    return params


def check_files(d):
    """Return list of present input files in directory."""
    present = []
    for fname in ["INCAR", "KPOINTS", "POTCAR", "lqf.sh"]:
        if os.path.exists(os.path.join(d, fname)):
            present.append(fname)
    return present


def scan(root, max_depth):
    """Walk root directory up to max_depth, find directories with INCAR."""
    results = []
    for dirpath, dirnames, _ in os.walk(root):
        depth = dirpath.replace(root, "").count(os.sep)
        if depth > max_depth:
            dirnames.clear()
            continue
        incar_path = os.path.join(dirpath, "INCAR")
        if os.path.isfile(incar_path):
            files = check_files(dirpath)
            params = extract_incar_params(incar_path)
            results.append((dirpath, files, params))
    return results


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    max_depth = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    print(f"Scanning: {target} (max depth {max_depth})\n")
    results = scan(target, max_depth)

    if not results:
        print("No directories with INCAR found.")
        return

    # Build table
    rows = []
    for d, files, params in results:
        rel = os.path.relpath(d, target)
        ib = params.get("IBRION", "?")
        nsw = params.get("NSW", "?")
        algo = params.get("ALGO", "?")
        encut = params.get("ENCUT", "?")
        ispin = params.get("ISPIN", "?")
        files_str = "+".join(files) if len(files) == 4 else f"({' '.join(files)})"
        rows.append((rel, ib, nsw, algo, encut, ispin, files_str))

    # Format
    header = f"{'Directory':50s} {'IBRION':>6s} {'NSW':>4s} {'ALGO':>8s} {'ENCUT':>6s} {'ISPIN':>5s}  Files"
    sep = "-" * len(header)
    print(header)
    print(sep)
    for r in rows:
        print(f"{r[0]:50s} {r[1]:>6s} {r[2]:>4s} {r[3]:>8s} {r[4]:>6s} {r[5]:>5s}  {r[6]}")
    print()
    print(f"Found {len(results)} template directories.")

    # Highlight "complete" templates (all 4 files present)
    complete = [d for d, files, _ in results if len(files) == 4]
    if complete:
        print("\nComplete templates (INCAR+KPOINTS+POTCAR+lqf.sh):")
        for d in complete:
            rel = os.path.relpath(d, target)
            print(f"  {rel}")


if __name__ == "__main__":
    main()
