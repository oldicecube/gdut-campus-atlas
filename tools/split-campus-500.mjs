import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {decode} from '@enginehub/nbt-ts';

const SOURCE_DIR = process.argv[2] ?? 'deliverables/full-campus-material-aware-3x';
const OUT_DIR = process.argv[3] ?? 'deliverables/full-campus-500x500';
const TILE = 500;
const RECORD_BYTES = 6; // uint32 packed position + uint16 global palette id
const RECORD_CHUNK = 1 << 20;

const manifest = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'manifest.json'), 'utf8'));
const origin = manifest.campusGrid.origin.map(Number);
const campusSize = manifest.campusGrid.size.map(Number);
const cols = Math.ceil(campusSize[0] / TILE);
const rows = Math.ceil(campusSize[2] / TILE);
const heightGlobal = campusSize[1];
const yOrigin = origin[1];
const tileFiles = new Map();
const tileStats = Array.from({length: rows}, (_, z) => Array.from({length: cols}, (_, x) => ({
  x, z, nonAir: 0, conflicts: 0, minY: Infinity, maxY: -Infinity,
})));

fs.mkdirSync(OUT_DIR, {recursive: true});
const recordsDir = path.join(OUT_DIR, '.records');
fs.rmSync(recordsDir, {recursive: true, force: true});
fs.mkdirSync(recordsDir, {recursive: true});

function tilePath(tx, tz) { return path.join(recordsDir, `x${String(tx).padStart(2, '0')}-z${String(tz).padStart(2, '0')}.bin`); }
function getTileWriter(tx, tz) {
  const key = `${tx},${tz}`;
  let w = tileFiles.get(key);
  if (!w) {
    const fd = fs.openSync(tilePath(tx, tz), 'w');
    w = {fd, buf: Buffer.allocUnsafe(RECORD_CHUNK), used: 0};
    tileFiles.set(key, w);
  }
  return w;
}
function writeRecord(tx, tz, packed, paletteId) {
  const w = getTileWriter(tx, tz);
  if (w.used + RECORD_BYTES > w.buf.length) {
    fs.writeSync(w.fd, w.buf, 0, w.used);
    w.used = 0;
  }
  w.buf.writeUInt32LE(packed >>> 0, w.used);
  w.buf.writeUInt16LE(paletteId, w.used + 4);
  w.used += RECORD_BYTES;
}
function closeWriters() {
  for (const w of tileFiles.values()) {
    if (w.used) fs.writeSync(w.fd, w.buf, 0, w.used);
    fs.closeSync(w.fd);
  }
  tileFiles.clear();
}
function readStateId(v) { return Number(v?.value ?? v); }
function decodeVarints(raw) {
  return raw;
}

const globalStates = ['minecraft:air'];
const globalStateId = new Map([['minecraft:air', 0]]);
function ensureState(state) {
  let id = globalStateId.get(state);
  if (id === undefined) {
    id = globalStates.length;
    globalStates.push(state);
    globalStateId.set(state, id);
  }
  return id;
}

let rawTotalNonAir = 0;
for (const shard of manifest.shards) {
  const file = path.join(SOURCE_DIR, `${shard.name}-3x.schem`);
  const root = decode(zlib.gunzipSync(fs.readFileSync(file)), {useMaps: true}).value;
  const width = readStateId(root.get('Width'));
  const height = readStateId(root.get('Height'));
  const length = readStateId(root.get('Length'));
  const paletteMap = root.get('Palette');
  const byId = [];
  let airId = 0;
  for (const [state, idTag] of paletteMap.entries()) {
    const id = readStateId(idTag);
    byId[id] = state;
    if (state === 'minecraft:air') airId = id;
  }
  const paletteRemap = byId.map(state => ensureState(state));
  const blockData = Buffer.from(root.get('BlockData'));
  const paste = shard.campusGrid.pasteOrigin.map(Number);
  const volume = width * height * length;
  let index = 0, value = 0, shift = 0;
  for (const byte of blockData) {
    value += (byte & 0x7f) * 2 ** shift;
    if (byte & 0x80) {
      shift += 7;
      continue;
    }
    const sourceId = value;
    if (sourceId !== airId) {
      const localX = index % width;
      const localZ = Math.floor(index / width) % length;
      const localY = Math.floor(index / (width * length));
      const gx = paste[0] + localX;
      const gy = paste[1] + localY;
      const gz = paste[2] + localZ;
      const tx = Math.floor((gx - origin[0]) / TILE);
      const tz = Math.floor((gz - origin[2]) / TILE);
      if (tx < 0 || tx >= cols || tz < 0 || tz >= rows) throw new Error(`block outside tile grid: ${gx},${gy},${gz}`);
      const lx = gx - (origin[0] + tx * TILE);
      const lz = gz - (origin[2] + tz * TILE);
      const ly = gy - yOrigin;
      if (lx < 0 || lx >= TILE || lz < 0 || lz >= TILE || ly < 0 || ly >= heightGlobal) throw new Error(`block outside global grid: ${gx},${gy},${gz}`);
      const packed = ((ly * TILE) + lz) * TILE + lx;
      writeRecord(tx, tz, packed, paletteRemap[sourceId]);
      const stat = tileStats[tz][tx];
      stat.nonAir++;
      stat.minY = Math.min(stat.minY, ly);
      stat.maxY = Math.max(stat.maxY, ly);
      rawTotalNonAir++;
    }
    index++;
    value = 0; shift = 0;
  }
  if (shift !== 0 || index !== volume) throw new Error(`bad BlockData in ${shard.name}: ${index}/${volume}`);
  console.log(`read ${shard.name}: ${width}x${height}x${length}`);
}
closeWriters();

function putVarint(bytes, id) {
  while ((id & -128) !== 0) { bytes.push((id & 127) | 128); id >>>= 7; }
  bytes.push(id & 0x7f);
}
function writeNbtString(bufs, text) {
  const b = Buffer.from(text, 'utf8');
  const x = Buffer.allocUnsafe(2); x.writeUInt16BE(b.length); bufs.push(x, b);
}
function tagHeader(bufs, type, name) { bufs.push(Buffer.from([type])); writeNbtString(bufs, name); }
function tagInt(bufs, name, value) { tagHeader(bufs, 3, name); const b = Buffer.allocUnsafe(4); b.writeInt32BE(value); bufs.push(b); }
function tagShort(bufs, name, value) { tagHeader(bufs, 2, name); const b = Buffer.allocUnsafe(2); b.writeInt16BE(value); bufs.push(b); }
function tagByteArray(bufs, name, bytes) { tagHeader(bufs, 7, name); const n = Buffer.allocUnsafe(4); n.writeInt32BE(bytes.length); bufs.push(n, Buffer.from(bytes)); }
function makeSchem(width, height, length, states, records) {
  const used = new Set([0]);
  for (const key of records) used.add(key % 1024);
  const usedIds = [...used].sort((a,b) => a-b);
  const localId = new Map(usedIds.map((globalId, i) => [globalId, i]));
  const paletteBody = [];
  for (const globalId of usedIds) { tagInt(paletteBody, states[globalId], localId.get(globalId)); }
  const volume = width * height * length;
  const blockBytes = [];
  let cursor = 0;
  for (const key of records) {
    const packed = Math.floor(key / 1024);
    const globalId = key % 1024;
    while (cursor < packed) { putVarint(blockBytes, 0); cursor++; }
    putVarint(blockBytes, localId.get(globalId));
    cursor = packed + 1;
  }
  while (cursor < volume) { putVarint(blockBytes, 0); cursor++; }
  const root = [];
  root.push(Buffer.from([10])); writeNbtString(root, 'Schematic');
  tagInt(root, 'Version', 2); tagInt(root, 'DataVersion', 3105);
  tagShort(root, 'Width', width); tagShort(root, 'Height', height); tagShort(root, 'Length', length);
  tagInt(root, 'PaletteMax', usedIds.length);
  tagHeader(root, 10, 'Palette'); root.push(...paletteBody, Buffer.from([0]));
  tagByteArray(root, 'BlockData', blockBytes);
  root.push(Buffer.from([0]));
  return zlib.gzipSync(Buffer.concat(root), {level: 6});
}

const tileManifest = {
  generated: new Date().toISOString(),
  source: SOURCE_DIR,
  blocksPerMetre: 3,
  tileSizeXZ: TILE,
  axisConvention: 'x increases west-to-east; z increases north-to-south; x00-z00 is the northwest tile; positive direction is NW to SE',
  campusGrid: {origin, size: campusSize, max: [origin[0]+campusSize[0], origin[1]+campusSize[1], origin[2]+campusSize[2]], cols, rows, tileHeightY: heightGlobal},
  totalNonAir: 0,
  rawNonAir: rawTotalNonAir,
  paletteEntriesGlobal: globalStates.length,
  tiles: [],
};

for (let tz = 0; tz < rows; tz++) {
  for (let tx = 0; tx < cols; tx++) {
    const stat = tileStats[tz][tx];
    const name = `campus-500-x${String(tx).padStart(2,'0')}-z${String(tz).padStart(2,'0')}`;
    const tileOriginX = origin[0] + tx * TILE;
    const tileOriginZ = origin[2] + tz * TILE;
    const recPath = tilePath(tx, tz);
    const recordKeys = [];
    if (fs.existsSync(recPath)) {
      const raw = fs.readFileSync(recPath);
      if (raw.length % RECORD_BYTES !== 0) throw new Error(`bad records ${recPath}`);
      for (let off = 0; off < raw.length; off += RECORD_BYTES) {
        const packed = raw.readUInt32LE(off);
        const stateId = raw.readUInt16LE(off + 4);
        recordKeys.push(packed * 1024 + stateId);
      }
      // Stable by position only: preserve first source-shard encounter for
      // boundary conflicts instead of choosing the numerically smallest
      // palette id. Node 22's Array#sort is stable.
      recordKeys.sort((a,b) => Math.floor(a / 1024) - Math.floor(b / 1024));
    }
    const dedup = [];
    let lastPacked = -1, lastState = -1;
    for (const key of recordKeys) {
      const packed = Math.floor(key / 1024);
      const state = key % 1024;
      if (packed === lastPacked) {
        if (state !== lastState) stat.conflicts++;
        continue;
      }
      dedup.push(key); lastPacked = packed; lastState = state;
    }
    const nonAir = dedup.length;
    const minY = nonAir ? stat.minY : 0;
    const maxY = nonAir ? stat.maxY : 0;
    const height = nonAir ? maxY - minY + 1 : 1;
    const shifted = nonAir ? dedup.map(key => {
      const packed = Math.floor(key / 1024);
      const state = key % 1024;
      const xz = packed % (TILE*TILE);
      const globalY = Math.floor(packed / (TILE*TILE));
      const localY = globalY - minY;
      return (localY * TILE*TILE + xz) * 1024 + state;
    }) : [];
    const schem = makeSchem(TILE, height, TILE, globalStates, shifted);
    tileManifest.totalNonAir += nonAir;
    const schemPath = path.join(OUT_DIR, `${name}.schem`);
    fs.writeFileSync(schemPath, schem);
    const litematicPath = path.join(OUT_DIR, `${name}.litematic`);
    tileManifest.tiles.push({
      name, coord:{x:tx,z:tz}, empty: !nonAir, nonAir, conflicts: stat.conflicts,
      pasteOrigin:[tileOriginX, yOrigin + minY, tileOriginZ], size:[TILE,height,TILE],
      gridBox:{min:[tileOriginX,yOrigin+minY,tileOriginZ], max:[tileOriginX+TILE-1,yOrigin+maxY,tileOriginZ+TILE-1]},
      schem:`${name}.schem`, litematic:`${name}.litematic`, bytes:schem.length,
    });
    if (fs.existsSync(recPath)) fs.unlinkSync(recPath);
  }
}
fs.rmSync(recordsDir, {recursive:true, force:true});
fs.writeFileSync(path.join(OUT_DIR, 'manifest-500x500.json'), JSON.stringify(tileManifest, null, 2));
console.log(`wrote ${tileManifest.tiles.length} tiles, uniqueNonAir=${tileManifest.totalNonAir}, rawNonAir=${rawTotalNonAir}, globalPalette=${globalStates.length}`);
