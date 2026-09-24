import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {disposeTree} from '../src/scene/geometry';

/**
 * 3 blocks/metre calculator + Sponge v2 validator.
 *
 * The atlas GLB export is authored directly in metres: every procedural part
 * is built from Building.width/height/depth, which the data layer treats as
 * metres. There is no separate "schematic unit" factor between the GLB and the
 * real world, so 3 blocks/metre is simply an exact 3x uniform scale of the GLB.
 *
 * ObjToSchematic scales a mesh by (size - 1) / meshDimension[axis]. Requesting
 * size = mpp * height would therefore give scale = mpp - 1/height, not mpp.
 * The value below adds the +1 so the produced voxel grid is exactly 3 blocks
 * per model metre on the constrained axis.
 *
 * This script never invokes ObjToSchematic itself; it prints the exact command
 * to run and then strictly validates the .schem that command produced.
 */

type Args = {
  input: string;
  output: string;
  blocksPerMetre: number;
  sourceDimensions?: [number, number, number];
};

function usage() {
  console.log(`Usage:
  npx tsx scripts/export-schem-3x.ts --input models/library.glb \\
      --output output/mc-library-3x/output.schem [--mpp 3]

The GLB is metre-based, so --mpp 3 means an exact 3x scale. The script prints
the ObjToSchematic command that reproduces it and validates an existing .schem.

  --source-dimensions W,H,D   Optional cross-check against src/data/campus.ts.
                              Nominal footprints differ from GLB extents because
                              terraces/stairs/roof rails extend past them.
`);
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const input = value('--input') ?? args[0];
  const output = value('--output') ?? args[1];
  const blocksPerMetre = Number(value('--mpp') ?? '3');
  const source = value('--source-dimensions');
  if (!input || !output || !Number.isFinite(blocksPerMetre) || blocksPerMetre <= 0) {
    usage();
    process.exit(2);
  }
  let sourceDimensions: [number, number, number] | undefined;
  if (source) {
    const parts = source.split(',').map(Number);
    if (parts.length !== 3 || parts.some(v => !Number.isFinite(v) || v <= 0)) {
      throw new Error('Invalid --source-dimensions, expected W,H,D');
    }
    sourceDimensions = parts as [number, number, number];
  }
  return {input: path.resolve(input), output: path.resolve(output), blocksPerMetre, sourceDimensions};
}

async function readGlbBounds(file: string): Promise<[number, number, number]> {
  const buf = fs.readFileSync(file);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  // setFromObject applies every node transform. The current export bakes world
  // matrices into vertices, but keeping setFromObject is harmless and correct
  // for either representation.
  const box = new T.Box3().setFromObject(gltf.scene);
  const size = new T.Vector3();
  box.getSize(size);
  disposeTree(gltf.scene);
  if (![size.x, size.y, size.z].every(Number.isFinite)) throw new Error(`GLB has no finite bounds: ${file}`);
  return [size.x, size.y, size.z];
}

type NbtValue = string | number | bigint | NbtValue[] | {[key: string]: NbtValue};

class NbtReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  private take(n: number) {
    const value = this.buf.subarray(this.offset, this.offset + n);
    if (value.length !== n) throw new Error('Truncated NBT');
    this.offset += n;
    return value;
  }
  private number(size: number, read: (b: Buffer) => number) { return read(this.take(size)); }
  private string() {
    const length = this.number(2, b => b.readUInt16BE(0));
    return this.take(length).toString('utf8');
  }
  private payload(type: number): NbtValue {
    switch (type) {
      case 1: return this.number(1, b => b.readInt8(0));
      case 2: return this.number(2, b => b.readInt16BE(0));
      case 3: return this.number(4, b => b.readInt32BE(0));
      case 4: return this.number(8, b => b.readBigInt64BE(0));
      case 5: return this.number(4, b => b.readFloatBE(0));
      case 6: return this.number(8, b => b.readDoubleBE(0));
      case 7: {
        const length = this.number(4, b => b.readInt32BE(0));
        return [...this.take(length)].map(byte => byte > 127 ? byte - 256 : byte);
      }
      case 8: return this.string();
      case 9: {
        const childType = this.number(1, b => b.readUInt8(0));
        const length = this.number(4, b => b.readInt32BE(0));
        return Array.from({length}, () => this.payload(childType));
      }
      case 10: {
        const out: {[key: string]: NbtValue} = {};
        for (;;) {
          const childType = this.number(1, b => b.readUInt8(0));
          if (childType === 0) return out;
          out[this.string()] = this.payload(childType);
        }
      }
      case 11: {
        const length = this.number(4, b => b.readInt32BE(0));
        const out: number[] = [];
        for (let i = 0; i < length; i++) out.push(this.number(4, b => b.readInt32BE(0)));
        return out;
      }
      case 12: {
        const length = this.number(4, b => b.readInt32BE(0));
        const out: bigint[] = [];
        for (let i = 0; i < length; i++) out.push(this.number(8, b => b.readBigInt64BE(0)));
        return out;
      }
      default: throw new Error(`Unsupported NBT tag type ${type}`);
    }
  }
  readRoot() {
    const type = this.number(1, b => b.readUInt8(0));
    if (type !== 10) throw new Error(`Expected compound root, got ${type}`);
    this.string();
    return this.payload(type) as {[key: string]: NbtValue};
  }
}

function readSchem(file: string) {
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  return new NbtReader(raw).readRoot();
}

function decodeVarints(bytes: Array<number | bigint>): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const raw of bytes) {
    const byte = Number(raw) & 0xff;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte & 0x80) {
      shift += 7;
      if (shift > 35) throw new Error('Varint is too long');
    } else {
      out.push(value);
      value = 0;
      shift = 0;
    }
  }
  if (shift !== 0 || value !== 0) throw new Error('Truncated varint');
  return out;
}

function verifySchem(file: string) {
  const root = readSchem(file);
  const width = Number(root.Width), height = Number(root.Height), length = Number(root.Length);
  const volume = width * height * length;
  const ids = decodeVarints(root.BlockData as Array<number | bigint>);
  const paletteEntries = Object.keys((root.Palette ?? {}) as object).length;
  const maxId = ids.reduce((max, id) => Math.max(max, id), 0);
  const airId = Number((root.Palette as any)?.['minecraft:air'] ?? 0);
  const nonAir = ids.reduce((sum, id) => sum + (id === airId ? 0 : 1), 0);
  const result = {
    file,
    bytes: fs.statSync(file).size,
    version: Number(root.Version),
    dataVersion: Number(root.DataVersion),
    size: [width, height, length],
    volume,
    decodedVoxels: ids.length,
    complete: ids.length === volume,
    paletteEntries,
    paletteMax: Number(root.PaletteMax),
    maxId,
    allIdsInPalette: maxId < paletteEntries,
    nonAir,
  };
  console.log(JSON.stringify(result, null, 2));
  if (ids.length !== volume) throw new Error(`Decoded ${ids.length} voxels, expected ${volume}`);
  if (maxId >= paletteEntries) throw new Error(`Palette id ${maxId} outside ${paletteEntries} entries`);
  return result;
}

async function main() {
  const args = parseArgs();
  const dimensions = await readGlbBounds(args.input);
  const mpp = args.blocksPerMetre;
  // ObjToSchematic scale = (size - 1) / meshDimension, so add the +1 to obtain
  // an exact mpp scale.
  const otsSize = dimensions[1] * mpp + 1;
  // OTS voxelises bounds.min.floor()..bounds.max.ceil(), an inclusive grid, so
  // the produced extent is at most ceil(mpp * metres) + 1 on each axis.
  const expected = dimensions.map(v => Math.ceil(v * mpp) + 1);
  const report: Record<string, unknown> = {
    mode: 'exact-scale',
    input: args.input,
    glbMetres: dimensions.map(v => Number(v.toFixed(6))),
    blocksPerMetre: mpp,
    objToSchematic: {
      constraintAxis: 'y',
      size: Number(otsSize.toFixed(6)),
      resultingScale: Number(((otsSize - 1) / dimensions[1]).toFixed(9)),
    },
    expectedSize: expected,
    // Run from the ObjToSchematic 1.0 checkout, whose tools/require-hook.cjs
    // supplies the Node FileReader shim the headless entrypoint needs.
    command:
      `npx ts-node --files --require ./tools/require-hook.cjs tools/run-headless.ts ` +
      `"${args.input}" "${path.dirname(args.output)}" schem --size ${otsSize.toFixed(6)} --axis y`,
    note: 'GLB units are metres; --mpp 3 is an exact 3x scale (the +1 compensates OTS (size-1)/dim).',
  };
  if (args.sourceDimensions) {
    report.sourceDimensions = args.sourceDimensions;
    report.sourceNote = 'Nominal campus.ts W,H,D, kept only as a cross-check; GLB extents include terraces, stairs and roof rails.';
  }
  console.log(JSON.stringify(report, null, 2));
  if (fs.existsSync(args.output)) {
    const verified = verifySchem(args.output);
    const [ew, eh, el] = expected;
    const [aw, ah, al] = verified.size;
    const consistent = Math.abs(aw - ew) <= 2 && Math.abs(ah - eh) <= 2 && Math.abs(al - el) <= 2;
    console.log(JSON.stringify({sizeConsistentWithExactScale: consistent, expected, actual: verified.size}, null, 2));
    if (!consistent) throw new Error('Schematic dimensions are inconsistent with an exact mpp scale');
  } else {
    console.log(JSON.stringify({output: args.output, exists: false, hint: 'Run the printed command, then re-run this script to validate.'}, null, 2));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});