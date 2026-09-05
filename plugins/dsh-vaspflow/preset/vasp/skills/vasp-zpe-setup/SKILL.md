---
name: vasp-zpe-setup
description: 从当前目录的 VASP 弛豫计算结果，自动构建 ZPE（零点能）频率计算文件。扫描含 OUTCAR 的子目录，创建 ZPE/ 并行目录结构，复制 CONTCAR→POSCAR 并设置选择性动力学（基底原子固定 F F F，吸附物种放开 T T T），修改 INCAR 为频率计算参数（IBRION=5, NSW=1, NFREE=2, POTIM=0.015）。当用户提到"ZPE 计算"、"频率计算"、"振动计算"、"搭建 ZPE"、"零点能"时使用。
---

# VASP ZPE 计算文件搭建

## 核心原则

**先进入 Plan 模式全面勘察，四个节点逐一汇报确认，全部确认后，根据实际情况实时编写脚本并一次性执行。**

任何节点推断不出来，立即向用户提问，不猜测。

## 工作流总览

```
Plan 模式
  ├── 节点一 · 基底/吸附物种识别 → 确认
  ├── 节点二 · ZPE 目录结构     → 确认
  ├── 节点三 · 作业脚本识别     → 确认
  ├── 节点四 · INCAR 参数设定   → 确认
  └── 节点五 · 最终汇总         → 确认后退出 Plan
执行
  └── 根据确认结果实时编写 Python 脚本并运行
验证
  └── F/T 统计 + INCAR 抽查
```

## 阶段零 · 进入 Plan 模式

Skill 被调用后，**立即进入 Plan 模式**。所有勘察工作在 Plan 模式下进行，不修改任何文件。

---

## 节点一 · 基底与吸附物种识别

### 勘察

遍历所有结构，获取每个目录的 POSCAR/CONTCAR 头部：

```bash
find . -maxdepth 2 -name OUTCAR | sort

for d in $(find . -maxdepth 2 -name OUTCAR | sort | xargs dirname); do
    echo "=== $(basename "$d") ==="
    head -10 "$d/POSCAR" 2>/dev/null || head -10 "$d/CONTCAR" 2>/dev/null
    echo ""
done
```

### 推断规则

| 情况 | 行为 |
|------|------|
| 单一元素 | 推断为基底，**展示结果请用户确认** |
| 多元素，某元素数量占绝对多数（≥3:1 且 ≥10 个） | 推断该元素为基底，其余为吸附物种，**展示结果请用户确认** |
| 多元素，多个大量元素（如合金 Pt₃₆Pd₃₆） | **无法推断，逐元素提问** |
| 数量最多的元素 ≤20 个 | 体系较小，**逐元素确认** |
| 某目录无 POSCAR 也无 CONTCAR | 报告异常，请用户处理 |
| 无法解析头部 | 打印原始内容，请用户手工指定 |

### 汇报格式（严格遵循）

```
节点一 · 基底/吸附物种识别结果
──────────────────────────────────────────────────────────
目录        元素            原子数    序号范围      判定
──────────────────────────────────────────────────────────
0-Bi        Bi             72        #1 ~ #72      基底
──────────────────────────────────────────────────────────
1-_NO3      Bi             72        #1 ~ #72      基底
            N               1        #73           吸附物种
            O               3        #74 ~ #76     吸附物种
──────────────────────────────────────────────────────────
2-_NO3H     Bi             72        #1 ~ #72      基底
            N               1        #73           吸附物种
            O               3        #74 ~ #76     吸附物种
            H               1        #77           吸附物种
──────────────────────────────────────────────────────────
...
```

> **基底原子 → F F F（固定不动），吸附物种 → T T T（允许振动）**
> 以上划分是否正确？如需调整请指定。

如果某目录的元素构成与其他不同，在末尾醒目提醒。

---

## 节点二 · ZPE 目录结构

```
节点二 · ZPE 目录结构
────────────────────────────────
ZPE/
├── 0-Bi/
│   ├── INCAR          ← 复制自 0-Bi/INCAR（参数将修改）
│   ├── POTCAR         ← 复制自 0-Bi/POTCAR
│   ├── KPOINTS        ← 复制自 0-Bi/KPOINTS
│   ├── POSCAR         ← 复制自 0-Bi/CONTCAR（动力学标记将修改）
│   └── run.sh         ← 复制自 0-Bi/run.sh
├── 1-_NO3/
│   └── (同上结构)
├── ...
```

> WAVECAR、CHGCAR、OUTCAR 等大文件不复制。目录结构是否正确？

---

## 节点三 · 作业脚本识别

遍历源目录，查找 `.sh`、`.slurm` 结尾或 `run`、`submit`、`job` 开头的文件（提交脚本名不做任何预设）。

```
节点三 · 作业脚本识别
──────────────────────────────────────────────────────────
目录        找到的脚本
──────────────────────────────────────────────────────────
0-Bi        run.sh
1-_NO3      run.sh
2-_NO3H     run.sh, run_test.sh
...
──────────────────────────────────────────────────────────
未找到脚本的目录：（无） / 或列出
```

> 脚本将原样复制。有遗漏或不需要的？找不到任何脚本时不报错，只打印提示。

---

## 节点四 · INCAR 参数设定

读取第一个源目录的 INCAR，列出修改前后对照：

```
节点四 · INCAR 参数设定
──────────────────────────────────────────────────────────
参数          原始值      修改为      说明
──────────────────────────────────────────────────────────
IBRION       2           5           DFPT 频率计算
NSW          300         1           频率计算只需一步
NFREE        (不存在)    2           位移方向数（DFPT）
POTIM        0.5         0.015       离子步长
──────────────────────────────────────────────────────────
不变参数：ENCUT、ISMEAR、SIGMA、ISPIN、IVDW、ISIF …（全部原样保留）
```

> - IBRION=5 → DFPT；如需有限差分（IBRION=6）请现在指定，此时不设 NFREE
> - 以上参数是否正确？

---

## 节点五 · 最终确认

```
════════════════════════════════════════
  ZPE 计算文件搭建 — 最终确认
════════════════════════════════════════
  源目录数量：   N
  基底元素：     XX（M atoms）→ F F F
  吸附物种：     依各目录 POSCAR → T T T
  INCAR 方法：   IBRION=X, NFREE=X (或 有限差分)
  目标目录：     ./ZPE/
════════════════════════════════════════
  确认无误，开始执行？
```

用户确认后，退出 Plan 模式。

---

## 阶段六 · 执行

退出 Plan 模式后，根据勘察结果和用户确认的参数，**实时编写一个 Python 脚本**，保存为 `_zpe_setup.py` 并运行。

整体流程（顺序不可变）：

1. 遍历含 OUTCAR 的子目录（排除 ZPE 和隐藏目录）
2. 对每个源目录在 ZPE/ 下建同名子目录
3. 复制 INCAR、POTCAR、KPOINTS + 作业脚本
4. 复制 CONTCAR → POSCAR，然后解析并重写 POSCAR（添加 Selective dynamics 及 F/T 标记）
5. 修改 INCAR 的频率计算参数

### 硬性骨架代码

以下三段逻辑容易写错，**直接照搬，只替换占位符**。

#### POSCAR 头部解析

```python
def 解析头部(filepath):
    """返回 (元素列表, 数量列表, 元素行号, 坐标起始行号, 坐标类型)"""
    with open(filepath, "r") as f:
        lines = f.readlines()

    元素, 数量 = [], []
    elem_idx = count_idx = None
    coord_type = "Direct"

    for i in range(5, min(20, len(lines))):   # 从第6行开始扫描（跳过标题+缩放+3晶格）
        line = lines[i].strip()
        if not line:
            continue
        tokens = line.split()
        has_alpha = any(c.isalpha() for c in line)
        all_num = all(t.lstrip("-").replace(".","").replace("E","").replace("e","").replace("+","").isdigit() for t in tokens)
        if has_alpha and elem_idx is None:
            元素 = tokens; elem_idx = i
        elif all_num and elem_idx is not None and count_idx is None:
            数量 = [int(x) for x in tokens]; count_idx = i; break

    if elem_idx is None or count_idx is None:
        raise ValueError(f"POSCAR 头部解析失败：{filepath}")

    坐标开始 = count_idx + 1
    if 坐标开始 < len(lines) and "elective" in lines[坐标开始]:   # Selective dynamics 行
        坐标开始 += 1
    if 坐标开始 < len(lines):
        s = lines[坐标开始].strip()
        if s and s[0] in "Dd":
            coord_type = "Direct"; 坐标开始 += 1
        elif s and s[0] in "Cc":
            coord_type = "Cartesian"; 坐标开始 += 1

    return 元素, 数量, elem_idx, 坐标开始, coord_type
```

#### 坐标提取

```python
def 提取坐标(lines, start, n_total):
    """两轮扫描：第一轮严格，第二轮放宽，跳过明显非坐标行"""
    coords = []
    i = start
    for _ in range(2):   # 两轮
        while i < len(lines) and len(coords) < n_total:
            stripped = lines[i].strip()
            if stripped:
                tokens = stripped.split()
                if len(tokens) >= 3:
                    vals = tokens[:3]
                    # 跳过全零速度行（CONTCAR 尾部常见）
                    if vals == ["0.00000000E+00"] * 3:
                        i += 1; continue
                    try:
                        float(vals[0]); float(vals[1]); float(vals[2])
                        coords.append(vals)
                    except (ValueError, IndexError):
                        pass
            i += 1
    return coords
```

#### 分配 F/T 并重建 POSCAR

```python
基底集合 = {<用户确认的基底元素>}   # 如 {"Bi"} 或 {"Pt", "Pd"}

# 读原始 POSCAR
with open(poscar_path, "r") as f:
    all_lines = f.readlines()

元素, 数量, elem_idx, 坐标开始, coord_type = 解析头部(poscar_path)
n_total = sum(数量)
coords = 提取坐标(all_lines, 坐标开始, n_total)

if len(coords) != n_total:
    print(f"  ⚠ 坐标数不符：读取 {len(coords)}，预期 {n_total}")

# 重建：保留晶格信息 + 元素行 + 数量行 + Selective dynamics + 坐标类型 + 坐标+标记
new_lines = all_lines[:elem_idx]
new_lines.append("   " + "   ".join(元素) + "\n")
new_lines.append("   " + "   ".join(str(c) for c in 数量) + "\n")
new_lines.append("Selective dynamics\n")
new_lines.append(f"{coord_type}\n")

idx = 0
for el, cnt in zip(元素, 数量):
    flag = "F   F   F" if el in 基底集合 else "T   T   T"
    for _ in range(cnt):
        c = coords[idx] if idx < len(coords) else ["0.0", "0.0", "0.0"]
        new_lines.append(f"  {c[0]:>20s}  {c[1]:>20s}  {c[2]:>20s}   {flag}\n")
        idx += 1
new_lines.append("\n")

with open(poscar_path, "w") as f:
    f.writelines(new_lines)
```

#### INCAR 修改

```python
def 修改incar(path, ibrion, nsw, nfree, potim):
    """逐行匹配替换，NFREE 不存在时插入 NSW 之后"""
    with open(path, "r") as f:
        lines = f.readlines()

    new = []
    found = {"IBRION": False, "NSW": False, "NFREE": False, "POTIM": False}
    for line in lines:
        upper = line.strip().upper()
        if upper.startswith("IBRION"):
            new.append(f"IBRION = {ibrion}\n"); found["IBRION"] = True
        elif upper.startswith("NSW") and not upper.startswith("NSW_"):
            new.append(f"NSW = {nsw}\n"); found["NSW"] = True
        elif upper.startswith("NFREE"):
            new.append(f"NFREE = {nfree}\n"); found["NFREE"] = True
        elif upper.startswith("POTIM"):
            new.append(f"POTIM = {potim}\n"); found["POTIM"] = True
        else:
            new.append(line)

    if not found["NFREE"] and ibrion == 5:   # 仅 DFPT 需要 NFREE
        for i, line in enumerate(new):
            if line.strip().upper().startswith("NSW"):
                new.insert(i + 1, f"NFREE = {nfree}\n"); break
        else:
            new.append(f"NFREE = {nfree}\n")

    with open(path, "w") as f:
        f.writelines(new)
```

#### 作业脚本扫描

```python
def 找作业脚本(src):
    scripts = []
    for f in sorted(os.listdir(src)):
        fp = os.path.join(src, f)
        if not os.path.isfile(fp):
            continue
        if f.endswith((".sh", ".slurm")) or f.lower().startswith(("run", "submit", "job")):
            scripts.append(f)
    return scripts
```

### 其余逻辑

上述骨架以外的部分（遍历目录、复制文件、容错处理等）由 LLM 根据勘察结果自由编写，不设死板约束。唯一注意：CONTCAR 不存在时跳过该目录并报错，坐标数与预期不符时打印警告但继续。

运行脚本后立即进入验证。

---

## 阶段七 · 验证

```bash
# F/T 统计
for d in ZPE/*/; do
    dir=$(basename "$d")
    f=$(grep -c "F   F   F" "$d/POSCAR" 2>/dev/null || echo 0)
    t=$(grep -c "T   T   T" "$d/POSCAR" 2>/dev/null || echo 0)
    printf "%-15s  F F F=%-4s  T T T=%-4s\n" "$dir" "$f" "$t"
done

# INCAR 抽查
first=$(ls -d ZPE/*/ | head -1)
grep -E "^(IBRION|NSW|NFREE|POTIM)" "$first/INCAR"
```

标准：F F F = 基底原子数，T T T = 吸附原子数；INCAR 四个参数正确。验证通过后删除 `_zpe_setup.py`。
