# 3:1 Minecraft 投影产物（单栋样例 + 全校园分片）

按 **3 方块 = 1 米** 生成的广工大学城 Minecraft 投影：既有 5 个单栋/组团样张，也有全校园 3×2 分片。转换与校验方法见
[`docs/Minecraft-转换实测.md`](../docs/Minecraft-转换实测.md)。

| 文件 | 格式 | 尺寸 (X×Y×Z) | 说明 |
|---|---|---|---|
| `library-3x.*` | Sponge v2 `.schem` + Litematica v6 | 273×115×249 | 图书馆「工大魔方」 |
| `cricket-3x.*` | 同上 | 401×40×391 | 板球场 |
| `gym-3x.*` | 同上 | 655×91×383 | 体育馆 |
| `culture-3x.*` | 同上 | 211×59×301 | 文化活动中心 |
| `south-gate-3x.*` | 同上 | 911×101×556 | 南门组团 |

每个区域含：

- `<id>-3x.schem` — Sponge v2，可由 WorldEdit / FAWE / 各类工具载入
- `<id>-3x.litematic` — Litematica v6，游戏内投影用
- `<id>-3x.litematic-verify.json` — litemapy 逐体素校验结果，全部 `mismatchCount: 0`

## 使用

- **Litematica**：把 `.litematic` 放入 `.minecraft/schematics/`，游戏内 `M` 打开投影菜单加载。
- **WorldEdit / FAWE**：`//schem load <name>` 后 `//paste`（`.schem` 放入 `plugins/WorldEdit/schematics/`）。

尺寸为 3 方块/米；若希望 1:1，可在粘贴时按比例缩放或用 Litematica 的缩放功能。

## 注意

- 比例基准是运行时校准后的建筑尺寸（如 library 为 55×55×34 米）。
- 方块是**视觉近似**：材质、透明度、发光、朝向与方块实体不保留，详见实测文档第 7 节。
- 整校静态模型（地形+道路+水面+树木+全部建筑）**已按 3:1 全量分片跑通**：6 个分片、共 32,236,199 个非空气方块、逐体素 `mismatchCount: 0`。见 `full-campus-3x/`。

## ???????????`full-campus-material-aware-3x/`?

????????????? `full-campus-material-aware-3x/`????????????????????????????????????????????????????????? Minecraft ???????????????????????????????????

????????????????? 3:1 ???6 ???? `pasteOrigin`?????????????????????? [`full-campus-material-aware-3x/README.md`](full-campus-material-aware-3x/README.md)?

???????????????GLB ????????????????????????????????????? + ????????????????

## 全校园分片（`full-campus-3x/`）

| 分片 | 尺寸 (X×Y×Z) | 非空气 | `pasteOrigin` (X,Y,Z) |
|---|---|---:|---|
| `central-north-3x.*` | 1477×141×1547 | 9,112,228 | (-320, -2, -1631) |
| `west-north-3x.*` | 1477×99×1553 | 6,936,456 | (-1797, -2, -1638) |
| `east-middle-3x.*` | 1477×107×1505 | 6,704,334 | (1157, -3, -85) |
| `central-middle-3x.*` | 1477×121×1554 | 6,644,205 | (-320, -3, -86) |
| `west-middle-3x.*` | 1222×47×1424 | 1,458,287 | (-1541, -2, -86) |
| `east-north-3x.*` | 946×99×1044 | 1,380,689 | (1157, -2, -1128) |

每片含 `<name>-3x.schem`、`<name>-3x.litematic`、`<name>-3x.litematic-verify.json`、`<name>-3x.block-stats.json`。

- `manifest.json` 给出共享校园网格：原点 `(-1797, -3, -1638)`、总尺寸 `4431×142×3106`，以及每片的 `pasteOrigin`。
- **`.schem`/`.litematic` 内部是各自局部坐标**（ObjToSchematic 会重新居中网格）。摆放时把第 i 片粘贴到其 `pasteOrigin` 即可无缝拼合，不要全部粘到同一原点。
- 单文件整校仍不可行（约 14.7 亿网格单元）；分片是唯一可行方式。
