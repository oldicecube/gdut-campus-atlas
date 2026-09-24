import * as T from 'three';

/**
 * Axis-aligned clipping of an assembled (world-matrix-baked) three.js group.
 *
 * The Minecraft export needs spatially disjoint shards whose bounds stay
 * bounded: slicing by district is not enough, because the shared terrain
 * polygons span the whole campus and would restore whole-campus bounds in every
 * shard. Clipping each triangle against the shard box keeps a shard's mesh
 * bounds equal to the shard box (plus whatever geometry actually reaches its
 * edges), so the voxel volume stays inside the budget.
 *
 * Only the four vertical planes are used by default (X/Z clipping): cutting
 * horizontal ground polygons vertically does not invent surfaces, so the
 * assembled shards stay watertight against each other. Cutting in Y as well
 * would add horizontal lids that the surface voxeliser would turn into visible
 * slabs, so it is opt-in.
 */

export type ClipBox = {minX: number; maxX: number; minZ: number; maxZ: number; minY?: number; maxY?: number};

type Vec3 = [number, number, number];

function clipHalfSpace(poly: Vec3[], axis: 0 | 1 | 2, limit: number, keepLess: boolean): Vec3[] {
  const out: Vec3[] = [];
  const inside = (v: Vec3) => (keepLess ? v[axis] <= limit : v[axis] >= limit);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = inside(a), bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (limit - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** Clip one triangle to the box; returns 0..2 triangles (a fan of the clipped polygon). */
export function clipTriangleToBox(tri: Vec3[], box: ClipBox): Vec3[][] {
  let poly: Vec3[] = tri;
  poly = clipHalfSpace(poly, 0, box.minX, false); if (poly.length < 3) return [];
  poly = clipHalfSpace(poly, 0, box.maxX, true); if (poly.length < 3) return [];
  poly = clipHalfSpace(poly, 2, box.minZ, false); if (poly.length < 3) return [];
  poly = clipHalfSpace(poly, 2, box.maxZ, true); if (poly.length < 3) return [];
  if (box.minY !== undefined) { poly = clipHalfSpace(poly, 1, box.minY, false); if (poly.length < 3) return []; }
  if (box.maxY !== undefined) { poly = clipHalfSpace(poly, 1, box.maxY, true); if (poly.length < 3) return []; }
  const out: Vec3[][] = [];
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
  return out;
}

export type ClipStats = {inputTriangles: number; keptTriangles: number; outputTriangles: number; materials: number};

/**
 * Clip every mesh of a world-baked group to `box`, preserving each source
 * material's colour/opacity/side so the exporter's palette mapping is
 * unaffected. The result is one non-indexed mesh per source material.
 */
export function clipGroupToBox(group: T.Object3D, box: ClipBox): {group: T.Group; stats: ClipStats} {
  group.updateMatrixWorld(true);
  const bins = new Map<string, {mat: T.Material; positions: number[]}>();
  let inputTriangles = 0, keptTriangles = 0, outputTriangles = 0;
  group.traverse(o => {
    if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || Array.isArray(o.material)) return;
    const src = o.material as T.MeshStandardMaterial;
    const key = (src.color?.getHexString() ?? src.uuid) + '-' + src.opacity + '-' + src.side;
    const entry = bins.get(key) ?? {mat: src.clone(), positions: []};
    const attr = o.geometry.getAttribute('position');
    const array = attr.array as ArrayLike<number>;
    const tri: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const tmp = new T.Vector3();
    for (let i = 0; i + 2 < attr.count; i += 3) {
      inputTriangles++;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < 3; k++) {
        tmp.fromArray(array as ArrayLike<number>, (i + k) * 3).applyMatrix4(o.matrixWorld);
        tri[k] = [tmp.x, tmp.y, tmp.z];
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
        minZ = Math.min(minZ, tmp.z); maxZ = Math.max(maxZ, tmp.z);
      }
      // Cheap reject before the full half-space clip.
      if (maxX < box.minX || minX > box.maxX || maxZ < box.minZ || minZ > box.maxZ) continue;
      if (box.minY !== undefined && maxY < box.minY) continue;
      if (box.maxY !== undefined && minY > box.maxY) continue;
      keptTriangles++;
      for (const piece of clipTriangleToBox(tri, box)) {
        outputTriangles++;
        for (const v of piece) entry.positions.push(v[0], v[1], v[2]);
      }
    }
    bins.set(key, entry);
  });
  const result = new T.Group();
  result.name = 'clipped';
  let materials = 0;
  for (const [, v] of bins) {
    if (v.positions.length === 0) continue;
    materials++;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v.positions, 3));
    const mesh = new T.Mesh(g, v.mat);
    mesh.name = 'clipped-' + (v.mat as T.MeshStandardMaterial).color?.getHexString();
    result.add(mesh);
  }
  return {group: result, stats: {inputTriangles, keptTriangles, outputTriangles, materials}};
}
