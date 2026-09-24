import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Converts a Sponge Schematic v2 (.schem, as written by ObjToSchematic) into a
// standard Litematica v6 .litematic file.
//
// Fidelity strategy:
//  - No re-voxelisation and no re-colouring. The Sponge block index stream is
//    copied 1:1 into the Litematica palette + bit array. The only transform is
//    re-indexing so that palette slot 0 is air (required by Litematica).
//  - Sponge order (x + z*W + y*W*L) equals Litematica order (y*W*L + z*W + x),
//    so no axis reshuffle is needed.
//  - Block-state properties are preserved.
//  - Verify the result independently with tools/verify-litematic.py.
//
// Capacity: the previous implementation decoded the whole volume into JS
// number[]/bigint[] arrays, which is ~40 bytes per voxel and dies with
// "invalid array length" on whole-district 3:1 shards (118M voxels). This
// version streams the varint block data straight into a flat LSB-first bit
// buffer, so peak extra memory is ~2 bytes per voxel and the only per-voxel
// work is bit masking. A district-sized shard converts in seconds.
//
// Usage:
//   npx tsx tools/schem-to-litematic.ts <in.schem> <out.litematic> [--name N] [--author A]

const TAG = {byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12};

class ByteWriter {
  private chunks: Buffer[] = [];
  private len = 0;
  push(b: Buffer) { this.chunks.push(b); this.len += b.length; }
  u8(v: number) { this.push(Buffer.from([v & 0xff])); }
  i16(v: number) { const b = Buffer.allocUnsafe(2); b.writeInt16BE(v); this.push(b); }
  i32(v: number) { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v); this.push(b); }
  i64(v: bigint) { const b = Buffer.allocUnsafe(8); b.writeBigInt64BE(BigInt.asIntN(64, v)); this.push(b); }
  str(s: string) { const b = Buffer.from(s, 'utf8'); if (b.length > 0xffff) throw new Error('NBT string too long'); this.i16(b.length); this.push(b); }
  result() { return Buffer.concat(this.chunks, this.len); }
}

function skipPayload(type: number, off: number, buf: Buffer): number {
  switch (type) {
    case TAG.byte: return off + 1;
    case TAG.short: return off + 2;
    case TAG.int: case TAG.float: return off + 4;
    case TAG.long: case TAG.double: return off + 8;
    case TAG.byteArray: case TAG.intArray: case TAG.longArray: {
      const n = buf.readInt32BE(off); off += 4;
      const width = type === TAG.byteArray ? 1 : type === TAG.intArray ? 4 : 8;
      return off + n * width;
    }
    case TAG.string: { const n = buf.readUInt16BE(off); return off + 2 + n; }
    case TAG.list: {
      let childType = buf.readUInt8(off); off += 1;
      const n = buf.readInt32BE(off); off += 4;
      for (let i = 0; i < n; i++) off = skipPayload(childType, off, buf);
      return off;
    }
    case TAG.compound: {
      for (;;) {
        const t = buf.readUInt8(off); off += 1;
        if (t === 0) return off;
        const nameLen = buf.readUInt16BE(off); off += 2 + nameLen;
        off = skipPayload(t, off, buf);
      }
    }
    default: throw new Error(`Unsupported NBT tag ${type}`);
  }
}

function readString(off: number, buf: Buffer) { const n = buf.readUInt16BE(off); return {value: buf.subarray(off + 2, off + 2 + n).toString('utf8'), next: off + 2 + n}; }

type SchemHeader = {
  width: number; height: number; length: number; dataVersion: number;
  palette: {[key: string]: number};
  blockDataOffset: number; blockDataLength: number;
};

function parseSchem(buf: Buffer): SchemHeader {
  const rootType = buf.readUInt8(0);
  if (rootType !== TAG.compound) throw new Error(`Expected compound root, got ${rootType}`);
  let off = 1;
  const rootName = readString(off, buf); off = rootName.next;
  const header: Partial<SchemHeader> = {};
  for (;;) {
    const t = buf.readUInt8(off); off += 1;
    if (t === 0) break;
    const field = readString(off, buf); off = field.next;
    const name = field.value;
    if (name === 'Width') { header.width = buf.readInt16BE(off); off += 2; continue; }
    if (name === 'Height') { header.height = buf.readInt16BE(off); off += 2; continue; }
    if (name === 'Length') { header.length = buf.readInt16BE(off); off += 2; continue; }
    if (name === 'DataVersion') { header.dataVersion = buf.readInt32BE(off); off += 4; continue; }
    if (name === 'Palette') {
      const palette: {[key: string]: number} = {};
      for (;;) {
        const pt = buf.readUInt8(off); off += 1;
        if (pt === 0) break;
        if (pt !== TAG.int) throw new Error(`Palette value must be an Int tag, got ${pt}`);
        const key = readString(off, buf); off = key.next;
        palette[key.value] = buf.readInt32BE(off); off += 4;
      }
      header.palette = palette;
      continue;
    }
    if (name === 'BlockData') {
      const n = buf.readInt32BE(off); off += 4;
      header.blockDataOffset = off; header.blockDataLength = n;
      off += n;
      continue;
    }
    off = skipPayload(t, off, buf);
  }
  if (header.width === undefined || header.height === undefined || header.length === undefined
    || !header.palette || header.blockDataOffset === undefined) {
    throw new Error('Schematic is missing Width/Height/Length/Palette/BlockData');
  }
  return header as SchemHeader;
}

const bitsNeeded = (count: number) => { let bits = 1; while ((1 << bits) < count) bits++; return Math.max(bits, 2); };

function parseBlockState(key: string) {
  const bracket = key.indexOf('[');
  if (bracket === -1) return {name: key, properties: {} as Record<string, string>};
  const name = key.slice(0, bracket);
  const properties: Record<string, string> = {};
  for (const pair of key.slice(bracket + 1, key.lastIndexOf(']')).split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) properties[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return {name, properties};
}

function writePaletteTag(w: ByteWriter, palette: {name: string; properties: Record<string, string>}[]) {
  w.u8(TAG.list); w.str('BlockStatePalette');
  w.u8(TAG.compound); w.i32(palette.length);
  for (const entry of palette) {
    w.u8(TAG.string); w.str('Name'); w.str(entry.name);
    const keys = Object.keys(entry.properties);
    if (keys.length) {
      w.u8(TAG.compound); w.str('Properties');
      for (const key of keys) { w.u8(TAG.string); w.str(key); w.u8(TAG.string); w.str(entry.properties[key]); }
      w.u8(0);
    }
    w.u8(0);
  }
}

const intTag = (name: string, v: number) => { const w = new ByteWriter(); w.u8(TAG.int); w.str(name); w.i32(v); return w.result(); };
const strTag = (name: string, v: string) => { const w = new ByteWriter(); w.u8(TAG.string); w.str(name); w.str(v); return w.result(); };
const longTag = (name: string, v: bigint) => { const w = new ByteWriter(); w.u8(TAG.long); w.str(name); w.i64(v); return w.result(); };
const emptyList = (name: string) => { const w = new ByteWriter(); w.u8(TAG.list); w.str(name); w.u8(TAG.compound); w.i32(0); return w.result(); };
const emptyIntArray = (name: string) => { const w = new ByteWriter(); w.u8(TAG.intArray); w.str(name); w.i32(0); return w.result(); };
const vecTag = (name: string, x: number, y: number, z: number) => {
  const w = new ByteWriter();
  w.u8(TAG.compound); w.str(name);
  w.u8(TAG.int); w.str('x'); w.i32(x);
  w.u8(TAG.int); w.str('y'); w.i32(y);
  w.u8(TAG.int); w.str('z'); w.i32(z);
  w.u8(0);
  return w.result();
};

type Summary = {size: [number, number, number]; volume: number; paletteEntries: number; bitsPerBlock: number; nonAirBlocks: number; dataVersion: number; longs: number};

async function convert(inputFile: string, outputFile: string, name: string, author: string): Promise<Summary> {
  const raw = zlib.gunzipSync(fs.readFileSync(inputFile));
  const header = parseSchem(raw);
  const {width, height, length} = header;
  if (![width, height, length].every(Number.isInteger) || width <= 0 || height <= 0 || length <= 0) {
    throw new Error(`Invalid schematic size ${width}x${height}x${length}`);
  }
  const volume = width * height * length;

  const maxSourceId = Math.max(...Object.values(header.palette).map(Number));
  const bySourceId: ({name: string; properties: Record<string, string>} | undefined)[] = Array.from({length: maxSourceId + 1});
  for (const [key, value] of Object.entries(header.palette)) {
    const id = Number(value);
    if (bySourceId[id]) throw new Error(`Duplicate palette id ${id}`);
    bySourceId[id] = parseBlockState(key);
  }
  for (let i = 0; i <= maxSourceId; i++) if (!bySourceId[i]) throw new Error(`Palette is not contiguous; missing id ${i}`);
  const entries = bySourceId as {name: string; properties: Record<string, string>}[];

  const airSourceId = entries.findIndex(e => e.name === 'minecraft:air');
  if (airSourceId === -1) throw new Error('Palette has no minecraft:air entry');
  const order = [airSourceId, ...entries.map((_, i) => i).filter(i => i !== airSourceId)];
  const remap = new Int32Array(maxSourceId + 1);
  order.forEach((sourceId, newId) => { remap[sourceId] = newId; });
  const palette = order.map(sourceId => entries[sourceId]);

  const bits = bitsNeeded(palette.length);
  if (bits > 24) throw new Error(`bitsPerBlock ${bits} is above the supported range`);
  const longCount = Math.ceil(volume * bits / 64);
  // 8-byte-aligned flat LSB-first bit stream: long k occupies bytes [8k, 8k+8).
  const flat = Buffer.alloc(longCount * 8);

  // Varint-decode the Sponge block stream straight into `flat`, never
  // materialising one JS number per voxel.
  const data = raw.subarray(header.blockDataOffset, header.blockDataOffset + header.blockDataLength);
  let value = 0, shift = 0, index = 0, nonAir = 0;
  const totalBits = order.length;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    value += (b & 0x7f) * 2 ** shift;
    if (b & 0x80) {
      shift += 7;
      if (shift > 35) throw new Error('Varint is too long');
      continue;
    }
    if (value !== 0) {
      if (value >= totalBits) throw new Error(`Voxel palette id ${value} has no palette entry`);
      const newId = remap[value];
      if (newId !== 0) {
        nonAir++;
        const bitPos = index * bits;
        const byteIndex = bitPos >>> 3;
        const offset = bitPos & 7;
        const nBytes = (offset + bits + 7) >>> 3;
        let w = newId << offset;
        for (let k = 0; k < nBytes; k++) flat[byteIndex + k] |= (w >>> (8 * k)) & 0xff;
      }
    }
    index++;
    value = 0; shift = 0;
  }
  if (shift !== 0 || value !== 0) throw new Error('Truncated varint');
  if (index !== volume) throw new Error(`Decoded ${index} voxels, expected ${volume} for ${width}x${height}x${length}`);

  const now = BigInt(Date.now());
  const dataVersion = Number(header.dataVersion ?? 3105);

  const head = new ByteWriter();
  head.u8(TAG.compound); head.str('');
  head.u8(TAG.int); head.str('Version'); head.i32(6);
  head.u8(TAG.int); head.str('SubVersion'); head.i32(1);
  head.u8(TAG.int); head.str('MinecraftDataVersion'); head.i32(dataVersion);
  head.u8(TAG.compound); head.str('Metadata');
  head.push(vecTag('EnclosingSize', width, height, length));
  head.push(strTag('Author', author));
  head.push(strTag('Description', 'Converted 1:1 from a Sponge schematic; 3 blocks per metre.'));
  head.push(strTag('Name', name));
  head.push(strTag('Software', 'gdut-campus-atlas schem-to-litematic'));
  head.push(intTag('RegionCount', 1));
  head.push(longTag('TimeCreated', now));
  head.push(longTag('TimeModified', now));
  head.push(intTag('TotalBlocks', nonAir));
  head.push(intTag('TotalVolume', volume));
  head.push(emptyIntArray('PreviewImageData'));
  head.u8(0);
  head.u8(TAG.compound); head.str('Regions');
  head.u8(TAG.compound); head.str('main');
  head.push(vecTag('Position', 0, 0, 0));
  head.push(vecTag('Size', width, height, length));
  head.u8(TAG.list); head.str('BlockStatePalette'); head.u8(TAG.compound); head.i32(palette.length);
  for (const entry of palette) {
    head.u8(TAG.string); head.str('Name'); head.str(entry.name);
    const keys = Object.keys(entry.properties);
    if (keys.length) {
      head.u8(TAG.compound); head.str('Properties');
      for (const key of keys) { head.u8(TAG.string); head.str(key); head.u8(TAG.string); head.str(entry.properties[key]); }
      head.u8(0);
    }
    head.u8(0);
  }
  head.push(emptyList('Entities'));
  head.push(emptyList('TileEntities'));
  head.push(emptyList('PendingBlockTicks'));
  head.push(emptyList('PendingFluidTicks'));
  head.u8(TAG.longArray); head.str('BlockStates'); head.i32(longCount);

  fs.mkdirSync(path.dirname(outputFile), {recursive: true});
  // Re-serialise each 8-byte LSB-first group as a big-endian int64, which is
  // exactly what an NBT long array stores.
  // The packed stream above is little-endian per 64-bit group; an NBT long
  // array stores big-endian int64. Reverse each 8-byte group in place, then
  // hand the whole buffer to one write call (reusing one Buffer across many
  // stream writes would alias, because streams retain the reference).
  for (let k = 0; k < longCount; k++) {
    const base = k * 8;
    for (let j = 0; j < 4; j++) {
      const a = flat[base + j], b = flat[base + 7 - j];
      flat[base + j] = b; flat[base + 7 - j] = a;
    }
  }

  const buf = Buffer.concat([head.result(), flat]);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outputFile);
    out.on('error', reject);
    out.on('finish', resolve);
    const gzip = zlib.createGzip({level: 6});
    gzip.on('error', reject);
    gzip.pipe(out);
    gzip.end(buf);
  });

  return {size: [width, height, length], volume, paletteEntries: palette.length, bitsPerBlock: bits, nonAirBlocks: nonAir, dataVersion, longs: longCount};
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
const summary = await convert(args.input, args.output, args.name, args.author);
console.log(JSON.stringify({input: args.input, output: args.output, bytes: fs.statSync(args.output).size, ...summary}, null, 2));
