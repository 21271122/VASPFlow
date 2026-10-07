# 查看计算数据：工具契约与结果卡片

对应演示：[两次独立调用的卡片](vaspflow-compare-results-card-demo.html)。`vasp_collect_results` 与正式卡片已接入插件；演示数值为虚构数据，不可用于科研。

## 设计边界

**一次调用只处理一种计算类别和一组该类别支持的指标，任务范围可以由多个来源合并。** 例如用户同时问弛豫能量和 ZPE，模型调用两次 `vasp_collect_results`，聊天区出现两张结果卡片。卡片没有“弛豫 / 频率”切换器；换类别、改变任务范围或热力学温度都需要新的工具调用。

“查看计算数据”只整理原始结果，不自动给跨任务能量差或优劣排名。比较或计算派生量需要后续请求与可比性检查。

## LLM 工具输入

工具名：`vasp_collect_results`。`rootPath` 是绝对工作目录。`scope.subtrees` 批量寻找父目录及指定层数内的任务；`scope.taskPaths` 精确指定任务。两者可同时给出，取并集并按规范化任务路径去重。路径均相对 `rootPath`，`.` 表示根目录。传入单个 `taskPaths` 路径时**只查该任务本身**，不会隐含查其子目录。

```ts
type CollectResultsInput = {
  rootPath: string;
  scope: {
    subtrees?: Array<{ relPath: string; maxDepth: number }>;
    taskPaths?: string[];
  }; // 至少有一个非空列表；结果按任务路径去重
  calculationType: 'RELAXATION' | 'FREQUENCY_ZPE';
  metrics: string[];                     // 只能选该类别已注册的指标
  conditions?: { temperatureK?: number }; // 请求热力学指标时必填，> 0
};
```

**弛豫查询：**

```json
{
  "rootPath": "D:\\Projects\\VASPFlow\\test",
  "scope": { "subtrees": [{ "relPath": "1-NO3", "maxDepth": 2 }], "taskPaths": ["2-NO/relax"] },
  "calculationType": "RELAXATION",
  "metrics": ["last_ionic_free_energy", "last_max_force", "ionic_steps"]
}
```

**频率 / ZPE 查询：**

```json
{
  "rootPath": "D:\\Projects\\VASPFlow\\test",
  "scope": { "subtrees": [{ "relPath": "1-NO3", "maxDepth": 1 }], "taskPaths": ["2-NO/ZPE"] },
  "calculationType": "FREQUENCY_ZPE",
  "metrics": ["frequencies", "zpe", "vibrational_entropy", "vibrational_free_energy"],
  "conditions": { "temperatureK": 298.15 }
}
```

**深度按目录边数计算：** `maxDepth: 0` 只纳入 `relPath` 自身（若它是任务）；`1` 可纳入它的直接子目录任务；`2` 再下一层。深度必须显式给出，限制在 0–20；不使用隐含的“无限递归”。每个父目录可选自己的深度。多个父目录与精确任务路径交叉命中同一任务时只返回一行，并在结果中记录来源选择器。批量结果设上限（建议 200 个），超过上限报“范围过大”，要求模型缩小范围，不能静默截断。

只查看一个任务时，传 `"scope": { "taskPaths": ["1-NO3/relax"] }`；这不会读取 `1-NO3/relax` 下的任何子任务。要包含子任务，必须显式改用 `subtrees` 并指定 `maxDepth`。两种选择器同时存在时按并集处理。

| 类别 | 指标 ID | 含义和单位 |
| --- | --- | --- |
| `RELAXATION` | `last_ionic_free_energy` | 末离子步 OSZICAR `F=`，eV；不得与 `E0` 混称 |
| `RELAXATION` | `last_max_force` | 末步实测最大原子力，eV/Å |
| `RELAXATION` | `ionic_steps` | 有效离子步数，步 |
| `FREQUENCY_ZPE` | `frequencies` | 逐模式频率及实频/虚频分类，cm⁻¹ |
| `FREQUENCY_ZPE` | `zpe` | 纳入的实频模式零点能，eV |
| `FREQUENCY_ZPE` | `vibrational_entropy` | 指定温度下振动熵 `S_vib(T)`，eV/K |
| `FREQUENCY_ZPE` | `vibrational_free_energy` | 指定温度下振动自由能项 `F_vib(T)`，eV |

未来增加 `STATIC_SCF` 等类别时，先登记该类别和指标解析器，再扩展枚举。不能传混合类别、任意正则表达式或脚本让工具猜测数据。未知类别、跨类别指标、缺少必需温度及越出根目录的路径应返回明确的参数错误。

## 工具输出

返回**结构化全量结果**供 UI 渲染，另给模型一段简短摘要。每个指标携带单位、来源与有效性；缺失/无效时 `value: null`，绝不补零。模式列表可随任务详情返回；任务多时需分页或用 `resultId` 按需取详情，不能截断后仍宣称完整。

```ts
type CollectResultsOutput = {
  query: CollectResultsInput;            // 原样回显类别、范围、指标、温度
  summary: {
    discovered: number; included: number; excluded: number;
    complete: number; partial: number;
  };
  rows: Array<{
    relPath: string; calculationType: string;
    matchedBy: string[];               // 命中的父目录选择器或精确路径
    calculationStatus: string;          // 与指标有效性分开
    composition?: string; atomCount?: number;
    values: Record<string, {
      value: number | null | Array<{
        index: number; frequencyCm1: number;
        kind: 'real' | 'imaginary';
      }>;
      unit: string; status: 'ok' | 'missing' | 'invalid' | 'unsupported';
      sourcePath?: string; sourceField?: string; note?: string;
    }>;
  }>;
  excluded: Array<{ relPath: string; reason: string }>;
  render: { title: string; summary: string; resultId?: string };
};
```

简化输出示意（实际每个请求指标都要返回一个 `values` 项）：

```json
{
  "query": { "rootPath": "D:\\Projects\\VASPFlow\\test", "scope": { "subtrees": [{ "relPath": "1-NO3", "maxDepth": 1 }] }, "calculationType": "RELAXATION", "metrics": ["last_ionic_free_energy"] },
  "summary": { "discovered": 2, "included": 1, "excluded": 1, "complete": 1, "partial": 0 },
  "rows": [{ "relPath": "1-NO3/relax", "calculationType": "RELAXATION", "matchedBy": ["subtree:1-NO3@1"], "calculationStatus": "converged", "composition": "Bi54NO3", "atomCount": 58, "values": { "last_ionic_free_energy": { "value": -242.03065, "unit": "eV", "status": "ok", "sourcePath": "1-NO3/relax/OSZICAR", "sourceField": "last ionic step F=" } } }],
  "excluded": [{ "relPath": "1-NO3/ZPE", "reason": "属于 FREQUENCY_ZPE，不属于本次 RELAXATION 查询" }],
  "render": { "title": "查看弛豫数据", "summary": "1-NO3 下找到 1 个弛豫任务；1 个其他类别已排除。" }
}
```

精确路径不存在或类别不匹配时，放入 `excluded` 并逐条说明；不能悄悄略过。父目录选择器同样回显扫描路径、深度、命中数及排除数，让用户知道边界。模型可见摘要只含范围、数量和异常；对话正文没有必要重复卡片整张表。

频率输出中的一行示意（省略未展示的查询字段）：

```json
{
  "relPath": "2-NO/ZPE",
  "calculationType": "FREQUENCY_ZPE",
  "calculationStatus": "finished",
  "values": {
    "frequencies": {
      "value": [{"index": 1, "frequencyCm1": -54, "kind": "imaginary"}, {"index": 2, "frequencyCm1": 271, "kind": "real"}],
      "unit": "cm^-1", "status": "ok", "sourcePath": "2-NO/ZPE/OUTCAR", "sourceField": "f=/f/i="
    },
    "zpe": {
      "value": null, "unit": "eV", "status": "invalid",
      "note": "存在虚频；需要核对模式与计算设置，未自动忽略"
    }
  }
}
```

## 解析与科学语义

- 当前 `vasp_scan` 可提供 OSZICAR `F=` 末步能量和离子步数，`final_max_force` 尚为 `null`。现有 `vasp_convergence` 会对缺失的力步沿用前值或补 0；新工具不得将其末项冒充末步实测最大力，必须从原始输出取值并保留证据状态。
- 频率解析器读取 OUTCAR 中的 `f=` 与 `f/i=` 模式，并核对 POSCAR 的自由度。若存在虚频、模式不全、任务未确认完成或自由度范围不清，派生的 ZPE / 热力学项标为 `invalid`，说明原因，不静默剔除后给出确定值。
- `S_vib(T)` 是振动熵；不是总熵，也不是 VASP 电子占据展宽的熵项。`F_vib(T)` 不是完整 Gibbs 自由能，未自动计入气相平动、转动或其他热力学贡献。温度属于查询条件，卡片只能展示本次指定温度。

## 结果卡片

每次调用生成一张卡片，**标题由 `calculationType` 决定，范围取自 `query.scope`**。顶部显示根目录与范围，任务数和未找到路径压缩成一行；不再用大块数字统计及指标标签重复表头。正文只列该类别请求的指标。

弛豫数据以**一棵目录树中的横向点图**为主：每个任务一条横行，末步 `F` 是点和精确数值，末步最大力与离子步数在同一行右侧。同一直接父目录下的任务共用能量轴；组成留在右侧任务详情中，不同组成的总能量仍不可直接比较。图展示原始绝对值，不默认做差。频率数据以**逐任务频率谱**展示：一任务一条频率轴，实频与虚频用不同标记，ZPE、`S_vib(T)`、`F_vib(T)` 就近显示。缺失项直接在对应任务行标明。点击任务行会在右侧面板打开该任务详情，任务行自身不再展开第二层明细。

目录树在任务很多时可折叠；滚动时将已滑出面板或被顶部提示遮挡的、仍处于展开状态的直系祖先合成顶部路径（如 `A/B/C`）。未展开的当前列表目录不计入祖先路径。展开一个没有本层任务、且只有单个子文件夹的目录时，自动沿这条链展开到第一个任务或分叉处。

目录路径必须可见（长路径可折行）；每条数值可追到文件和字段；无数据以“—”和原因呈现。冗长的科学语义说明放进指标标题提示，不常驻卡片底部。若需要查看另一计算类别、父目录或温度，由模型发起另一调用并在聊天中生成另一张卡片。演示页分别展示弛豫查询和频率查询，**它们是两次调用，不是同一张卡片里的两个标签页**。
