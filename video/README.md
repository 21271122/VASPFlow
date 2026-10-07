# VASPFlow 宣传片（Remotion）

## 当前修订版（68 秒）

`npm run render:director:v2` → `out/vaspflow-director-cut-v2.mp4`，1080p / 30 fps。

文案与数据说明见 [修订版介绍片逐句文案.md](./修订版介绍片逐句文案.md)。本版使用本地 `test/1-NO3`、`test/2-NO` 的真实结构和收敛输出；构建步骤为动画演示。此前成片保留。下文 `Promo` 的示例数据说明仅适用于原版。

## 发布封面

主文案：**任务一目了然／结果触手可及**。标题标识：**VASP + deepseek harness**。

- [4:3 横版](./public/covers/vaspflow-cover-4x3.png)：1448 × 1086。
- [3:4 竖版](./public/covers/vaspflow-cover-3x4.png)：1086 × 1448。
- [封面生成提示词](./public/covers/prompts.md)。

封面由 imagegen 基于实机演示画面生成。导出的视频和预览图保留本地，`out/` 不加入 Git；可用下文的命令重新渲染。

## 新版导演剪辑（78 秒）

`src/DirectorCut.tsx` 按《新版介绍片大纲与逐句文案.md》制作了八段连续使用场景：
扫描项目、查看错误依据、同体系能量共轴、按任务切换收敛曲线、拖入结构、
替换构建模板、预览确认写盘与对话内收束。九句主字幕和全部指定的界面文案
均已进入成片。演示目录与数据为匿名示意，不使用真实工作区。

成片：`out/vaspflow-director-cut.mp4`（1920×1080、30 fps、78 秒、无音轨）。
旧版 `out/vaspflow-tool-cards.mp4` 保留。

```bash
npm run typecheck
npm run render:director
```

以下内容记录原版 `Promo` 的制作与渲染方式。

针对「**工具调用结果渲染成可视化卡片**」这次更新的介绍宣传片。成片是一段
1920×1080 / 30 fps / 约 67 秒的 MP4，画面里出现的每一张卡片都不是重画的，
而是**直接复用插件源码里的 DOM 结构和 CSS**渲染出来的。

> 说明：你写的 "reaction" 在本仓库、node_modules、git 历史和 docs 里都搜不到，
> 我按最贴近的解读 **Remotion（React 编程式视频）** 来做，并产出了真正的 MP4。
> 如果你指的是别的工具，告诉我名字，改成对应形态的成本主要在 `src/Promo.tsx`。

---

## 1. 卡片同源，不是"照着做"

| 视频里的东西 | 来源 |
|---|---|
| 卡片全部样式 | `plugins/dsh-vaspflow/src/client/index.tsx` 里的 `CSS` 数组，**逐字**抽到 `src/cards/cards.css`（239 条规则，未改任何声明） |
| 暗色主题覆盖 | `cards.css` 的机械派生 `src/cards/cards-dark.css`：把 `body[data-ds-dark-theme]` 前缀换成 `.vfp-dark`，只为让同一帧里能同时出现明暗两套卡片 |
| 卡片结构与 class | `src/client/tool-rows.tsx` 的 `PathTree / PieBreakdown / IssueRows / ScanOverview / StatusInspection / InputChecks / CollectedResults / InputDiscovery / ResultTabs / VaspToolRow` |
| 构建卡片 | `src/client/index.tsx` 的 `BuildInputsToolRow` |
| 收敛图 | `src/client/ConvergenceChart.tsx`（recharts 双轴折线）的 SVG 复刻：能量 `#8884d8`、最大力 `#82ca9d`、相对/绝对能量开关、数据来源行 |
| 3D 结构 | `lib/host/structure.js` 的 `parseStructureFile / atomSpec / buildBondSpecs` 与 `StructureViewer.tsx` 的 `VDW_RADIUS / atomColor` 一起移植到 `src/cards/scene.ts` |
| 状态与配色表 | `scanStates / scanTypes / checkCategories / profileNames / titles / elementColors` 原样复制到 `src/cards/tokens.ts` |
| 文案 | `docs/vaspflow-tool-rendering-plan.md` 的工具映射与共用规则 |

结构卡片里展示的是 **3C-SiC 惯用胞**：用插件自己的成键判据（最短周期距离 <
(vdw+vwd)/2）算出来 25 条 Si–C 键，跨胞的键按插件的做法补了周期镜像原子，
所以右侧那圈"长在晶胞外面"的原子不是装饰，是插件真实会渲染的东西。

## 2. 目录

```
video/
├── package.json            # Remotion 工程
├── remotion.config.ts      # PNG 中间帧 / 单进程 / H.264 CRF 12
├── src/
│   ├── index.ts            # registerRoot
│   ├── Root.tsx            # <Composition id="Promo">
│   ├── Promo.tsx           # 分镜时间轴 + 舞台 + 对话外壳
│   ├── motion.tsx          # Reveal / useProgress（逐帧纯函数动画）
│   └── cards/
│       ├── cards.css       # ← 插件 CSS，逐字
│       ├── cards-dark.css  # ← 插件暗色 CSS，机械派生
│       ├── tokens.ts       # 状态表 / 配色 / 元素半径
│       ├── scene.ts        # POSCAR → 场景（宿主结构算法移植）
│       ├── fixtures.ts     # 各工具的返回值样例
│       ├── primitives.tsx  # PathTree / 圆饼 / 扫描条 / 图例
│       ├── visuals.tsx     # 收敛图 / 3D 结构 / ResultTabs
│       └── tool-cards.tsx  # 各工具卡片主体 + 卡片外壳
└── out/                    # 渲染产物
```

## 3. 渲染

```bash
cd video
npm install

npm run studio            # 交互式预览（改一帧看一帧）
npm run render            # 出片：out/vaspflow-tool-cards.mp4
npm run render:preview    # 半分辨率快速出片
npm run still             # 单帧 out/frame.png
```

首次渲染会自动下载 Remotion 的 Chrome Headless Shell（约 113 MB）。

## 4. 分镜

| 帧 | 时长 | 内容 |
|---|---|---|
| 0–90 | 3.0s | 开场：VASPFlow / VASP 科研助手 / 「工具调用结果，不该只是一段 JSON」 |
| 90–225 | 4.5s | 主张：八类结果一套信息层级，四条共用规则 |
| 225–351 | 4.2s | 转折：通用工具视图（原始 JSON）→ 结构化卡片 |
| 351–1495 | 38.1s | 卡片巡礼：每项先展示工具名称和结论，再推进到卡片细节 |
| 1495–1705 | 7.0s | 交互：点行打开右侧看板、拖任务给卡片补标签页 |
| 1705–1831 | 4.2s | 暗色主题：同一套语法 |
| 1831–2011 | 6.0s | 收尾：安装命令 + 仓库地址 |

## 5. 取舍

- **3D 用 SVG 而不是 WebGL**：Remotion 逐帧截图时 WebGL 容易不稳定，所以 3D 视图
  按同一套原子位置、元素色、球半径和晶胞配色，用投影 + 画家算法画成确定性 SVG。
  卡片外壳、工具条（`文件：… / 复位 / 设置`）、下方摘要行都保持原样。
- **卡片是静态姿态**：视频里没有交互，行、标签、饼图、勾选状态都是"某个时刻的样子"；
  入场用 Remotion 的逐帧动画演出，不影响任何样式。
- **镜头推进按卡片调整**：状态列表放大以便读证据；曲线和结构控制推进幅度，保留完整图面。
- **文字稳定性**：逐帧截图只用一个浏览器进程，避免并行进程交替输出略有差异的文字抗锯齿；PNG 中间帧与 30 帧关键帧间隔保留细字清晰度。
- **无音轨**：仓库里没有可用的音频素材，成片是无声的。需要配乐的话把音频放进
  `public/` 并在 `Promo.tsx` 里加 `<Audio>` 即可。
- **数据是编的，形状不是**：`fixtures.ts` 的字段名与宿主返回结构一致（对照
  `lib/host/output-schema.test.mjs`），数值是按 VASP 常见量级写的假数据。
