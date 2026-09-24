"""Independent verifier for a standard Litematica v6 .litematic file.

Loads the file with litemapy (a separate implementation from the writer in
tools/schem-to-litematic.ts) and, when given the source .schem, diffs every
voxel 1:1 to prove the conversion neither lost nor reordered blocks.

Memory note: the comparison works on integer palette indices, not on arrays of
block-state strings. A district-sized 3:1 shard holds ~300M voxels, and an
object array of strings for that volume costs many gigabytes; two int32 arrays
cost ~4 bytes/voxel each.

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


def decode_sponge_ids(raw: bytes, volume: int) -> np.ndarray:
    """Varint-decode Sponge BlockData straight into a preallocated int32 array."""
    ids = np.empty(volume, dtype=np.int32)
    index = 0
    value = 0
    shift = 0
    for byte in raw:
        value += (byte & 0x7F) << shift
        if byte & 0x80:
            shift += 7
            if shift > 35:
                raise ValueError("varint too long")
        else:
            if index >= volume:
                raise ValueError("more voxels than Width*Height*Length")
            ids[index] = value
            index += 1
            value = 0
            shift = 0
    if shift != 0:
        raise ValueError("truncated varint")
    if index != volume:
        raise ValueError(f"decoded {index} voxels, expected {volume}")
    return ids


def load_sponge(path: Path):
    """Return (W, H, L, {id: identifier}, int32 voxel ids) for a Sponge v2 .schem."""
    nbt = nbtlib.File.load(str(path), True)
    width = int(nbt["Width"])
    height = int(nbt["Height"])
    length = int(nbt["Length"])
    palette = {int(v): k for k, v in nbt["Palette"].items()}
    raw = bytes(b & 0xFF for b in nbt["BlockData"])
    ids = decode_sponge_ids(raw, width * height * length)
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
            text = json.dumps(report, ensure_ascii=False, indent=2)
            print(text)
            if args.json:
                Path(args.json).write_text(text, encoding="utf-8")
            return 1

        actual_ident = np.asarray([b.to_block_state_identifier() for b in palette], dtype=object)
        # Map each source palette id to the litematic palette index that carries
        # the identical block-state string. -1 marks a state with no counterpart.
        ident_to_index = {str(name): i for i, name in enumerate(actual_ident)}
        max_source_id = max(s_palette) if s_palette else 0
        source_to_litematic = np.full(max_source_id + 1, -1, dtype=np.int32)
        for pid, name in s_palette.items():
            source_to_litematic[pid] = ident_to_index.get(str(name), -1)
        if int(source_to_litematic.min()) < 0 and s_ids.size:
            missing = [name for pid, name in s_palette.items() if source_to_litematic[pid] < 0]
            report["error"] = f"{len(missing)} source block states are absent from the litematic palette"
            report["missingSample"] = missing[:5]
            text = json.dumps(report, ensure_ascii=False, indent=2)
            print(text)
            if args.json:
                Path(args.json).write_text(text, encoding="utf-8")
            return 1

        expected_ids = source_to_litematic[s_ids]
        # Sponge order x + z*W + y*W*L  ==  transpose(x,y,z) -> (y,z,x) flattened
        actual_ids = np.ascontiguousarray(np.transpose(blocks, (1, 2, 0))).reshape(-1)

        mismatch = expected_ids != actual_ids
        mismatch_count = int(np.count_nonzero(mismatch))
        sample = []
        if mismatch_count:
            positions = np.argwhere(mismatch.reshape(s_height, s_length, s_width))[:5]
            for y, z, x in positions:
                i = int((y * s_length + z) * s_width + x)
                sample.append({
                    "pos": [int(x), int(y), int(z)],
                    "expected": str(s_palette[int(s_ids[i])]),
                    "got": str(actual_ident[int(actual_ids[i])]),
                })

        report["voxelDiff"] = {
            "sourceCount": int(s_ids.size),
            "litematicCount": int(actual_ids.size),
            "mismatchCount": mismatch_count,
            "sample": sample,
        }
        if mismatch_count or s_ids.size != actual_ids.size:
            status = 1

    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8")
    return status


if __name__ == "__main__":
    sys.exit(main())
