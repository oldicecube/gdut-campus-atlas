import fs from 'node:fs';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {makeCampusModel} from '../src/scene/campusModel';
import {clipGroupToBox, type ClipBox} from '../src/scene/geometryClip';
import {disposeTree} from '../src/scene/geometry';

/**
 * Full static campus -> Minecraft shard GLBs.
 *
 * `export-models.ts` exports the *building* set only; it never included
 * terrain, roads, water, park or the procedural trees. This script exports the
 * complete static campus (`makeCampusModel()`: terrain + trees + buildings),
 * clipped into spatially disjoint boxes so each shard stays inside the
 * voxeliser's budget.
 *
 * Every shard keeps the campus world origin: `clipGroupToBox` bakes world
 * matrices and clips in world space, so shard N's vertices are still in campus
 * metres. The manifest records each shard's voxel-grid origin at 3:1
 * (floor(bounds.min * blocksPerMetre)) so the shards can be reassembled.
 *
 * Usage:
 *   npx tsx scripts/export-static-shards.ts [--grid 3x2] [--out output/static-shards]
 */

// Node has no FileReader; the Three.js GLTF exporter needs one.
class BlobReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) { blob.arrayBuffer().then(data => { this.result = data; this.onloadend?.(); }); }
  readAsDataURL(blob: Blob) { blob.arrayBuffer().then(data => { this.result = `data:${blob.type};base64,${Buffer.from(data).toString('base64')}`; this.onloadend?.(); }); }
}
Object.assign(globalThis, {FileReader: BlobReader});

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
  };
  const [cols, rows] = value('--grid', '3x2').split('x').map(Number);
  return {cols, rows, out: value('--out', 'output/static-shards'), mpp: Number(value('--mpp', '3'))};
}

/** Split [min,max] into `count` near-equal slices, snapped to whole metres. */
function slices(min: number, max: number, count: number) {
  const step = (max - min) / count;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push([min + step * i, i === count - 1 ? max : min + step * (i + 1)]);
  return out;
}

const COLUMN_NAMES = ['west', 'central', 'east', 'far-east', 'outer-east'];
const ROW_NAMES = ['north', 'middle', 'south'];

async function main() {
  const {cols, rows, out, mpp} = parseArgs();
  const model = makeCampusModel();
  const full = new T.Box3().setFromObject(model);
  console.log('full static campus bounds (m):', full.min.toArray().map(v => +v.toFixed(2)), full.max.toArray().map(v => +v.toFixed(2)));

  const xs = slices(full.min.x, full.max.x, cols);
  const zs = slices(full.min.z, full.max.z, rows);
  fs.mkdirSync(out, {recursive: true});

  const shards: any[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const name = `${COLUMN_NAMES[c] ?? `col${c}`}-${ROW_NAMES[r] ?? `row${r}`}`;
      const box: ClipBox = {minX: xs[c][0], maxX: xs[c][1], minZ: zs[r][0], maxZ: zs[r][1]};
      const t0 = Date.now();
      const {group, stats} = clipGroupToBox(model, box);
      const clippedMs = Date.now() - t0;
      if (stats.outputTriangles === 0) { disposeTree(group); console.log(`skip ${name}: empty`); continue; }

      const bounds = new T.Box3().setFromObject(group);
      const data = await new GLTFExporter().parseAsync(group, {binary: true, onlyVisible: true}) as ArrayBuffer;
      disposeTree(group);
      const loaded = await new GLTFLoader().parseAsync(data, '');
      let meshes = 0, vertices = 0;
      loaded.scene.traverse(o => {
        if (!(o instanceof T.Mesh)) return;
        meshes++;
        const a = o.geometry.getAttribute('position');
        vertices += a.count;
        for (const n of a.array) if (!Number.isFinite(n)) throw new Error(`Invalid vertex in ${name}`);
      });
      if (!meshes) throw new Error(`Empty export: ${name}`);

      const file = `${out}/glb/${name}.glb`;
      fs.mkdirSync(`${out}/glb`, {recursive: true});
      fs.writeFileSync(file, Buffer.from(data));
      disposeTree(loaded.scene);

      const size = bounds.getSize(new T.Vector3());
      const min = bounds.min;
      const otsSize = size.y * mpp + 1;
      shards.push({
        name,
        box: {minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ},
        file,
        bytes: data.byteLength,
        meshes,
        vertices,
        clip: stats,
        clippedMs,
        boundsMetres: {min: min.toArray(), max: bounds.max.toArray(), size: size.toArray()},
        blocksPerMetre: mpp,
        // OTS voxelises floor(metres * scale)..ceil(metres * scale); with
        // size = mpp * height + 1 the scale is exactly `mpp`.
        voxelOrigin: {
          x: Math.floor(min.x * mpp),
          y: Math.floor(min.y * mpp),
          z: Math.floor(min.z * mpp),
        },
        voxelSize: {x: Math.ceil(size.x * mpp) + 1, y: Math.ceil(size.y * mpp) + 1, z: Math.ceil(size.z * mpp) + 1},
        objToSchematicSize: Number(otsSize.toFixed(6)),
      });
      console.log(`built ${name}: ${stats.outputTriangles} tris, ${meshes} meshes, ${(data.byteLength / 1e6).toFixed(1)} MB, ${clippedMs} ms`);
    }
  }

  const manifest = {
    date: new Date().toISOString(),
    source: 'makeCampusModel() — terrain + trees + buildings',
    blocksPerMetre: mpp,
    campusBoundsMetres: {min: full.min.toArray(), max: full.max.toArray()},
    grid: {cols, rows},
    shards,
  };
  fs.writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`\nwrote ${out}/manifest.json with ${shards.length} shards`);
  disposeTree(model);
}

main().catch(error => { console.error(error); process.exit(1); });
