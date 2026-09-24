# 3:1 Minecraft 投影产物

按 **3 方块 = 1 米** 生成的广工大学城示例区域投影。转换与校验方法见
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
- 全校约 3907×138×2716 格，需分片，勿单文件整体转换。