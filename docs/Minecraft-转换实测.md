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
- **全校园静态模型（地形+树木+全部建筑）已分片跑通 3:1**：6 个分片共 32,236,199 个非空气方块，合并后校园网格 **4431×142×3106**（含留白），`.litematic` 合计约 12.43 MB，全部逐体素 `mismatchCount: 0`。
- 6 个分片都在**同一共享校园坐标系**内，拼接表（`pasteOrigin`）见 `deliverables/full-campus-3x/manifest.json`；`.schem`/`.litematic` 内部仍是各自局部坐标。
- 真正的单文件上限不是“校园太大”，而是 **ObjToSchematic 单个进程的 `VoxelMesh` 哈希表**（约 1600 万体素即 `RangeError`）。因此按 3×2 网格分片；每片 ≤1.5 亿体素、≤500 万条非空气索引，均能跑通。
- 单文件整校仍不可行（约 14.7 亿网格单元），但**分片 + 共享原点的方案已全量产出**，不再只是可行性推测。

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

### 3.2 全校园静态分片（3×2 网格 @ 3:1）

在上节单栋验证通过后，`scripts/export-static-shards.ts` 把 `makeCampusModel()`（地形 + 程序化树木 + 全部已建建筑）在统一世界坐标下裁成 3（列）×2（行）网格，逐片跑 OTS → `indexed_json` → Sponge `.schem` → `.litematic`：

| 分片 | `.litematic` 尺寸 (X×Y×Z) | 非空气 | 调色板 | `.schem` | `.litematic` | 逐体素误差 |
|---|---|---:|---:|---:|---:|---:|
| central-north | 1477×141×1547 | 9,112,228 | 205 | 2.44 MB | 2.91 MB | **0** |
| west-north | 1477×99×1553 | 6,936,456 | 192 | 1.63 MB | 1.96 MB | **0** |
| east-middle | 1477×107×1505 | 6,704,334 | 184 | 1.75 MB | 2.09 MB | **0** |
| central-middle | 1477×121×1554 | 6,644,205 | 200 | 3.31 MB | 3.67 MB | **0** |
| west-middle | 1222×47×1424 | 1,458,287 | 106 | 0.90 MB | 1.25 MB | **0** |
| east-north | 946×99×1044 | 1,380,689 | 100 | 0.32 MB | 0.54 MB | **0** |
| **合计** | 校园网格 4431×142×3106 | **32,236,199** | — | **10.35 MB** | **12.43 MB** | **0** |

六个分片共享同一校园坐标系，但每个 `.schem`/`.litematic` 内部仍是**自身局部坐标**。拼接需要 `pasteOrigin`（局部 (0,0,0) 在校园网格中的绝对坐标）：

| 分片 | pasteOrigin (X,Y,Z) | 分片网格尺寸 |
|---|---|---|
| west-north | (-1797, -2, -1638) | 1477×99×1553 |
| central-north | (-320, -2, -1631) | 1477×141×1547 |
| east-north | (1157, -2, -1128) | 946×99×1044 |
| west-middle | (-1541, -2, -86) | 1222×47×1424 |
| central-middle | (-320, -3, -86) | 1477×121×1554 |
| east-middle | (1157, -3, -85) | 1477×107×1505 |

校园网格原点 `(-1797, -3, -1638)`，总尺寸 `4431×142×3106`。

**坐标系陷阱**：ObjToSchematic 的 `src/mesh.ts::_centreMesh` 会在体素化前把网格重新居中，所以每片的 `.schem`/`.litematic` 落在**自身局部原点**，不是校园坐标。`tools/finalize-shard-manifest.mjs` 从各片裁剪盒反推 `pasteOrigin = otsTightMin + round(centre_metres × mpp)`，并把旧脚本 `ceil(m)·mpp+1` 的**过高 1~2 格的估算尺寸**替换为导出的真实尺寸，写入 `output/static-shards/manifest.json`（并复制到 `deliverables/full-campus-3x/manifest.json`）。

单次 OTS 实测（Windows / Node v22.22.3）：

| 分片 | GLB | 三角面 | 体素化 | 合计 |
|---|---:|---:|---:|---:|
| central-north | 28.6 MB | 829,159 | 51.8 s | 98.6 s |
| west-north | 23.2 MB | 641,728 | 47.5 s | 83.3 s |
| east-middle | 12.9 MB | 355,671 | 30.9 s | 64.7 s |
| central-middle | 14.7 MB | 404,307 | 34.2 s | 69.3 s |
| east-north | 2.4 MB | 64,883 | 5.6 s | 14.4 s |
| west-middle | 1.5 MB | 39,959 | 5.7 s | 15.3 s |

逐体素校验（`tools/verify-litematic.py`，`.litematic` vs 源 `.schem`）每片耗时 136–502 s、峰值内存 1.2–1.7 GB；另有一个 1:1 整校对照文件（55,484,346 体素）在 79 s 内完成零误差比对。

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

`makeCampusModel()`（地形 + 程序化树木 + 全部已建建筑）边界约 **1477 × 47 × 1036 米**，3:1 后原始网格约 **4431×142×3106 ≈ 19.5 亿** 单元。为避免这个数字误导，注意两点：

- **网格上限 ≠ 体素内容**。ObjToSchematic 只体素化表面壳层，整校非空气方块合计 **32,236,199**（约 3200 万），`.litematic` 合计约 12.4 MB。
- **真正的单文件瓶颈是 OTS 单个进程的 `VoxelMesh`**（以 `Map` 存 32 位哈希，约 1600 万条目即 `RangeError`），不是校园面积。因此采用 3×2 = 6 分片；每片 ≤3.3 亿网格单元、≤920 万非空气方块，实测均可跑通。

- 分片规则：在**统一世界坐标**下按 3（列）×2（行）网格裁剪，共享同一原点；各片 `.schem`/`.litematic` 保持局部坐标，靠 `pasteOrigin` 拼接（详见 §3.2 与 `deliverables/full-campus-3x/manifest.json`）。
- 单文件整校（约 14.7 亿网格单元）仍不可行，但**分片 + 共享原点的全量产出已完成**，不再是可行性推测。

---

## 6.5 Material-aware ???2026-09-25?

???? GLB ? ObjToSchematic ????????????????????????????? `wall`?`glass`?`roof`?`metal`?`wood`?`road`?`paving`?`water`?`grass`?`tree_trunk`?`tree_leaf`?`sport_surface` ????ObjToSchematic ????????????????????????????????????????????????????????????sculk ?????????

???????? `deliverables/full-campus-material-aware-3x/`?????????? 6 ???? `pasteOrigin`???? GLB ????????????????????????????? + ??????????? PBR ??????????????????? OTS ??????? atlas ???????????

???????ObjToSchematic ??????????? `tools/patch-ots-material-aware.py`???? `tools/run-material-aware-ots.ps1`?

## 7. 已知信息损失点

ObjToSchematic 的路线是**颜色反推方块调色板 + 几何射线体素化**，必然有损：

1. **颜色映射**：Minecraft 方块色域有限，程序化材质（玻璃、金属、植被）被近似为羊毛/混凝土/矿石/木头等，调色板丰富不等同于还原度高。
2. **材质属性**：透明度、粗糙度、金属度、法线、发光（夜间模式）全部丢失，只保留平均色。
3. **朝向与细节**：楼梯/栏杆/细柱在 3:1 下可能不足 1 格而被抹平或糊成整块。
4. **block entity / 功能方块**：无实际功能，仅为视觉方块。
5. **动态与程序化内容**：glTF 路径本身不含动态对象。注意 `makeCampusModel()`（本项目导出入口）**已包含**地形、道路、水面、程序化树木与全部已建建筑，本节分片结果就是它；但相机、灯光、雾、动态车辆、鹈鹕骑行者、标签等表现层对象仍不导出。

### 更高保真的替代路线

**当前交付用的是 GLB → ObjToSchematic 颜色反推路线**（已全量跑通）。若要把“玻璃→玻璃、草地→草方块”这类语义做准，可再走**项目原生语义体素化**：

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

**全校园静态分片**（已随仓库交付，见 `deliverables/full-campus-3x/`）：6 个分片各含 `<name>-3x.schem`、`<name>-3x.litematic`、`<name>-3x.litematic-verify.json`、`<name>-3x.block-stats.json`，外加 `manifest.json`（含 `campusGrid`、每片 `pasteOrigin`、真实 `voxelSize`）。这些文件与 `output/ots-*/` 源产物逐字节一致（SHA256 已核对）。

## 9. 相关文档

- [`Minecraft-Litematica-可行性分析.md`](./Minecraft-Litematica-可行性分析.md) — 可行性总论与同类流程调研
- [`素材与简化说明.md`](./素材与简化说明.md) — 建模简化口径与素材来源