---
name: vesta-view
description: 用 VESTA 打开 VASP 结构文件（POSCAR/CONTCAR），自动重命名使标签页显示体系名。当用户想用 VESTA 可视化、查看或对比 VASP 结构时使用——关键词包括"VESTA"、"打开结构"、"查看结构"、"打开 CONTCAR"、"打开 POSCAR"、"用 VESTA 打开"。
---

# VESTA 结构查看器

## 核心原则

根据用户意图决定打开哪些文件、扫描多深，不做预设。

## 工作流

### 1. 理解用户意图

问清楚用户想看什么，不要自作主张：
- 只看 CONTCAR、POSCAR，还是都要？
- 只看顶层目录，还是递归包含子目录？
- 是否需要过滤特定体系？

### 2. 递归扫描结构文件

根据用户指定的范围和文件类型扫描：

```bash
find . \( -name POSCAR -o -name CONTCAR \) | sort
```

根据需要加过滤条件，如排除 `.git`、`_temp_view` 等。

### 3. 定位 VESTA

常见路径供参考（不限于此，优先检查是否存在）：

```
E:\Physics\VESTA\VESTA-win64\VESTA-win64\VESTA.exe
C:\Program Files\VESTA\VESTA.exe
```

找不到就问用户。

### 4. 重命名并打开

**VESTA 的致命缺陷**：标签页显示的是文件名。如果两个文件都叫 `CONTCAR`，标签页无法区分。

关键代码：

```python
import os, shutil, subprocess

temp_dir = "_temp_view"
os.makedirs(temp_dir, exist_ok=True)

new_paths = []
for src_path, label in 待打开文件列表:
    # 路径中的 / 和 \ 替换为 _，构造唯一标签名
    safe_name = label.replace("/", "_").replace("\\", "_") + ".vasp"
    dst = os.path.join(temp_dir, safe_name)
    shutil.copy2(src_path, dst)
    new_paths.append(dst)

subprocess.Popen([vesta_path] + new_paths)
```

命名规则：用文件路径中的有意义信息构造标签名，例如：
- `ZPE/1-_NO3/POSCAR` → `1-_NO3_POSCAR.vasp`
- `ZPE/3-_NO2/disp_mode9/POSCAR` → `3-_NO2_disp_mode9_POSCAR.vasp`

### 5. 清理提示

提醒用户查看完毕可删除 `_temp_view/`。
