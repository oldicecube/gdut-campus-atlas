import fs from 'node:fs';
import path from 'node:path';

/**
 * Bake a self-contained placement table into a shard manifest.
 *
 * ObjToSchematic recentres every mesh on the origin before voxelising
 * (`src/mesh.ts::_centreMesh`), so each shard's `.schem`/`.litematic` is written
 * in its OWN local frame rather than campus coordinates. `export-static-shards`
 * only records each shard's clip box in metres; from that we can recover exactly
 * where local (0,0,0) belongs in the shared campus grid:
 *
 *   snapOrigin    = floor(campusBounds.min * blocksPerMetre)   // campus grid origin
 *   offset(shard) = round(centre_metres * blocksPerMetre) - snapOrigin
 *   pasteOrigin   = otsMin + offset + snapOrigin
 *   size          = otsMax - otsMin + 1                        // == .schem W/H/L
 *
 * otsMin/otsMax are the tight bounds of the non-air voxels in the OTS
 * `indexed_json` export, which is exactly the box `indexed-json-to-schem.mjs`
 * writes, so `size` is guaranteed to equal the `.schem`/`.litematic` region size.
 *
 * The script also back-fills `voxelSize` with the *real* exported size: the
 * nominal `ceil(metres*mpp)+1` estimate in the exporter overstates it by 1-2
 * blocks per axis.
 *
 * Usage:
 *   node tools/finalize-shard-manifest.mjs <manifest.json> [<otsOutputRoot>]
 */

function tightBounds(xyzi) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const b of xyzi) {
    for (let i = 0; i < 3; i++) {
      if (b[i] < mn[i]) mn[i] = b[i];
      if (b[i] > mx[i]) mx[i] = b[i];
    }
  }
  return {mn, mx};
}

function findOtsJson(root, name) {
  const candidates = [
    path.join(root, `ots-${name}`, 'output.json'),
    path.join(root, '..', `ots-${name}`, 'output.json'),
  ];
  return candidates.find(c => fs.existsSync(c));
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: node tools/finalize-shard-manifest.mjs <manifest.json> [<otsOutputRoot>]');
  process.exit(2);
}
const root = process.argv[3] ?? path.resolve(path.dirname(manifestPath), '..');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const k = manifest.blocksPerMetre;
const cb = manifest.campusBoundsMetres;

const snapOrigin = [0, 1, 2].map(i => Math.floor(cb.min[i] * k));
const unionMin = [Infinity, Infinity, Infinity];
const unionMax = [-Infinity, -Infinity, -Infinity];

for (const shard of manifest.shards) {
  const name = shard.name;
  const src = findOtsJson(root, name);
  if (!src) { console.warn(`skip ${name}: no ots-${name}/output.json under ${root}`); continue; }

  const {xyzi} = JSON.parse(fs.readFileSync(src, 'utf8'));
  const {mn, mx} = tightBounds(xyzi);
  const b = shard.boundsMetres;
  const centre = [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2);
  const offset = [0, 1, 2].map(i => Math.round(centre[i] * k) - snapOrigin[i]);
  const localOrigin = [0, 1, 2].map(i => mn[i] + offset[i]);
  // Absolute campus-grid coordinate of the shard's local (0,0,0).
  const pasteOrigin = [0, 1, 2].map(i => localOrigin[i] + snapOrigin[i]);
  const size = [0, 1, 2].map(i => mx[i] - mn[i] + 1);

  // Clip box snapped to the campus grid, in absolute 3:1 block coordinates.
  const clipMin = [0, 1, 2].map(i => Math.floor(b.min[i] * k));
  const clipMax = [0, 1, 2].map(i => Math.floor(b.max[i] * k));

  for (let i = 0; i < 3; i++) {
    unionMin[i] = Math.min(unionMin[i], pasteOrigin[i]);
    unionMax[i] = Math.max(unionMax[i], pasteOrigin[i] + size[i]);
  }

  shard.campusGrid = {
    clipBox: {min: clipMin, max: clipMax},
    pasteOrigin,
    localOrigin,
    size,
    offsetFromSnapOrigin: offset,
    nonAir: xyzi.length,
  };
  // Replace the exporter's over-stated nominal estimate with the real size.
  shard.voxelSizeEstimated = shard.voxelSize;
  shard.voxelSize = {x: size[0], y: size[1], z: size[2]};
}

const campusSize = [0, 1, 2].map(i => unionMax[i] - unionMin[i]);
manifest.campusGrid = {
  origin: unionMin,                 // absolute 3:1 block coordinates
  size: campusSize,
  max: unionMax,
  snapOrigin,                       // floor(campusBounds.min * blocksPerMetre)
  blocksPerMetre: k,
  note: '每个分片的 .schem/.litematic 都在自身局部坐标系内（ObjToSchematic 会对网格重新居中）；pasteOrigin 给出局部 (0,0,0) 在共享校园网格中的绝对坐标。',
};
manifest.updated = new Date().toISOString();

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`updated ${manifestPath}`);
console.log(`campus grid origin=[${manifest.campusGrid.origin}] size=[${campusSize}] max=[${unionMax}]`);
for (const s of manifest.shards) {
  if (!s.campusGrid) continue;
  const g = s.campusGrid;
  console.log(`  ${s.name.padEnd(14)} paste@[${g.pasteOrigin}] size=${g.size.join('x')} nonAir=${g.nonAir}`);
}
