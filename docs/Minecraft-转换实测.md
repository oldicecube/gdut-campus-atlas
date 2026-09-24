# 广工大学城校园 3D 模型 → Minecraft 3:1 存档 / Litematica 投影实测

日期：2026-09-24
工作副本：`oldicecube/gdut-campus-atlas`
上游：[`Xuezhenggdut/gdut-campus-atlas`](https://github.com/Xuezhenggdut/gdut-campus-atlas)

本文是 [`Minecraft-Litematica-可行性分析.md`](./Minecraft-Litematica-可行性分析.md) 的**实测续篇**：前者回答“能不能转、别人怎么做”，本文记录“3 方块 = 1 米”目标的**实际跑通结果、精确比例口径、双重独立校验和已知信息损失**。

---

## 1. TL;DR

- **结论：3:1 投影可以实现，且已跑通并逐体素零误差校验。**
- 本项目 GLB 的坐标**本身就是米制**（建模块直接使用 `Building.width/height/depth`），不存在额外“示意单位”换算。因此 **3 方块/米 = 对 GLB 做精确 ×3 均匀缩放**。
- 五个示例区域已产出 `.schem`（Sponge v2）与 `.litematic`（Litematica v6），最大者南门组团 911×101×556。
- `.litematic` 经 litemapy **全量逐体素**比对（`mismatchCount: 0`），`.schem` 经 EngineHub SchematicJS 独立解析，non-air 计数与 litemapy 完全一致。
- 全校 3:1 约 **3907×138×2716 ≈ 14.7 亿**网格单元，必须分片，不能单文件整体转换。

---

## 2. 比例口径：3 方块 = 1 米到底怎么实现

### 2.1 GLB 已经是米

`src/scene/models.ts` 及全部 `src/scene/*.ts` 直接消费 `Building.width/height/depth`：

```ts
const {width:w,depth:d,height:h}=b;   // 例如 library: 55 x 55 x 34
p.box(w+19,1.1,d+19,0,.55,0,...);     // 直接把这些数当世界单位使用
```

数据层 `src/data/campus.ts` 的 `width/depth/height` 是建筑米数（`heightBasis` 明确注明“示意高度、非测绘”），且运行时会被校准函数改写：

```ts
applyPlanningCalibration(buildings,places);
applyAcademicCalibration(buildings,places);
applySportsCalibration(buildings,places);
```

**因此唯一权威的尺寸来源是运行时校准后的值，不是源码字面值。** 实测：

| 建筑 | 源码字面值 W×D×H | 校准后 W×D×H |
|---|---|---|
| library | 86 × 81 × 45 | **55 × 55 × 34** |
| cricket | 129 × 92 × 14 | **117 × 117 × 14** |
| gym | — | **82 × 74 × 26** |
| culture | — | **65 × 55 × 14** |
| south-gate | — | **78.3 × 13.5 × 15** |

> ⚠️ 早期实验用 `--size 102`（= 34×3）驱动 ObjToSchematic，得到的 library 高度是 135 而不是 102。原因是把 **ObjToSchematic 的 `size` 误当成“目标格数”**。

### 2.2 ObjToSchematic 的 size 语义（关键坑）

`src/voxelisers/bvh-ray-voxeliser.ts`：

```ts
scale = (voxeliseParams.size - 1) / meshDimensions.y;   // axis y
```

即 **`size` 是要占用的格数，不是比例**，而缩放系数是 `(size-1)/原尺寸`。要得到精确 `mpp`：

```text
size = mpp × GLB高度 + 1
```

- 例：library GLB 高 37.905 → `size = 3×37.905 + 1 = 114.715`，`scale` 精确等于 3。
- 反之 `size = 3×34 = 102` 得到 `scale = (102-1)/37.905 = 2.665`，这正是早期偏小的根因。

`scripts/export-schem-3x.ts` 已封装该计算，会打印可直接执行的 ObjToSchematic 命令并回报 `resultingScale`。

---

## 3. 实测结果

运行环境：Windows / Node v22.22.3 / Python 3.14.5 / Java 17.0.12
管线：`scripts/export-models.ts` → ObjToSchematic `run-headless.ts`（Sponge `.schem`）→ `tools/schem-to-litematic.ts`（`.litematic`）

| 区域 | GLB 边界(米) ×3 | `.schem` 尺寸 | `.litematic` 体积 | non-air | 调色板 | 逐体素误差 |
|---|---|---|---|---|---|---|
| library | 272.1×113.7×247.0 | 273×115×249 | 7,817,355 | 482,759 | 125 | **0** |
| cricket | 400.4×39.0×389.1 | 401×40×391 | 6,271,640 | 157,252 | 80 | **0** |
| gym | 654.2×89.3×383.0 | 655×91×383 | 22,828,715 | 796,121 | 140 | **0** |
| culture | 210.6×57.4×300.6 | 211×59×301 | 3,747,149 | 348,004 | 91 | **0** |
| south-gate | 909.9×99.7×555.9 | 911×101×556 | 51,158,116 | 1,371,233 | 161 | **0** |

Schem 尺寸与 `GLB×3` 的差（多为 +1~2 格）来自体素器 `floor/ceil` 的**边界取整**，比例本身是精确的 3.000000000（脚本已断言 `resultingScale: 3` 且尺寸一致）。

### 3.1 修复的致命缺陷：ObjToSchematic 忽略节点变换

`ObjToSchematic/src/importers/gltf_loader.ts` 的 glTF 导入器**只读 primitive 的原始 `POSITION` 缓冲，完全忽略 `node.translation/rotation/scale`**。

- library/cricket/gym/culture 导出于原点、无旋转，侥幸正常；
- **south-gate 与整个 campus** 把每栋楼的 `position`/`rotation` 放在节点上，直接导入会全部坍缩到原点并丢失朝向。实测 south-gate 被压成 733×101×414（应为 911×101×556）。

修复：`scripts/export-models.ts` 在导出前调用 `mergeScene()`（`src/scene/geometry.ts`），先把**世界矩阵烘焙进顶点**，再交给 `GLTFExporter`。输出与导入器能力解耦，对归零模型无损、对多楼群组修复。

---

## 4. 双重独立校验

### 4.1 `.litematic` — litemapy 全量逐体素

`tools/verify-litematic.py`（litemapy 0.11.0b0）把 `.litematic` 与源 `.schem` 按 `(x,y,z)` 对齐后逐体素比对：

```text
library     273x115x249  vol=7817355   mismatch=0  palette=125  nonAir=482759
cricket     401x40x391   vol=6271640   mismatch=0  palette=80   nonAir=157252
gym         655x91x383   vol=22828715  mismatch=0  palette=140  nonAir=796121
culture     211x59x301   vol=3747149   mismatch=0  palette=91   nonAir=348004
south-gate  911x101x556  vol=51158116  mismatch=0  palette=161  nonAir=1371233
```

### 4.2 `.schem` — EngineHub SchematicJS

`@enginehub/schematicjs`（Sponge 规范作者方）独立加载，全部 5 个文件 `format = {type: sponge, version: 2}`、`dataVersion = 3105`，non-air 计数与 4.1 完全一致 → 输出是**标准 Sponge v2**，非自造格式。

### 4.3 转换器保真策略

`tools/schem-to-litematic.ts` 只做索引搬运，不做二次体素化或重新配色：

- Sponge 顺序 `x + z*W + y*W*L` 与 Litematica 顺序 `y*W*L + z*W + x` 数值等价，无需轴重排；
- 仅把空气重映射到调色板槽 0（Litematica 要求）；
- 保留 block-state properties；
- 写出完整 Metadata（EnclosingSize / Author / Description / Name / RegionCount / TimeCreated / TotalBlocks / TotalVolume / PreviewImageData）。

验证链：`tools/verify-litematic.py` + `tools/verify-schem-enginehub.ts`。

---

## 5. 复现步骤

```powershell
# 1) 导出模型（自动烘焙世界变换）
npx.cmd tsx scripts/export-models.ts

# 2) 计算并打印精确 3:1 的 OTS 命令（不会自行调用 OTS）
npx.cmd tsx scripts/export-schem-3x.ts --input models/library.glb `
    --output output/mc-library-3x/output.schem

# 3) 按打印的命令运行 ObjToSchematic（size = 3*GLB高 + 1）
#    require-hook.cjs 提供 Node 端 FileReader/资源加载垫片（文件名是纯 ASCII）
npx.cmd ts-node --files --require ./tools/require-hook.cjs tools/run-headless.ts `
    "..\gdut-campus-atlas\models\library.glb" "..\gdut-campus-atlas\output\mc-library-3x" `
    schem --size 114.714996 --axis y

# 4) 转 Litematica
npx.cmd tsx tools/schem-to-litematic.ts `
    output/mc-library-3x/output.schem output/mc-library-3x/library-3x.litematic --name library-3x

# 5) 双重校验
& 'D:\Cube GDUT\.venv-litemapy\Scripts\python.exe' tools\verify-litematic.py `
    output/mc-library-3x/library-3x.litematic --schem output/mc-library-3x/output.schem `
    --json output/mc-library-3x/litematic-verify.json
npx.cmd tsx tools/verify-schem-enginehub.ts
```

**依赖备注**

- ObjToSchematic 1.0 为 legacy；本仓库未内联该依赖，转换步骤 3 需在 OTS 检出目录执行。
- `@enginehub/schematicjs` 为 GPL-3.0，仅用于校验脚本，不能并入发布产物。

---

## 6. 全校园规划与边界

`gdut-campus.glb` 边界约 **1302 × 46 × 905 米**（969 网格 / 263 合并网格），3:1 后约 **3907 × 138 × 2716 ≈ 14.7 亿** 网格单元。

- **不要单文件转换**：`.litematic` 位数组与内存都会爆。
- 必须**分片**：按区域/网格块切分，共享同一世界原点，最后用 Litematica 的 `Region` 或分片投影拼接。
- 单次 OTS 实测：南门 5100 万体素尚可（约 1 分钟级），全校直接放大 28 倍不现实。
- 建议先以现有 5 个区域作为“可加载、可辨识”的交付样张，再扩展分片管线。

---

## 7. 已知信息损失点

ObjToSchematic 的路线是**颜色反推方块调色板 + 几何射线体素化**，必然有损：

1. **颜色映射**：Minecraft 方块色域有限，程序化材质（玻璃、金属、植被）被近似为羊毛/混凝土/矿石/木头等，调色板丰富不等同于还原度高。
2. **材质属性**：透明度、粗糙度、金属度、法线、发光（夜间模式）全部丢失，只保留平均色。
3. **朝向与细节**：楼梯/栏杆/细柱在 3:1 下可能不足 1 格而被抹平或糊成整块。
4. **block entity / 功能方块**：无实际功能，仅为视觉方块。
5. **动态与程序化内容**：glTF 路径本身不含动态对象；`exportModel('campus')` 也不含地形、道路、水面、程序化树木。

### 更高保真的替代路线

**推荐：项目原生语义体素化**，而不是“导出 GLB 再靠颜色猜方块”。

- 本项目几何由 `Parts.box/cylinder/beam` 等**带语义颜色**的构件组成，可直接在生成端体素化并映射到经挑选的方块集合。
- 例如外墙玻璃 → 有色玻璃/染色玻璃，草地 → 草方块，步道 → 对应石材，避免 `iron_ore`/`sculk` 这类纯按颜色撞上的方块。
- 代价是要自建 `统一世界坐标 → 分片体素化 → 语义调色板 → 写出` 管线；优点是**可解释、可分区、可增量**，也便于后续做真正的世界存档。

---

## 8. 产物清单（`output/`，已被 `.gitignore` 忽略）

每个 `output/mc-<id>-3x/` 含：

- `output.schem` — Sponge v2，ObjToSchematic 直出
- `<id>-3x.litematic` — Litematica v6，供游戏内投影
- `litematic-verify.json` — litemapy 逐体素校验结果
- `block-stats.json` — 尺寸 / 方块统计 / 调色板

## 9. 相关文档

- [`Minecraft-Litematica-可行性分析.md`](./Minecraft-Litematica-可行性分析.md) — 可行性总论与同类流程调研
- [`素材与简化说明.md`](./素材与简化说明.md) — 建模简化口径与素材来源