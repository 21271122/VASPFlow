---
name: vasp-structure-opt
description: VASP 结构优化输入文件构建。批量创建目录、复制 POSCAR/INCAR/KPOINTS/POTCAR/lqf.sh、修复 Selective dynamics、验证输入正确性。当用户提到"构建输入文件"、"生成结构优化"、"建目录"、"搭INCAR"、"构造fix"、"批量建任务"、"结构优化输入"时使用。
---

# VASP 结构优化输入文件构建

## 核心原则

- **动前必查**：复制或修改文件前，先 `head -10`/`tail -5` 确认是否已有 Selective dynamics、元素列表。
- **脚本后必核**：所有批量操作完成后，跑 `check_all_inputs.py` 逐个验证并打印给用户。
- **遇错不停**：某个任务构建出错时继续处理后续任务，错误信息写入 `structure_optimization.txt`。

## 工作流

### 1. 了解现状

```bash
python scripts/get_directory_structure.py <target_dir> 3
```

### 2. 规划目录

按 AGENTS.md 目录规则确定目录名和位置。用 `scan_templates.py` 扫描项目中可用的模板目录：

```bash
python scripts/scan_templates.py <target_dir> 3
```

输出每个含 INCAR 的目录的关键参数（IBRION, NSW, ALGO, ENCUT, ISPIN）和已有文件列表，末尾列出"完整模板"（INCAR+KPOINTS+POTCAR+lqf.sh 四文件齐全）。

### 3. 构建 JSON 任务文件

写入 `_tasks_batch.json`。推荐用 `template` 字段，大部分任务共享同一套模板：

```json
[
  {
    "dir": "1-ABN/1-NO3",
    "poscar_src": "struc/ABN/1-NO3.vasp",
    "template": "E:/Physics/.../TWIST/25-Surface_Nanorod_610_14nm-NO",
    "incar_overrides": {"SYSTEM": "ABN_1-NO3", "ALGO": "Normal"},
    "free_atoms": [55, 56, 57, 58]
  }
]
```

`template` 指向一个含 INCAR/KPOINTS/POTCAR/lqf.sh 的目录，脚本自动从该目录取这 4 个文件。单个任务如需覆盖某个文件，可同时指定对应的 `_src` 字段。

| 字段 | 必须 | 说明 |
|------|------|------|
| `dir` | 是 | 目标目录相对路径 |
| `poscar_src` | 是 | POSCAR 源文件路径 |
| `template` | 否 | 模板目录路径，自动从中取 INCAR/KPOINTS/POTCAR/lqf.sh |
| `incar_src` | 注 | INCAR 源文件路径，覆盖 template |
| `kpoints_src` | 注 | KPOINTS 源路径，覆盖 template |
| `potcar_src` | 注 | POTCAR 源路径，覆盖 template |
| `lqf_src` | 注 | 提交脚本路径，覆盖 template |
| `incar_overrides` | 否 | INCAR 参数替换，如 `{"ALGO": "Normal", "EDIFF": "1E-5"}` |
| `free_atoms` | 否 | 1-indexed，指定放开的原子序号。默认第一个元素类型之后的原子全部 T T T |

> 注：若未指定 `template`，则 `incar_src`、`kpoints_src`、`potcar_src`、`lqf_src` 四个字段均为必须，缺失则报错。

### 4. 执行批量构建

先用 `--dry-run` 预览，确认无误后再正式执行：

```bash
python scripts/batch_build_dirs.py --dry-run _tasks_batch.json
python scripts/batch_build_dirs.py _tasks_batch.json
```

自动完成：建目录 → 复制 5 个文件 → 修复 SD（去重 + 补 F/T 标记）→ 验证 POTCAR-POSCAR 匹配 → 写入 `structure_optimization.txt`。

### 5. 验证

```bash
python scripts/check_all_inputs.py <dir1> <dir2> ...
```

打印四列：POSCAR-POTCAR 匹配 / SD+F/T / INCAR 关键参数 / KPOINTS。有错误逐一修。

### 6. 汇报

读 `structure_optimization.txt`，以表格输出：

| 构建的目录 | 输入文件来源 | 错误检查情况 | 错误修正方法 |

## 脚本说明

所有脚本位于 `scripts/`，从目标项目根目录执行。

- **`get_directory_structure.py`** — `python scripts/get_directory_structure.py [dir] [depth]`
- **`scan_templates.py`** — `python scripts/scan_templates.py [dir] [depth]`，扫描项目中的 VASP 输入文件模板
- **`batch_build_dirs.py`** — `python scripts/batch_build_dirs.py [--dry-run] tasks.json`
- **`check_all_inputs.py`** — `python scripts/check_all_inputs.py dir1 dir2 ...`

## 常见错误速查

| 症状 | 原因 | 修复 |
|------|------|------|
| SD 行 = 2 | CONTCAR 已有 SD，脚本又加 | 脚本已自动去重；手动用 sed -i '9d' |
| 吸附物全标 F | atom_idx 计算错 | 用 `atom_idx += 1` 简单计数 |
| INCAR 参数不对 | 忘替换模板值 | 用 `incar_overrides` |
| 零值坐标多余 | 源 POSCAR 尾有 0 0 0 占位 | 只保留 counts 行 |
