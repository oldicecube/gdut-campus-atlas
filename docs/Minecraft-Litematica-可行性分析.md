# 广工大学城校园 3D 模型转 Minecraft 存档 / Litematica 投影可行性分析

分析日期：2026-09-23  
分析对象：[`Xuezhenggdut/gdut-campus-atlas`](https://github.com/Xuezhenggdut/gdut-campus-atlas)  
工作副本：[`oldicecube/gdut-campus-atlas`](https://github.com/oldicecube/gdut-campus-atlas)  
分析基线：上游 `main` 提交 `7e3e2fec712ab3177808ab52aa3e702fbead1092`（Add continuously cycling pelican to central athletics track）

## 1. 结论摘要

**技术上可行，但不存在“GLB 一键转 Litematica”的可靠现成链路。**  
本项目也不应先导出 GLB 再转换，因为当前 `exportModel('campus')` 本身不包含地形、道路、水面、程序化树木和动态对象。正确路线是直接复用 Three.js 场景的数据与几何生成器，建立一条：

```text
项目数据 / Three.js 场景
  -> 统一世界坐标
  -> 分片体素化
  -> Minecraft 方块语义调色板
  -> .schem / .litematic / 世界存档
```

推荐先交付 **Litematica/Sponge 投影**，再做存档。原因是投影文件以稀疏方块调色板存储，便于分区、审阅、反复调整和多人分享；Minecraft 世界存档还要处理 Anvil region、区块边界、方块实体、坐标放置和区块加载，工程增量明显更大。

预计工程量：**中等偏高**。`体积采样 + 方块调色板 + Sponge .schem 写出` 可以较快做出原型；要达到“校园整体可辨识、重点建筑耐看、道路水系正确、文件能被 Litematica 稳定加载”，需要完整自建体素化与分片管线。

## 2. Fork 与实际工作区状态

- 已在 GitHub 创建 fork：`https://github.com/oldicecube/gdut-campus-atlas`
- fork 的父仓库：`Xuezhenggdut/gdut-campus-atlas`
- fork 默认分支：`main`
- 本地目录：`D:\Cube GDUT\gdut-campus-atlas`
- `origin` 指向 fork，`upstream` 指向上游
- 本机 `git fetch` 访问 `github.com:443` 超时，因此当前本地 Git 历史是“源码快照提交”，不是完整上游历史；源码内容已核对并对齐上游最新提交 `7e3e2fec...`
- 上游代码可通过 `gh api` 正常读取，分析结论不依赖本地历史
- 构建验证：`npm.cmd run build` 通过
- 测试验证：90 项测试通过
- 运行环境：Node.js `v22.22.3`，npm `10.9.8`
- 附带统计脚本：`scripts/analyze-minecraft-feasibility.ts`，可重复输出建筑数量和体素预算

## 3. 项目实际是什么

这不是由 Blender/glTF 资产拼装的校园模型，而是 **Three.js 程序化 3D 场景**：

- `src/scene/CampusScene.ts`：场景总装、地形/道路/树木/精细模型加载、截图和 GLB 导出
- `src/scene/models.ts`：按建筑类型生成建筑的几何
- `src/scene/geometry.ts`：`Parts`、多边形、道路和合并工具
- `src/data/campus.ts`：建筑、地点、坐标、类型和尺寸数据
- `src/data/landscape.ts`：地块、水体、道路、步道、公园
- `src/data/projection.ts`：示意地图坐标到 Three.js 世界坐标的仿射变换

建筑几何主要由 Box、Cylinder、Shape、Extrude、Plane、Tube、Torus、Icosahedron 等基本体组合，不是方块网格。大量“窗格、栏杆、格栅、灯带”是薄板或线状几何，直接按三角形逐个体素化会产生海量碎片，应采用“包围盒/三角形与体素相交 + 最小厚度补偿 + 按语义分层”的策略。

## 4. 当前导出能力与缺口

`CampusScene.exportModel()` 的现有分支：

- `campus`：遍历已建建筑，调用 `makeBuilding()`，再加入 `makeConnections()`；**不包含** `terrain`、`makeRoadNetwork()`、水面、程序化树木和动态人车
- `south-gate`：导出南门固定组团
- 其他 id：导出单栋建筑 GLB

README 和验收报告也明确写明：`models/gdut-campus.glb` 是已建建筑集合，不含树木、地形、湖面和道路；工程连接是一部分；坐标单位是示意单位，不是米。

因此：

- **可以直接用的对象**：建筑及其参数化细节、连接结构、部分固定广场/树木
- **需要新导出入口的对象**：地块、湖面、水道、道路、步道、公园、程序化树木、山体、天桥和夜间/动态层
- **不应导出的对象**：相机、灯光、雾、夜间灯光池、动态车辆、鹈鹕骑行者、标签等表现层对象

## 5. 实测规模与体素预算

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

## 6. 坐标与尺度处理

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

## 7. 推荐的体素化架构

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

## 8. 方块调色板建议

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

## 9. `.litematic` 与 `.schem` 的实际格式

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

## 10. Litematica 投影与 Minecraft 存档的选择

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

## 11. 分片与 LOD 方案

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

## 12. 主要风险

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

## 13. 分阶段实施计划

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

## 14. 验收标准

一个可用的 Minecraft 导出应至少满足：

- 坐标方向正确：北向、道路走向和建筑相对关系与原场景一致
- 尺寸正确：分片 AABB、比例、原点和 `blockScale` 可复现
- 建筑可辨识：重点建筑至少保留屋顶、主体、主要连廊和入口关系
- 道路和水系可辨识：主干道、湖岸、水道和公园不互相覆盖
- 调色板稳定：同一语义在分片间使用同一方块
- 文件可导入：Litematica/WorldEdit 能读取，无明显缺失或全紫黑
- 非空方块与文件大小有记录
- 在目标 Minecraft 版本和至少一台目标设备上完成实机验证

## 15. 最终建议

**建议立项，但按“自建 Minecraft 导出管线”而不是“GLB 格式转换”立项。**

第一步不要直接做整校 1 单位/方块投影，而是：

1. 选图书馆做 1 单位/方块 Sponge `.schem` 原型
2. 在 Litematica 实机验证颜色、尺寸、朝向和薄面处理
3. 验证通过后，再做 2 单位/方块全校分区总览
4. 最后实现 `.litematic` 直接写出和无 mod 世界存档

这样能在最小风险下验证最不确定的部分：**体素化质量、材质映射和 Litematica 实机导入**。如果这三项通过，剩余工作主要是工程量而非技术可行性问题。
