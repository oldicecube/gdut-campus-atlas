import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * ObjToSchematic `indexed_json` -> Sponge Schematic v2 (.schem), streamed.
 *
 * Why this exists: ObjToSchematic's own SchemExporter allocates
 *   new Array<number>(width*height*length)
 * and then a varint-encoded copy of it. For a whole-district 3:1 shard that is
 * hundreds of millions of entries, so it dies with `RangeError: Invalid array
 * length`. The stock `indexed_json` exporter walks only the *non-air* blocks and
 * writes `[x,y,z,paletteIndex]`, which fits in memory comfortably.
 *
 * This reads that JSON, emits Sponge v2 BlockData varints for the whole
 * inclusive box, and never materialises the volume-sized grid. Air is every
 * palette slot the stream never mentions, which is exactly what a surface-only
 * voxelisation means.
 *
 * Index order is preserved: Sponge uses x + z*W + y*W*L, which is also the
 * order tools/schem-to-litematic.ts expects, so the resulting .litematic is
 * still a 1:1 palette copy.
 *
 * Usage:
 *   node tools/indexed-json-to-schem.mjs <in.json> <out.schem>
 */

const TAG = {byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10};

class ByteWriter {
  chunks = [];
  len = 0;
  push(b) { this.chunks.push(b); this.len += b.length; }
  u8(v) { this.push(Buffer.from([v & 0xff])); }
  i16(v) { const b = Buffer.allocUnsafe(2); b.writeInt16BE(v); this.push(b); }
  i32(v) { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v); this.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.i16(b.length); this.push(b); }
  result() { return Buffer.concat(this.chunks, this.len); }
}

/** Accumulates BlockData varints in 64 KiB chunks instead of one huge array. */
class VarintSink {
  chunks = [];
  len = 0;
  buf = Buffer.allocUnsafe(1 << 16);
  used = 0;
  total = 0;
  write(id) {
    this.total++;
    while ((id & -128) !== 0) { this._byte((id & 127) | 128); id >>>= 7; }
    this._byte(id & 127);
  }
  _byte(v) {
    if (this.used === this.buf.length) {
      this.chunks.push(this.buf); this.len += this.buf.length;
      this.buf = Buffer.allocUnsafe(1 << 16); this.used = 0;
    }
    this.buf[this.used++] = v & 0xff;
  }
  finish() {
    const tail = Buffer.from(this.buf.subarray(0, this.used));
    return this.chunks.length ? Buffer.concat([...this.chunks, tail], this.len + this.used) : tail;
  }
}

function splitBlockState(key) {
  const bracket = key.indexOf('[');
  const name = bracket === -1 ? key : key.slice(0, bracket);
  return {key, name: name.includes(':') ? name : 'minecraft:' + name};
}

export function convert(inFile, outFile) {
  const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const blocks = data.blocks;
  const xyzi = data.xyzi;
  if (!blocks || !xyzi) throw new Error('Not an indexed_json export: expected "blocks" and "xyzi"');

  // Palette slot 0 must be air (Sponge and Litematica both rely on it).
  const palette = [{key: 'minecraft:air', name: 'minecraft:air'}];
  const idBySource = new Map();
  for (const [k, v] of Object.entries(blocks)) {
    const entry = splitBlockState(v);
    if (entry.name === 'minecraft:air') { idBySource.set(Number(k), 0); continue; }
    idBySource.set(Number(k), palette.length);
    palette.push(entry);
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of xyzi) {
    if (b[0] < minX) minX = b[0]; if (b[0] > maxX) maxX = b[0];
    if (b[1] < minY) minY = b[1]; if (b[1] > maxY) maxY = b[1];
    if (b[2] < minZ) minZ = b[2]; if (b[2] > maxZ) maxZ = b[2];
  }
  const width = maxX - minX + 1, height = maxY - minY + 1, length = maxZ - minZ + 1;
  const volume = width * height * length;

  // Sort by Sponge index. The sort key stays in float64 range for our volumes.
  const keys = new Float64Array(xyzi.length);
  for (let i = 0; i < xyzi.length; i++) {
    const b = xyzi[i];
    keys[i] = ((b[1] - minY) * length + (b[2] - minZ)) * width + (b[0] - minX);
  }
  const order = Array.from({length: xyzi.length}, (_, i) => i).sort((a, b) => keys[a] - keys[b]);

  const sink = new VarintSink();
  let cursor = 0;
  const emitAir = (upto) => { while (cursor < upto) { sink.write(0); cursor++; } };
  for (const idx of order) {
    const b = xyzi[idx];
    const spongeIndex = ((b[1] - minY) * length + (b[2] - minZ)) * width + (b[0] - minX);
    emitAir(spongeIndex);
    sink.write(idBySource.get(b[3]) ?? 0);
    cursor = spongeIndex + 1;
  }
  emitAir(volume);
  const blockData = sink.finish();

  const paletteTags = [];
  for (const entry of palette) {
    const w = new ByteWriter();
    w.u8(TAG.compound);
    w.str('Name'); w.u8(TAG.string); w.str(entry.name);
    const bracket = entry.key.indexOf('[');
    if (bracket !== -1 && entry.key.endsWith(']')) {
      const props = [];
      for (const pair of entry.key.slice(bracket + 1, -1).split(',')) {
        const eq = pair.indexOf('=');
        if (eq > 0) props.push([pair.slice(0, eq), pair.slice(eq + 1)]);
      }
      if (props.length) {
        w.u8(TAG.compound); w.str('Properties');
        for (const [k, v] of props) { w.u8(TAG.string); w.str(k); w.u8(TAG.string); w.str(v); }
        w.u8(0);
      }
    }
    w.u8(0);
    paletteTags.push(w.result());
  }
  const paletteBody = Buffer.concat([Buffer.from([TAG.compound]), Buffer.alloc(4), ...paletteTags]);
  paletteBody.writeInt32BE(paletteTags.length, 1);

  const root = new ByteWriter();
  root.u8(TAG.compound); root.str('Schematic');
  root.u8(TAG.int); root.str('Version'); root.i32(2);
  root.u8(TAG.int); root.str('DataVersion'); root.i32(3105);
  root.u8(TAG.short); root.str('Width'); root.i16(width);
  root.u8(TAG.short); root.str('Height'); root.i16(height);
  root.u8(TAG.short); root.str('Length'); root.i16(length);
  root.u8(TAG.int); root.str('PaletteMax'); root.i32(palette.length);
  root.u8(TAG.compound); root.str('Palette'); root.push(paletteBody);
  root.u8(TAG.byteArray); root.str('BlockData'); root.i32(blockData.length); root.push(blockData);
  root.u8(0);

  fs.mkdirSync(path.dirname(outFile), {recursive: true});
  fs.writeFileSync(outFile, zlib.gzipSync(root.result(), {level: 6}));

  return {file: outFile, bytes: fs.statSync(outFile).size, width, height, length, volume, nonAir: xyzi.length, paletteEntries: palette.length};
}

if (process.argv[1] && process.argv[1].endsWith('indexed-json-to-schem.mjs')) {
  const positional = process.argv.slice(2);
  if (positional.length < 2) {
    console.error('Usage: node tools/indexed-json-to-schem.mjs <in.json> <out.schem>');
    process.exit(2);
  }
  console.log(JSON.stringify(convert(positional[0], positional[1]), null, 2));
}
