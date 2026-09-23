# 广工大学城校园 3D 模型转 Minecraft 存档 / Litematica 投影可行性分析

分析日期：2026-09-23
分析对象：[`Xuezhenggdut/gdut-campus-atlas`](https://github.com/Xuezhenggdut/gdut-campus-atlas)
工作副本：[`oldicecube/gdut-campus-atlas`](https://github.com/oldicecube/gdut-campus-atlas)
分析基线：上游 `main` 提交 `7e3e2fec712ab3177808ab52aa3e702fbead1092`（Add continuously cycling pelican to central athletics track）

## 1. 结论摘要

**技术上可行，并且已有多个相近先例；但没有“任意 Three.js 校园场景无损、包含全部要素、一键转 Litematica”的通用现成链路。**
本项目也不应先导出 GLB 再转换，因为当前 `exportModel('campus')` 本身不包含地形、道路、水面、程序化树木和动态对象。正确路线是直接复用 Three.js 场景的数据与几何生成器，建立一条：

```text
项目数据 / Three.js 场景
  -> 统一世界坐标
  -> 分片体素化
  -> Minecraft 方块语义调色板
  -> .schem / .litematic / 世界存档
```

推荐先交付 **Litematica/Sponge 投影**，再做存档。原因是投影文件以稀疏方块调色板存储，便于分区、审阅、反复调整和多人分享；Minecraft 世界存档还要处理 Anvil region、区块边界、方块实体、坐标放置和区块加载，工程增量明显更大。

预计工程量：**中等偏高**。`体积采样 + 方块调色板 + Sponge .schem 写出` 可以较快做出原型；单栋 GLB 还可用 `ObjToSchematic` 走通验证链路。要达到“校园整体可辨识、重点建筑耐看、道路水系正确、文件能被 Litematica 稳定加载”，仍需要完整自建体素化与分片管线。详见第 3 章“同类需求与已有流程调查”。

## 2. Fork 与实际工作区状态
## 3. 同类需求与已有流程调查

结论先行：**类似需求已经有人做过，而且不止一种路线。** 不存在“任意复杂 Three.js 场景无损一键转 Minecraft”的通用按钮，但关键环节已有成熟项目，足以少走大量弯路。

### 3.1 完整先例：ObjToSchematic

- 仓库：https://github.com/LucasDower/ObjToSchematic
- 网站：https://objtoschematic.com/
- 类型：TypeScript；视觉化编辑器 + 可复用导出器；GitHub 约 523 星（2026-09-23 检索）
- 输入：Wavefront `.obj`，另有实验性 glTF/GLB 导入
- 输出：`.schematic`、`.litematic`、Sponge `.schem`、结构方块 `.nbt`，并支持 OBJ 回写
- 核心流程：导入网格 -> 材质/颜色 -> 选择体素化算法 -> 分配 Minecraft 方块调色板 -> 导出结构
- 关键源码：`src/importers/gltf_loader.ts`、`src/voxelisers/`、`src/block_assigner.ts`、`src/exporters/schem_exporter.ts`、`src/exporters/litematic_exporter.ts`
- 许可证：BSD-3-Clause
- 重要状态：仓库中的 1.0 桌面版本已明确标注为 legacy、不再更新；2.0 主要作为在线服务维护。直接当作长期运行时依赖有风险，但算法和格式实现仍非常适合作为参考或短暂验证链路。

对本项目的意义：现有 `scripts/export-models.ts` 已能把项目程序化几何导出为 GLB。理论上可以用 `gltf -> ObjToSchematic -> .litematic` 做第一版验证，尤其适合单栋图书馆。但不能把它当成整校最终方案，因为：

- GLB 导入在该项目中仍被标注为 experimental。
- 当前 `exportModel('campus')` 不包含完整地形、道路、水系、程序化树木和动态对象，即使转换成功也不是完整校园。
- 社区 issue 已记录大模型相关风险，包括 OOM、超大 OBJ 无法加载、大体积文件无法正常显示、体素化后模型出现空洞等。
- 全校园 1 单位/方块体量远大于普通单体模型，不适合依赖浏览器端一次性处理。

因此它适合回答“几何到投影的最小链路能不能跑通”，不适合直接回答“如何稳定生成整个广工校园”。

### 3.2 校园/真实地理世界先例：Arnis 与 Meld

- Arnis：https://github.com/louis-e/arnis
- 描述：从真实世界地理数据生成 Minecraft Java Edition 世界，支持 1:1 尺度，GitHub 约 18,000 星（2026-09-23 检索）
- 典型输入：OpenStreetMap；可选真实高程/卫星/地形数据
- 输出：完整 Minecraft 世界，而不是仅建筑投影
- Meld：https://github.com/Teddy563/meld
- Meld 的作用：把 Arnis 的大范围 OSM 选区拆成瓦片并行生成，再以共享高程和随机种子合并为连续世界

已有校园实践：

- 电子科技大学清水河校区：https://github.com/yaowenhu-pm/uestc-minecraft
  - 使用 Arnis 从 OSM 数据生成约 1:1 的校园 Minecraft 世界
  - 同时提供 BlueMap 网页地图和中文地名标注
  - 说明“真实校园数据 -> Minecraft 校园世界”的需求已验证可行
- 香港科技大学（清水湾）：https://github.com/clarkwei-101/hkust-minecraft
  - 使用 Arnis v3.0.0 构建 1:1 基岩版校园重建
- 校园重建工具：https://github.com/jingyuansrobin/campus-reconstruction-tool
  - 原生 Minecraft 校园重建桌面工具，声明基于 Arnis 派生生成逻辑

对本项目的意义：Arnis/Meld 证明了大范围真实地点、校园尺度和分片生成这条路可行。但两者的核心输入是 OSM/GIS，不是 Three.js 程序化几何。本项目没有把全部校园要素回写成标准 GIS 图层，所以不能简单“调用 Arnis 得到同一个广工模型”。最值得借鉴的是 OSM 语义层到方块语义层映射、大区域按瓦片切分/并行生成/共享原点合并、真实世界坐标到 Minecraft 坐标的投影，以及对高差、岸边、道路和建筑轮廓的专门处理。

### 3.3 Litematica 读写与生态工具

- Litemapy：https://github.com/SmylerMC/litemapy
  - Python；GPL-3.0；读写和编辑 `.litematic`；约 87 星
  - 适合服务端/离线批处理、分片拼接和自动检查
- schematic4j：https://github.com/SandroHc/schematic4j
  - Java；MIT；解析 `.schem`、`.schematic`、`.litematic`；约 27 星
  - 适合在 JVM 生态中做格式校验和转换
- Lite2Edit：https://github.com/GoldenDelicios/Lite2Edit
  - Java；MIT；把 `.litematic` 转成 WorldEdit `.schem`；约 181 星
  - 适合验证投影和世界编辑流程，不是 3D 模型转换器
- Litematica-viewer：https://github.com/albertchen857/Litematica-viewer
  - Python；MIT；检查和编辑 `.litematic`，适合作为人工验收辅助
- ObjToSchematic 的 `litematic_exporter.ts`
  - 已包含 Litematica NBT、位宽编码、palette、region 的实际实现
  - 但仍建议以“生成 `.schem` -> 官方 Litematica/WorldEdit 导入 -> 另存”作为最低风险路径

### 3.4 其他 3D 转 Minecraft 项目与成熟度

以下项目证明小中型 3D 模型转换已经有大量重复实现，但整体成熟度、维护度或许可证不如 ObjToSchematic，不建议直接作为整校主线：

- takecx/obj2schematic：https://github.com/takecx/obj2schematic（OBJ -> `.schematic`；约 10 星）
- skairunner/threed2vox：https://github.com/skairunner/threed2vox（3D 模型 -> Minecraft 兼容格式；约 7 星）
- ZY4N-Corporation/ChunkModifier：https://github.com/ZY4N-Corporation/ChunkModifier（OBJ -> `.mca`；C++；Apache-2.0；约 2 星）
- RicardoMaga/minecraft-voxel-converter：https://github.com/RicardoMaga/minecraft-voxel-converter（3D 模型 -> NBT；成熟度有限）
- kanttouchthis/cuda_schem：https://github.com/kanttouchthis/cuda_schem（GPU/CUDA 体素化 -> `.schem`；约 1 星）
- Arturr-H/obj-to-minecraft：https://github.com/Arturr-H/obj-to-minecraft（OBJ -> `.mcfunction`；约 1 星）
- esamuelson/stl2minecraft：https://github.com/esamuelson/stl2minecraft（STL -> Minecraft Function；约 1 星）

### 3.5 现有流程能否直接用于本项目

| 路线 | 已有先例 | 对本项目适配 | 结论 |
|---|---|---|---|
| 单栋 GLB -> ObjToSchematic -> `.litematic` | 成熟 | 最容易验证，但需处理实验性 GLB 导入与材质 | 推荐作为最小原型 |
| 自建 Three.js 数据提取 -> 体素化 -> `.schem`/`.litematic` | ObjToSchematic 可参考算法 | 能保留地形、道路、水系、树木和语义信息 | 推荐作为正式方案 |
| OSM -> Arnis/Meld -> 完整 Minecraft 世界 | 有校园成功案例 | 需要先把项目数据转成 OSM/GIS 图层，不能直接复用现有模型 | 只借鉴分片和语义生成，不作为首版主线 |

### 3.6 对原分析结论的修正

原结论中的“不存在 GLB 一键转 Litematica 的可靠现成链路”需要收窄为：

> 不存在“任意 Three.js 校园场景无损、包含全部要素、一键转 Litematica”的现成通用链路；但“GLB 单栋模型 -> ObjToSchematic -> `.litematic`”这条简化链路已经有成熟先例，可以作为原型验证入口。

正式实施仍推荐直接复用项目数据与几何生成器，而不是把整校 GLB 当作唯一事实来源。这样既能保留语义分层，也能避免整校模型在第三方编辑器中触发内存和大文件问题。
## 4. 项目实际是什么

这不是由 Blender/glTF 资产拼装的校园模型，而是 **Three.js 程序化 3D 场景**：

- `src/scene/CampusScene.ts`：场景总装、地形/道路/树木/精细模型加载、截图和 GLB 导出
- `src/scene/models.ts`：按建筑类型生成建筑的几何
- `src/scene/geometry.ts`：`Parts`、多边形、道路和合并工具
- `src/data/campus.ts`：建筑、地点、坐标、类型和尺寸数据
- `src/data/landscape.ts`：地块、水体、道路、步道、公园
- `src/data/projection.ts`：示意地图坐标到 Three.js 世界坐标的仿射变换

建筑几何主要由 Box、Cylinder、Shape、Extrude、Plane、Tube、Torus、Icosahedron 等基本体组合，不是方块网格。大量“窗格、栏杆、格栅、灯带”是薄板或线状几何，直接按三角形逐个体素化会产生海量碎片，应采用“包围盒/三角形与体素相交 + 最小厚度补偿 + 按语义分层”的策略。

## 5. 当前导出能力与缺口

`CampusScene.exportModel()` 的现有分支：

- `campus`：遍历已建建筑，调用 `makeBuilding()`，再加入 `makeConnections()`；**不包含** `terrain`、`makeRoadNetwork()`、水面、程序化树木和动态人车
- `south-gate`：导出南门固定组团
- 其他 id：导出单栋建筑 GLB

README 和验收报告也明确写明：`models/gdut-campus.glb` 是已建建筑集合，不含树木、地形、湖面和道路；工程连接是一部分；坐标单位是示意单位，不是米。

因此：

- **可以直接用的对象**：建筑及其参数化细节、连接结构、部分固定广场/树木
- **需要新导出入口的对象**：地块、湖面、水道、道路、步道、公园、程序化树木、山体、天桥和夜间/动态层
- **不应导出的对象**：相机、灯光、雾、夜间灯光池、动态车辆、鹈鹕骑行者、标签等表现层对象

## 6. 实测规模与体素预算

由 `scripts/analyze-minecraft-feasibility.ts` 统计：

| 指标 | 数值 |
|---|---:|
| 建筑记录总数 | 99 |
| 已建建筑 | 97 |
| 规划建筑 | 2 |
| 已建建筑占地参数和 | 179,870 平方单位 |
| 建筑最大高度 | 42 个示意单位 |
| 已建建筑包围盒 | 约 1311 × 887（X × Z） |
| 完整场景控制范围 | 约 1478 × 1044（X × Z） |
| 估算最大转换高度 | 50 个示意单位（含余量） |

按“场景 AABB 上限”估算的方块体积：

| 比例 | 方块尺寸 | X × Z × Y | 体素上限 |
|---:|---|---:|---:|
| 1 单位 = 1 方块 | 约 1478 × 1044 × 50 | 约 1479 × 1044 × 50 | 约 7720 万 |
| 2 单位 = 1 方块 | 约 740 × 522 × 25 | 约 740 × 522 × 25 | 约 966 万 |
| 3 单位 = 1 方块 | 约 493 × 348 × 17 | 约 493 × 348 × 17 | 约 292 万 |
| 4 单位 = 1 方块 | 约 370 × 261 × 13 | 约 370 × 261 × 13 | 约 126 万 |

这是“包围盒上限”，不是实际非空方块数。实际体素化后只会写入表面壳层和必要内部结构，但 Litematica/Sponge 仍按三维区域体积分配方块状态数组，因此**区域尺寸比非空方块数量更关键**。

推荐：

- 全校总览：优先 **2 单位/方块**
- 教学区/生活区分区：优先 **2 单位/方块**，重要轴线可 1 单位
- 单体建筑/重点地标：**1 单位/方块**
- 不建议把整校以 1 单位/方块做成一个单体文件

## 7. 坐标与尺度处理

`src/data/projection.ts` 提供 `toWorld()`：示意地图坐标经仿射变换进入 Three.js 世界坐标，北向为 `-Z`，单位是 `schematic`，不是米。Minecraft 坐标可直接使用该世界坐标，并做以下固定映射：

```text
mcX = floor((worldX - originX) / blockScale)
mcY = floor((worldY - baseY) / blockScale)
mcZ = floor((worldZ - originZ) / blockScale)
```

必须统一：

- `blockScale`：1/2/3/4 单位每方块
- `originX/Y/Z`：整个项目的共同原点
- `baseY`：水面、地面、台阶的基准高度
- Minecraft 的 `X/Z` 不要做额外翻转；北向通过 `-Z` 保持
- 所有分片都使用同一原点和比例，后续才能无缝拼合

不要从 GLB 的世界变换反推坐标；直接从数据层和 `toWorld()` 生成，避免浮点误差和多格式重采样。

## 8. 推荐的体素化架构

建议新增独立的导出模块，不要把复杂逻辑塞进 `CampusScene.ts`：

```text
src/minecraft/
  types.ts              # VoxelVolume、MaterialPalette、ExportRegion
  world.ts              # 统一坐标、比例、原点、分片
  sceneExtractor.ts     # 从数据/生成器提取可体素化几何与语义
  voxelizer.ts          # 三角形/包围盒体素化
  surface.ts            # 表面壳、内部填充、薄面补偿
  palette.ts            # 颜色/语义 -> Minecraft 方块
  regions.ts            # 教学区、东区、西区、体育区等分片
  schemWriter.ts        # Sponge .schem 写出
  litematicWriter.ts    # 可选，直接写版本 4 .litematic
```

核心步骤：

1. **提取语义对象**，不要只提取合并后的 mesh。建筑、道路、水面、树木、玻璃应保留 `kind`、材质名和对象来源。
2. **统一尺度与原点**，把所有几何变换到 Minecraft 导出坐标系。
3. **构建空间索引**，按区块/分片对三角形或包围盒做相交测试，避免逐三角形遍历全场景。
4. **按语义体素化**：
   - 建筑实体：表面壳 + 可选内部实心填充
   - 玻璃/窗：优先玻璃块或染色玻璃，不填充内部
   - 道路/标线：薄面单独抬升 1 格，必要时占用 `y+1` 防 z-fighting
   - 水面：体素化为水方块薄层，移除水面下方的实体重叠
   - 树木：树干与树叶分别映射，避免把树叶变成长方体色块
   - 栏杆/格栅：最小厚度 1 格，必要时简化为墙或栅栏
5. **材质调色板**：把 Three.js 十六进制颜色和语义映射到目标版本的方块状态，而不是简单按 RGB 最近邻。
6. **分片和 LOD**：先按教学区、生活东区、生活西区、体育/景观区分片，再按 2 单位总览与 1 单位重点区输出。
7. **写出与验证**：先生成 Sponge `.schem`，用 Litematica 或 WorldEdit 导入验证；确认后再决定是否直接生成 `.litematic`。

## 9. 方块调色板建议

不要按“颜色完全相等”映射，因为 Minecraft 方块有朝向、光照、透明和方块状态。建议建立两级调色板：

| 语义 | 首选方块 |
|---|---|
| 建筑白色/米色外墙 | 白色混凝土、平滑石英、浅灰混凝土、白色陶瓦 |
| 浅灰/混凝土 | 浅灰混凝土、石砖、平滑石 |
| 深灰屋顶/格栅 | 深灰色混凝土、深板岩砖、灰色陶瓦 |
| 暖色砖墙 | 红砖、陶瓦、橙色混凝土 |
| 玻璃幕墙 | 玻璃、淡灰色染色玻璃、青色染色玻璃 |
| 水体 | 水、蓝色染色玻璃（仅用于装饰水） |
| 草地/地块 | 草方块、苔藓块、绿色混凝土 |
| 道路 | 灰色混凝土、砂砾、深灰色混凝土 |
| 道路标线 | 白色混凝土、黄色混凝土 |
| 树干 | 深色橡木原木、橡木原木 |
| 树叶 | 橡木树叶、杜鹃树叶、绿色混凝土 |
| 金属/灯带 | 铁块、海晶灯、荧石、末地烛 |

重点不是“每个颜色都找一个方块”，而是把相似语义合并到有限调色板，通常 20~40 种方块足够；否则调色板位数和文件大小会增加，视觉也会碎片化。

## 10. `.litematic` 与 `.schem` 的实际格式

Litematica 当前源码中的 `LitematicaSchematic`：

- 扩展名：`.litematic`
- 当前 schematic 版本：`4`
- 顶层 NBT：`Version`、`MinecraftDataVersion`、`Metadata`、`Regions`
- 每个 region：`Position`、`Size`、`BlockStatePalette`、`BlockStates`
- 可选：`TileEntities`、`PendingBlockTicks`、`Entities`
- `BlockStates` 是按 `index = (y * sizeZ + z) * sizeX + x` 组织的紧凑位数组，位宽由调色板大小决定

这说明：

- 直接写 `.litematic` **可行**，但需要正确实现 NBT、调色板、紧凑位数组和 region 坐标
- 优先做法：先生成 Sponge `.schem`，由 Litematica 或 WorldEdit 负责导入/转换；稳定后再实现 `.litematic` 写出器
- `prismarine-schematic@1.3.0` 支持 Sponge `.schem` 读写，依赖 `prismarine-nbt`、`prismarine-world`、`minecraft-data`；它**不直接写 `.litematic`**
- `makeWithCommands()` 可生成 `setblock` 命令链，适合无 WorldEdit 的服务器，但对整校把命令数量降到可执行规模本身就是一项优化任务

## 11. Litematica 投影与 Minecraft 存档的选择

### Litematica 投影

优点：

- 文件轻，适合分享、审阅和反复修改
- 可分 region 保存，便于分区拼合
- 不直接修改服务器世界，放置位置可预览
- 适合先做校园总览和重点建筑

限制：

- 需要客户端 mod
- 最终仍要由玩家或工具放置到世界
- 部分方块实体、实体和调度 tick 需要额外处理
- 巨大投影会带来客户端渲染和加载压力

### Minecraft 存档

优点：

- 打开即用，不依赖 mod
- 可配合服务器/地图发布

限制：

- 需要写 Anvil region 文件或通过 WorldEdit/Litematica 粘贴后再保存
- 区块、区块加载、方块实体、光照、实体和区域文件格式都要处理
- 大范围写入和后续维护比投影重

**建议：同一条体素结果同时支持两种输出，但交付顺序为 `.schem` -> `.litematic` -> 世界存档。**

## 12. 分片与 LOD 方案

建议按数据中的 `area` 和对象类别拆分，而不是按固定正方形窗口切割：

- `academic-overview`：教学区总览，2 单位/方块
- `east-overview`：生活东区总览，2 单位/方块
- `west-overview`：生活西区总览，2 单位/方块
- `sports-landscape`：体育场、湖区、南门、公园，2 单位/方块
- `library-detail`：图书馆，1 单位/方块
- `south-gate-detail`：南门/行政楼/综合楼/会议中心组团，1 单位/方块
- `culture-gym-detail`：文化活动中心、体育馆、看台等，1 单位/方块

每个分片输出：

- 投影文件
- 分片 AABB
- 原点与 `blockScale`
- 非空方块数、区域体积、调色板、文件大小
- 与其他分片的拼合说明

不要把教学区和生活区放在一个超大 region 里再靠“空方块”撑大文件；应按空间分块，必要时让多个 region 共享同一原点。

## 13. 主要风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 薄几何多 | 窗户、栏杆、格栅丢失或爆炸性增长 | 最小厚度、按语义合并、限制细节 LOD |
| 场景单位非米 | 比例失真 | 固定 `blockScale` 并在预览中测量 |
| 完整场景当前未导出 | 只能得到建筑，不是完整校园 | 新增完整场景导出入口 |
| 颜色到方块非一一对应 | 视觉偏差 | 语义调色板 + 实机对比 |
| 超大 region | 文件大、加载慢 | 分片、LOD、稀疏化 |
| 水/玻璃透明层 | 面重叠、闪烁 | 分层、抬升、去除重叠体素 |
| 版本差异 | 方块名/状态不兼容 | 固定目标版本，保存 `MinecraftDataVersion` |
| 动态对象 | 时间和状态不确定 | 首版排除，或只导出静态代表 |
| 版权与来源 | 模型/标识再利用边界 | 保留来源说明，按仓库许可和素材说明处理 |

## 14. 分阶段实施计划

### 阶段 0：可重复统计与坐标冻结

- 保留 `scripts/analyze-minecraft-feasibility.ts`
- 确定目标 Minecraft Java 版本
- 冻结 `origin`、`blockScale`、`baseY`
- 输出建筑、地形、水体、道路、树木的语义清单

### 阶段 1：最小原型

选择图书馆或南门组团：

- 提取单栋建筑的语义几何
- 做 1 单位/方块体素化
- 生成 Sponge `.schem`
- 在 Litematica 中导入并检查尺寸、朝向、材质
- 用真机截图和原模型对照

### 阶段 2：完整场景提取

- 把 `terrain`、水体、道路、步道、公园、树木纳入导出
- 区分静态对象与动态对象
- 为每个对象打语义标签
- 输出完整场景的体素统计

### 阶段 3：全校总览

- 2 单位/方块
- 分 academic/east/west/sports 输出
- 检查道路、水面、建筑占地和主要轴线
- 生成共享原点的拼合说明

### 阶段 4：重点建筑精修

- 图书馆、南门、体育馆、文化活动中心等使用 1 单位/方块
- 调色板人工校正
- 细化和验证玻璃、屋顶、台阶、连廊、栏杆

### 阶段 5：直接 `.litematic` 与存档

- 实现 Litematica version 4 NBT 写出器
- 校验调色板位宽、索引顺序和 region 坐标
- 如需无 mod 世界：通过 WorldEdit 粘贴或实现 Anvil 写出
- 进行大文件加载、客户端帧率和区块边界测试

## 15. 验收标准

一个可用的 Minecraft 导出应至少满足：

- 坐标方向正确：北向、道路走向和建筑相对关系与原场景一致
- 尺寸正确：分片 AABB、比例、原点和 `blockScale` 可复现
- 建筑可辨识：重点建筑至少保留屋顶、主体、主要连廊和入口关系
- 道路和水系可辨识：主干道、湖岸、水道和公园不互相覆盖
- 调色板稳定：同一语义在分片间使用同一方块
- 文件可导入：Litematica/WorldEdit 能读取，无明显缺失或全紫黑
- 非空方块与文件大小有记录
- 在目标 Minecraft 版本和至少一台目标设备上完成实机验证

## 16. 最终建议

**建议立项，但按“自建 Minecraft 导出管线”而不是“整校 GLB 格式转换”立项。已有先例主要用来复用成熟环节，不用来代替项目语义。**

第一步不要直接做整校 1 单位/方块投影，而是：

1. 用现有 `scripts/export-models.ts` 导出图书馆 GLB，尝试 `ObjToSchematic` 的 GLB 导入，得到 `.schem` 或 `.litematic`，先验证“几何能进 Minecraft”
2. 同时直接用项目几何生成器做图书馆 1 单位/方块 Sponge `.schem`，对比两者在薄墙、窗户、屋顶、材质和完整性上的差异
3. 在 Litematica 实机验证颜色、尺寸、朝向和薄面处理，并以 Litemapy 或 Litematica-viewer 做自动/人工检查
4. 验证通过后，再做 2 单位/方块全校分区总览；分片和共享原点思路可参考 Meld，而不是照搬其 OSM 输入
5. 最后实现 `.litematic` 直接写出和无 mod 世界存档

这样能在最小风险下验证最不确定的部分：**体素化质量、材质映射和 Litematica 实机导入**。如果这三项通过，剩余工作主要是工程量而非技术可行性问题。
