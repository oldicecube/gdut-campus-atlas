import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Converts a Sponge Schematic v2 (.schem, as written by ObjToSchematic) into a
// standard Litematica v6 .litematic file.
//
// Fidelity strategy:
//  - No re-voxelisation and no re-colouring. The Sponge block index array is
//    copied 1:1 into the Litematica palette + bit array. The only transform is
//    re-indexing so that palette slot 0 is air (required by Litematica).
//  - Sponge order (x + z*W + y*W*L) equals Litematica order (y*W*L + z*W + x),
//    so no axis reshuffle is needed.
//  - Block-state properties are preserved.
//  - Verify the result independently with tools/verify-litematic.py.
//
// Usage:
//   npx tsx tools/schem-to-litematic.ts <in.schem> <out.litematic> [--name N] [--author A]

type NbtTag =
  | {t: 'byte'; v: number}
  | {t: 'short'; v: number}
  | {t: 'int'; v: number}
  | {t: 'long'; v: bigint}
  | {t: 'float'; v: number}
  | {t: 'double'; v: number}
  | {t: 'byteArray'; v: number[]}
  | {t: 'string'; v: string}
  | {t: 'list'; of: number; v: NbtTag[]}
  | {t: 'compound'; v: {[key: string]: NbtTag}}
  | {t: 'intArray'; v: number[]}
  | {t: 'longArray'; v: bigint[]};

const TAG_ID: {[K in NbtTag['t']]: number} = {
  byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6,
  byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12,
};

class ByteWriter {
  private chunks: Buffer[] = [];
  private len = 0;
  private push(b: Buffer) { this.chunks.push(b); this.len += b.length; }
  u8(v: number) { this.push(Buffer.from([v & 0xff])); }
  i16(v: number) { const b = Buffer.allocUnsafe(2); b.writeInt16BE(v); this.push(b); }
  i32(v: number) { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v); this.push(b); }
  i64(v: bigint) { const b = Buffer.allocUnsafe(8); b.writeBigInt64BE(BigInt.asIntN(64, v)); this.push(b); }
  f32(v: number) { const b = Buffer.allocUnsafe(4); b.writeFloatBE(v); this.push(b); }
  f64(v: number) { const b = Buffer.allocUnsafe(8); b.writeDoubleBE(v); this.push(b); }
  str(s: string) { const b = Buffer.from(s, 'utf8'); if (b.length > 0xffff) throw new Error('NBT string too long'); this.i16(b.length); this.push(b); }
  result() { return Buffer.concat(this.chunks, this.len); }
}

function writeTag(w: ByteWriter, tag: NbtTag) {
  switch (tag.t) {
    case 'byte': w.u8(tag.v); break;
    case 'short': w.i16(tag.v); break;
    case 'int': w.i32(tag.v); break;
    case 'long': w.i64(tag.v); break;
    case 'float': w.f32(tag.v); break;
    case 'double': w.f64(tag.v); break;
    case 'byteArray': w.i32(tag.v.length); for (const b of tag.v) w.u8(b); break;
    case 'intArray': w.i32(tag.v.length); for (const n of tag.v) w.i32(n); break;
    case 'longArray': w.i32(tag.v.length); for (const n of tag.v) w.i64(n); break;
    case 'string': w.str(tag.v); break;
    case 'list': w.u8(tag.of); w.i32(tag.v.length); for (const child of tag.v) writeTag(w, child); break;
    case 'compound': {
      for (const key of Object.keys(tag.v)) {
        const child = tag.v[key];
        w.u8(TAG_ID[child.t]); w.str(key); writeTag(w, child);
      }
      w.u8(0);
      break;
    }
  }
}

function encodeNbt(rootName: string, root: NbtTag): Buffer {
  const w = new ByteWriter();
  w.u8(10); w.str(rootName); writeTag(w, root);
  return w.result();
}

type Compound = {[key: string]: unknown};

class NbtReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  private take(n: number) {
    const v = this.buf.subarray(this.offset, this.offset + n);
    if (v.length !== n) throw new Error('Truncated NBT');
    this.offset += n;
    return v;
  }
  private str() { const n = this.take(2).readUInt16BE(0); return this.take(n).toString('utf8'); }
  private payload(type: number): unknown {
    switch (type) {
      case 1: return this.take(1).readInt8(0);
      case 2: return this.take(2).readInt16BE(0);
      case 3: return this.take(4).readInt32BE(0);
      case 4: return this.take(8).readBigInt64BE(0);
      case 5: return this.take(4).readFloatBE(0);
      case 6: return this.take(8).readDoubleBE(0);
      case 7: { const n = this.take(4).readInt32BE(0); return [...this.take(n)].map(b => (b > 127 ? b - 256 : b)); }
      case 8: return this.str();
      case 9: { const t = this.take(1).readUInt8(0); const n = this.take(4).readInt32BE(0); return Array.from({length: n}, () => this.payload(t)); }
      case 10: { const out: Compound = {}; for (;;) { const t = this.take(1).readUInt8(0); if (t === 0) return out; out[this.str()] = this.payload(t); } }
      case 11: { const n = this.take(4).readInt32BE(0); return Array.from({length: n}, () => this.take(4).readInt32BE(0)); }
      case 12: { const n = this.take(4).readInt32BE(0); return Array.from({length: n}, () => this.take(8).readBigInt64BE(0)); }
      default: throw new Error(`Unsupported NBT tag ${type}`);
    }
  }
  root(): Compound {
    const t = this.take(1).readUInt8(0);
    if (t !== 10) throw new Error(`Root is not compound: ${t}`);
    this.str();
    return this.payload(10) as Compound;
  }
}

function readSchem(file: string): Compound {
  return new NbtReader(zlib.gunzipSync(fs.readFileSync(file))).root();
}

function decodeVarints(bytes: number[]): number[] {
  const out: number[] = [];
  let value = 0, shift = 0;
  for (const raw of bytes) {
    const b = raw & 0xff;
    value += (b & 0x7f) * 2 ** shift;
    if (b & 0x80) {
      shift += 7;
      if (shift > 35) throw new Error('Varint is too long');
    } else {
      out.push(value);
      value = 0;
      shift = 0;
    }
  }
  if (shift !== 0) throw new Error('Truncated varint');
  return out;
}

type PaletteEntry = {name: string; properties: Record<string, string>};

function parseBlockState(key: string): PaletteEntry {
  const bracket = key.indexOf('[');
  if (bracket === -1) return {name: key, properties: {}};
  const name = key.slice(0, bracket);
  const body = key.slice(bracket + 1, key.lastIndexOf(']'));
  const properties: Record<string, string> = {};
  for (const pair of body.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) properties[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return {name, properties};
}

function bitsNeeded(count: number): number {
  let bits = 1;
  while ((1 << bits) < count) bits++;
  return Math.max(bits, 2);
}

type Summary = {
  size: [number, number, number];
  volume: number;
  paletteEntries: number;
  bitsPerBlock: number;
  nonAirBlocks: number;
  dataVersion: number;
  longs: number;
};

function convert(schem: Compound, name: string, author: string): {buffer: Buffer; summary: Summary} {
  const width = Number(schem.Width);
  const height = Number(schem.Height);
  const length = Number(schem.Length);
  if (![width, height, length].every(Number.isInteger) || width <= 0 || height <= 0 || length <= 0) {
    throw new Error(`Invalid schematic size ${width}x${height}x${length}`);
  }
  const volume = width * height * length;

  const sourcePalette = schem.Palette as {[key: string]: number};
  if (!sourcePalette || typeof sourcePalette !== 'object') throw new Error('Missing Palette');
  const maxSourceId = Math.max(...Object.values(sourcePalette).map(Number));
  const bySourceId: (PaletteEntry | undefined)[] = Array.from({length: maxSourceId + 1});
  for (const [key, value] of Object.entries(sourcePalette)) {
    const id = Number(value);
    if (bySourceId[id]) throw new Error(`Duplicate palette id ${id}`);
    bySourceId[id] = parseBlockState(key);
  }
  for (let i = 0; i <= maxSourceId; i++) {
    if (!bySourceId[i]) throw new Error(`Palette is not contiguous; missing id ${i}`);
  }

  const ids = decodeVarints(schem.BlockData as number[]);
  if (ids.length !== volume) {
    throw new Error(`Decoded ${ids.length} voxels, expected ${volume} for ${width}x${height}x${length}`);
  }

  const entries = bySourceId as PaletteEntry[];
  const airSourceId = entries.findIndex(e => e.name === 'minecraft:air');
  if (airSourceId === -1) throw new Error('Palette has no minecraft:air entry');
  const order = [airSourceId, ...entries.map((_, i) => i).filter(i => i !== airSourceId)];
  const remap = new Map<number, number>();
  order.forEach((sourceId, newId) => remap.set(sourceId, newId));
  const palette = order.map(sourceId => entries[sourceId]);

  const remapped = new Int32Array(ids.length);
  let nonAir = 0;
  for (let i = 0; i < ids.length; i++) {
    const newId = remap.get(ids[i]);
    if (newId === undefined) throw new Error(`Voxel palette id ${ids[i]} has no palette entry`);
    remapped[i] = newId;
    if (newId !== 0) nonAir++;
  }

  const bits = bitsNeeded(palette.length);
  const longCount = Math.ceil(volume * bits / 64);
  const longs = new Array<bigint>(longCount).fill(0n);
  const mask = (1n << BigInt(bits)) - 1n;
  for (let i = 0; i < remapped.length; i++) {
    const value = BigInt(remapped[i]);
    if (value === 0n) continue;
    const bitIndex = BigInt(i) * BigInt(bits);
    const arrIndex = Number(bitIndex >> 6n);
    const offset = Number(bitIndex & 63n);
    longs[arrIndex] |= (value & mask) << BigInt(offset);
    if (offset + bits > 64) longs[arrIndex + 1] |= value >> BigInt(64 - offset);
  }

  const now = BigInt(Date.now());
  const dataVersion = Number(schem.DataVersion ?? 3105);

  const paletteList: NbtTag = {
    t: 'list', of: 10,
    v: palette.map(entry => {
      const compound: {[key: string]: NbtTag} = {Name: {t: 'string', v: entry.name}};
      const propKeys = Object.keys(entry.properties);
      if (propKeys.length) {
        const props: {[key: string]: NbtTag} = {};
        for (const key of propKeys) props[key] = {t: 'string', v: entry.properties[key]};
        compound.Properties = {t: 'compound', v: props};
      }
      return {t: 'compound', v: compound} as NbtTag;
    }),
  };

  const region: NbtTag = {
    t: 'compound',
    v: {
      Position: {t: 'compound', v: {x: {t: 'int', v: 0}, y: {t: 'int', v: 0}, z: {t: 'int', v: 0}}},
      Size: {t: 'compound', v: {x: {t: 'int', v: width}, y: {t: 'int', v: height}, z: {t: 'int', v: length}}},
      BlockStatePalette: paletteList,
      Entities: {t: 'list', of: 10, v: []},
      TileEntities: {t: 'list', of: 10, v: []},
      PendingBlockTicks: {t: 'list', of: 10, v: []},
      PendingFluidTicks: {t: 'list', of: 10, v: []},
      BlockStates: {t: 'longArray', v: longs},
    },
  };

  const metadata: NbtTag = {
    t: 'compound',
    v: {
      EnclosingSize: {t: 'compound', v: {x: {t: 'int', v: width}, y: {t: 'int', v: height}, z: {t: 'int', v: length}}},
      Author: {t: 'string', v: author},
      Description: {t: 'string', v: 'Converted 1:1 from a Sponge schematic; 3 blocks per metre.'},
      Name: {t: 'string', v: name},
      Software: {t: 'string', v: 'gdut-campus-atlas schem-to-litematic'},
      RegionCount: {t: 'int', v: 1},
      TimeCreated: {t: 'long', v: now},
      TimeModified: {t: 'long', v: now},
      TotalBlocks: {t: 'int', v: nonAir},
      TotalVolume: {t: 'int', v: volume},
      PreviewImageData: {t: 'intArray', v: []},
    },
  };

  const root: NbtTag = {
    t: 'compound',
    v: {
      Version: {t: 'int', v: 6},
      SubVersion: {t: 'int', v: 1},
      MinecraftDataVersion: {t: 'int', v: dataVersion},
      Metadata: metadata,
      Regions: {t: 'compound', v: {main: region}},
    },
  };

  return {
    buffer: zlib.gzipSync(encodeNbt('', root)),
    summary: {size: [width, height, length], volume, paletteEntries: palette.length, bitsPerBlock: bits, nonAirBlocks: nonAir, dataVersion, longs: longCount},
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: {[key: string]: string} = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { opts[args[i]] = args[++i]; }
    else positional.push(args[i]);
  }
  if (positional.length < 2) {
    console.error('Usage: npx tsx tools/schem-to-litematic.ts <in.schem> <out.litematic> [--name N] [--author A]');
    process.exit(2);
  }
  return {
    input: path.resolve(positional[0]),
    output: path.resolve(positional[1]),
    name: opts['--name'] ?? path.basename(positional[1], '.litematic'),
    author: opts['--author'] ?? 'gdut-campus-atlas',
  };
}

const args = parseArgs();
const {buffer, summary} = convert(readSchem(args.input), args.name, args.author);
fs.mkdirSync(path.dirname(args.output), {recursive: true});
fs.writeFileSync(args.output, buffer);
console.log(JSON.stringify({input: args.input, output: args.output, bytes: buffer.length, ...summary}, null, 2));