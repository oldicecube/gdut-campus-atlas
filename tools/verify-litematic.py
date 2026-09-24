"""Independent verifier for a standard Litematica v6 .litematic file.

Loads the file with litemapy (a separate implementation from the writer in
tools/schem-to-litematic.ts) and, when given the source .schem, diffs every
voxel 1:1 to prove the conversion neither lost nor reordered blocks.

Usage:
    python tools/verify-litematic.py <file.litematic> [--schem source.schem] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import nbtlib
from litemapy import Schematic


def load_sponge(path: Path):
    """Return (W, H, L, palette_by_id, voxel_ids) for a Sponge v2 .schem."""
    nbt = nbtlib.File.load(str(path), True)
    width = int(nbt["Width"])
    height = int(nbt["Height"])
    length = int(nbt["Length"])
    palette = {int(v): k for k, v in nbt["Palette"].items()}

    raw = bytes(b & 0xFF for b in nbt["BlockData"])
    ids: list[int] = []
    value = 0
    shift = 0
    for byte in raw:
        value += (byte & 0x7F) << shift
        if byte & 0x80:
            shift += 7
            if shift > 35:
                raise ValueError("varint too long")
        else:
            ids.append(value)
            value = 0
            shift = 0
    if shift != 0:
        raise ValueError("truncated varint")
    return width, height, length, palette, ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("litematic")
    parser.add_argument("--schem")
    parser.add_argument("--json")
    args = parser.parse_args()

    path = Path(args.litematic)
    schem = Schematic.load(str(path))
    region = next(iter(schem.regions.values()))
    blocks = region._Region__blocks           # numpy (x, y, z) palette indices
    palette = region._Region__palette         # list[BlockState], index 0 = air

    report = {
        "file": str(path),
        "bytes": path.stat().st_size,
        "litematicaVersion": int(schem.lm_version),
        "subVersion": int(schem.lm_subversion),
        "minecraftDataVersion": int(schem.mc_version),
        "name": str(schem.name),
        "author": str(schem.author),
        "regionCount": len(schem.regions),
        "enclosingSize": {"x": int(schem.width), "y": int(schem.height), "z": int(schem.length)},
        "regionSize": {"x": int(region.width), "y": int(region.height), "z": int(region.length)},
        "regionPosition": {"x": int(region.x), "y": int(region.y), "z": int(region.z)},
        "paletteEntries": len(palette),
        "nonAirBlocks": int(region.count_blocks()),
        "volume": int(region.volume()),
    }

    status = 0
    if args.schem:
        s_width, s_height, s_length, s_palette, s_ids = load_sponge(Path(args.schem))
        if (s_width, s_height, s_length) != (int(region.width), int(region.height), int(region.length)):
            report["error"] = "size mismatch between source .schem and .litematic"
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1

        expected_ids = np.asarray(s_ids, dtype=np.int64)
        expected = np.empty(expected_ids.shape, dtype=object)
        for pid, name in s_palette.items():
            expected[expected_ids == pid] = name

        # Sponge order x + z*W + y*W*L  ==  transpose(x,y,z) -> (y,z,x) flattened
        actual_ids = np.transpose(blocks, (1, 2, 0)).reshape(-1)
        actual_ident = np.asarray([b.to_block_state_identifier() for b in palette], dtype=object)
        actual = actual_ident[actual_ids]

        mismatch = expected != actual
        mismatch_count = int(mismatch.sum())
        sample = []
        if mismatch_count:
            positions = np.argwhere(mismatch.reshape(s_height, s_length, s_width))[:5]
            for y, z, x in positions:
                i = int((y * s_length + z) * s_width + x)
                sample.append({"pos": [int(x), int(y), int(z)], "expected": str(expected[i]), "got": str(actual[i])})

        report["voxelDiff"] = {
            "sourceCount": len(s_ids),
            "litematicCount": int(actual.size),
            "mismatchCount": mismatch_count,
            "sample": sample,
        }
        if mismatch_count or len(s_ids) != actual.size:
            status = 1

    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8")
    return status


if __name__ == "__main__":
    sys.exit(main())