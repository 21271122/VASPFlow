---
name: vasp-structure-opt
description: VASP 结构优化输入文件构建（工具驱动协议）。用 vasp_src_inspect / vasp_scan_templates / vasp_build_inputs / vasp_check_inputs 完成源体检、模板确认、构建（dry-run 先行）、校验与汇报；工具参数以工具 schema 为准。当用户提到"构建输入文件"、"生成结构优化"、"建目录"、"搭INCAR"、"构造fix"、"批量建任务"、"结构优化输入"时使用。
---

# 协议（编排；执行细节以各工具 schema 为准）

1. **源体检**：`vasp_src_inspect` 盘点结构源（物种/SD 分布/尾行），跨文件不一致先汇报，不带着分歧构建；
2. **确认模板与提交脚本**：`vasp_scan_templates` 列候选 → **用户确认** `template`（可再用 `sources`/`*Src` 逐文件指定不同来源）；`submitSrc` 缺失时询问或按分段构建跳过（仅警告）；
3. **dry-run 预览**：`vasp_build_inputs` 传 `dryRun: true`——检查每任务 SD 计划与 **`sdNotes` 旗标改写提示**（`override` 模式下源旗标被改必须可见）、POTCAR 匹配；
4. **正式执行**：用户确认后 `vasp_build_inputs`（不传`dryRun`=真实构建），核对 `written`/`wroteCount` 与逐任务 status；
5. **验证**：`vasp_check_inputs`（传 `projectRoot`）逐目录核对，并检查顶层 `consistency.uniform`——批次间 SD/物种/K 点/关键参数不一致必须向用户报告；
6. **汇报**：表格输出 目录 / 输入来源 / SD / POTCAR / 错误与修正。

## 要点（决定“如何”的默认值）

- `sdPolicy` **默认 `keep`**（沿源文件旗标原样）；显式 `freeAtoms`/`fixedAtoms` 按显式规则；`override` 且不显式 → 报错。绝不按元素序推断；
- `poscarSrc`/`submitSrc`/各输入缺失 = **分段构建**（警告不中止，只复制已有的）；完全无来源才报错；
- 提交脚本**不自动探测**；模板**由用户决定**（agent 只列候选）；单任务错误不中断其余。

> 参数表、字段表、示例、速查见 `docs/VASPFlow-插件功能说明.md` 与各工具 schema，本文件不重复。
