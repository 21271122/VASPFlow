"""
Batch create directories and copy POSCAR + INCAR + KPOINTS + POTCAR + lqf.sh.
Input: JSON file with list of tasks.
Each task: {
    "dir": "1-ABN/1-NO3",                     # target directory (required)
    "poscar_src": "struc/ABN/1-NO3.vasp",        # POSCAR source (required)
    "template": "TWIST/25-Surface_Nanorod_...",   # template dir for INCAR/KPOINTS/POTCAR/lqf.sh
    "incar_src": "TWIST/25/INCAR",               # INCAR source (overrides template)
    "kpoints_src": "TWIST/25/KPOINTS",           # KPOINTS source (overrides template)
    "potcar_src": "TWIST/25/POTCAR",             # POTCAR source (overrides template)
    "lqf_src": "TWIST/25/lqf.sh",                # lqf.sh source (overrides template)
    "incar_overrides": {"ALGO": "Normal"},       # INCAR parameter replacements
    "free_atoms": [54, 55, 56, 57, 58]          # 1-indexed atoms to set T T T
}
If "template" is set, INCAR/KPOINTS/POTCAR/lqf.sh are auto-resolved from that directory.
Individual "_src" fields override the template.
Usage: python scripts/batch_build_dirs.py [--dry-run] tasks.json
"""
import os, sys, json, shutil
from datetime import datetime

def parse_vasp_counts(poscar_path):
    """Extract element counts from POSCAR/VASP file."""
    with open(poscar_path) as f:
        lines = f.readlines()
    for i, l in enumerate(lines):
        parts = l.split()
        if parts and all(p.lstrip("-").isdigit() for p in parts):
            counts = [int(p) for p in parts]
            if sum(counts) > 0:
                return i, counts  # return line index and counts
    return 0, []

def fix_selective_dynamics(poscar_path, counts, free_atoms):
    """Rewrite POSCAR with correct Selective dynamics and F/T flags.
    free_atoms: list of 1-indexed atom indices to set T T T.
    Atoms of the first element type are F F F by default (substrate),
    all subsequent atoms are T T T unless free_atoms is specified.
    """
    with open(poscar_path) as f:
        lines = f.readlines()
    while lines and lines[-1].strip() == "":
        lines.pop()

    # Find header end (Direct/Cartesian line)
    hd = 0
    for i, l in enumerate(lines):
        if l.strip() in ("Direct", "Cartesian"):
            hd = i
            break

    substrate_count = counts[0] if counts else 0
    total = sum(counts)

    new_lines = []
    for i in range(hd):
        new_lines.append(lines[i])
    new_lines.append("Selective dynamics\n")
    new_lines.append("Direct\n")

    for j in range(hd + 1, hd + 1 + total):
        parts = lines[j].split()
        x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
        atom_idx = j - hd  # 1-indexed
        if atom_idx in free_atoms or atom_idx > substrate_count:
            flag = "T   T   T"
        else:
            flag = "F   F   F"
        new_lines.append(f"  {x:20.14f}  {y:20.14f}  {z:20.14f}   {flag}\n")
    new_lines.append("\n")

    # Remove duplicate Selective dynamics
    final = []
    for l in new_lines:
        if l.strip() == "Selective dynamics" and final and final[-1].strip() == "Selective dynamics":
            continue
        final.append(l)

    with open(poscar_path, "w") as f:
        f.writelines(final)

    # Verify
    with open(poscar_path) as f:
        check_lines = f.readlines()
    sd_count = sum(1 for l in check_lines if l.strip() == "Selective dynamics")
    in_d = False
    coords = []
    for l in check_lines:
        if l.strip() == "Direct":
            in_d = True
            continue
        if in_d and len(l.split()) >= 6:
            coords.append(l)
    f_cnt = sum(1 for l in coords if "F" in l.split()[-3])
    t_cnt = sum(1 for l in coords if l.split()[-3] == "T")
    return sd_count, len(coords), f_cnt, t_cnt


def main():
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if len(args) < 1:
        print("Usage: python batch_build_dirs.py [--dry-run] tasks.json")
        sys.exit(1)

    tasks_file = args[0]
    with open(tasks_file) as f:
        tasks = json.load(f)

    project = os.getcwd()
    max_size = 50 * 1024

    if dry_run:
        print("=" * 60)
        print("DRY RUN MODE — no files will be created")
        print("=" * 60)
        print(f"Tasks file: {tasks_file}")
        print(f"Number of tasks: {len(tasks)}\n")

    log_path = os.path.join(project, "structure_optimization.txt")
    log_lines = []
    log_lines.append(f"\n[{'='*60}]\n")
    log_lines.append(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Batch Build Dirs\n")
    log_lines.append(f"Tasks file: {tasks_file}\n")
    log_lines.append(f"Number of tasks: {len(tasks)}\n\n")

    for i, task in enumerate(tasks):
        dir_name = task["dir"]
        dir_path = os.path.join(project, dir_name)

        errors = []
        sources = {}

        # Resolve template directory
        template = task.get("template")
        if template:
            if not os.path.isdir(template):
                errors.append(f"Template directory not found: {template}")
            else:
                sources["template"] = template
                for key, fname in [("incar_src", "INCAR"), ("kpoints_src", "KPOINTS"),
                                   ("potcar_src", "POTCAR"), ("lqf_src", "lqf.sh")]:
                    if key not in task:
                        src = os.path.join(template, fname)
                        if os.path.exists(src):
                            task[key] = src

        if not dry_run:
            os.makedirs(dir_path, exist_ok=True)

        # POSCAR
        if "poscar_src" not in task:
            errors.append("POSCAR source not specified (poscar_src is required)")
        else:
            src = task["poscar_src"]
            if os.path.exists(src):
                if not dry_run:
                    shutil.copy2(src, os.path.join(dir_path, "POSCAR"))
                sources["POSCAR"] = src
            else:
                errors.append(f"POSCAR source not found: {src}")

        # INCAR
        incar_src = task.get("incar_src")
        if incar_src and os.path.exists(incar_src):
            if not dry_run:
                shutil.copy2(incar_src, os.path.join(dir_path, "INCAR"))
            sources["INCAR"] = incar_src
            overrides = task.get("incar_overrides", {})
            if overrides:
                if not dry_run:
                    with open(os.path.join(dir_path, "INCAR")) as f:
                        incar = f.read()
                    for key, val in overrides.items():
                        import re
                        incar = re.sub(rf"^{key}\s*=\s*\S+", f"{key} = {val}", incar, flags=re.MULTILINE)
                    with open(os.path.join(dir_path, "INCAR"), "w") as f:
                        f.write(incar)
                sources["INCAR_overrides"] = overrides
        else:
            errors.append(f"INCAR source not found: {incar_src}")

        # KPOINTS
        kpt_src = task.get("kpoints_src")
        if kpt_src and os.path.exists(kpt_src):
            if not dry_run:
                shutil.copy2(kpt_src, os.path.join(dir_path, "KPOINTS"))
            sources["KPOINTS"] = kpt_src
        else:
            errors.append(f"KPOINTS source not found: {kpt_src}")

        # POTCAR
        if "potcar_src" in task and os.path.exists(task["potcar_src"]):
            if not dry_run:
                shutil.copy2(task["potcar_src"], os.path.join(dir_path, "POTCAR"))
            sources["POTCAR"] = task["potcar_src"]
        else:
            errors.append(f"POTCAR source not found: {task.get('potcar_src', 'not specified')}")

        # lqf.sh
        lqf_src = task.get("lqf_src")
        if lqf_src and os.path.exists(lqf_src):
            if not dry_run:
                shutil.copy2(lqf_src, os.path.join(dir_path, "lqf.sh"))
            sources["lqf.sh"] = lqf_src
        else:
            errors.append(f"lqf.sh source not found: {lqf_src}")

        # Fix Selective dynamics (only when POSCAR exists and not dry run)
        sd, n, f, t = 0, 0, 0, 0
        poscar_path = os.path.join(dir_path, "POSCAR")
        if not dry_run and os.path.exists(poscar_path):
            _, counts = parse_vasp_counts(poscar_path)
            free_atoms = task.get("free_atoms", [])
            if not free_atoms and counts:
                free_atoms = list(range(counts[0] + 1, sum(counts) + 1))
            sd, n, f, t = fix_selective_dynamics(poscar_path, counts, free_atoms)

        # Verify POTCAR-POSCAR match
        potcar_ok = "N/A"
        potcar_path = os.path.join(dir_path, "POTCAR")
        if os.path.exists(potcar_path) and os.path.exists(poscar_path):
            with open(poscar_path) as pf:
                plines = pf.readlines()
            pos_elems = []
            for l in plines[1:8]:
                parts = l.split()
                if not parts:
                    continue
                if parts[0] in ("Selective", "Direct", "Cartesian"):
                    continue
                if all(len(p) <= 2 and p[0].isupper() for p in parts):
                    pos_elems = parts
                    break
            pot_elems = []
            with open(potcar_path) as pf:
                for l in pf:
                    if "TITEL" in l:
                        pot_elems.append(l.split("PAW_PBE")[1].strip().split()[0].split("_")[0])
            if pos_elems[:len(pot_elems)] == pot_elems:
                potcar_ok = "OK"
            else:
                pot_elems_correct = f"POSCAR: {pos_elems[:len(pot_elems)]} vs POTCAR: {pot_elems}"
                errors.append(f"POTCAR mismatch: {pot_elems_correct}")
                potcar_ok = pot_elems_correct

        # Log / Print
        status = "OK" if not errors else "ERRORS: " + "; ".join(errors)
        if dry_run:
            prefix = "WOULD CREATE" if not errors else "WOULD CREATE (WITH ERRORS)"
            print(f"  [{i+1}/{len(tasks)}] {prefix}: {dir_name}")
            print(f"    Sources: {json.dumps(sources)}")
            if errors:
                print(f"    Errors: {'; '.join(errors)}")
            print()
        else:
            log_lines.append(f"  Task {i+1}: {dir_name}\n")
            log_lines.append(f"    Sources: {json.dumps(sources)}\n")
            log_lines.append(f"    SD check: {sd} SD lines, {n} atoms ({f}F, {t}T)\n")
            log_lines.append(f"    POTCAR-POSCAR: {potcar_ok}\n")
            log_lines.append(f"    Status: {status}\n\n")
            print(f"[{i+1}/{len(tasks)}] {dir_name}: {status}")

    if dry_run:
        print(f"Dry run done. {len(tasks)} tasks would be processed.")
    else:
        mode = "a"
        if os.path.exists(log_path) and os.path.getsize(log_path) > max_size:
            mode = "w"
        with open(log_path, mode) as log:
            for line in log_lines:
                log.write(line)
        print(f"\nDone. {len(tasks)} tasks processed. Log: {log_path}")


if __name__ == "__main__":
    main()
