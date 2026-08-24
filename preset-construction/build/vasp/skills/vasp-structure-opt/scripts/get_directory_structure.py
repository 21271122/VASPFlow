"""
Get directory structure of the project.
Usage: python scripts/get_directory_structure.py [base_dir] [max_depth]
Output: prints tree to stdout and appends to structure_optimization.txt
"""
import os, sys
from datetime import datetime

def tree(d, prefix="", max_depth=3, current_depth=0):
    if current_depth > max_depth:
        return ""
    result = ""
    try:
        items = sorted(os.listdir(d))
    except PermissionError:
        return prefix + "[denied]\n"
    dirs = [i for i in items if os.path.isdir(os.path.join(d, i)) and not i.startswith(".")]
    files = [i for i in items if os.path.isfile(os.path.join(d, i)) and not i.startswith(".")]
    for i, name in enumerate(dirs):
        is_last = (i == len(dirs) - 1) and (len(files) == 0)
        result += prefix + ("└── " if is_last else "├── ") + name + "/\n"
        result += tree(os.path.join(d, name),
                       prefix + ("    " if is_last else "│   "),
                       max_depth, current_depth + 1)
    for i, name in enumerate(files):
        is_last = i == len(files) - 1
        result += prefix + ("└── " if is_last else "├── ") + name + "\n"
    return result

def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    depth = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    output = tree(base, max_depth=depth)
    print(output)

    # Append to structure_optimization.txt with size check
    log_path = os.path.join(os.getcwd(), "structure_optimization.txt")
    max_size = 50 * 1024  # 50KB threshold
    mode = "a"
    if os.path.exists(log_path) and os.path.getsize(log_path) > max_size:
        mode = "w"
    with open(log_path, mode) as f:
        f.write(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Directory Structure ({base})\n")
        f.write(output)
        f.write("\n")

if __name__ == "__main__":
    main()
