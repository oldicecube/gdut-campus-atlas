import {buildings, places, toWorld} from '../src/data/campus';
import {landPolygons, lakePolygons, residentialWaters, roads} from '../src/data/landscape';

const built = buildings.filter(b => places.find(p => p.id === b.placeIds[0])?.status === 'built');
const planned = buildings.length - built.length;
const footprintArea = built.reduce((sum, b) => sum + b.width * b.depth, 0);
const maxHeight = Math.max(...built.map(b => b.height));
const minX = Math.min(...built.map(b => toWorld(b.position)[0] - b.width / 2));
const maxX = Math.max(...built.map(b => toWorld(b.position)[0] + b.width / 2));
const minZ = Math.min(...built.map(b => toWorld(b.position)[1] - b.depth / 2));
const maxZ = Math.max(...built.map(b => toWorld(b.position)[1] + b.depth / 2));

function sceneBounds() {
  const xs:number[] = [], zs:number[] = [];
  for (const poly of landPolygons) for (const p of poly) { const [x,z] = toWorld(p); xs.push(x); zs.push(z); }
  for (const poly of lakePolygons) for (const p of poly) { const [x,z] = toWorld(p); xs.push(x); zs.push(z); }
  for (const poly of residentialWaters) for (const p of poly) { const [x,z] = toWorld(p); xs.push(x); zs.push(z); }
  for (const r of roads) for (const p of r.points) { const [x,z] = toWorld(p); xs.push(x + r.width/2); xs.push(x - r.width/2); zs.push(z + r.width/2); zs.push(z - r.width/2); }
  return {minX:Math.min(...xs), maxX:Math.max(...xs), minZ:Math.min(...zs), maxZ:Math.max(...zs)};
}

const bounds = sceneBounds();
const sizeX = bounds.maxX - bounds.minX;
const sizeZ = bounds.maxZ - bounds.minZ;
const maxY = Math.ceil(maxHeight + 8);
const scale = (s:number) => ({
  scale:s,
  x:Math.ceil(sizeX/s), z:Math.ceil(sizeZ/s), y:Math.ceil(maxY/s),
  cells:Math.ceil(sizeX/s)*Math.ceil(sizeZ/s)*Math.ceil(maxY/s),
});

console.log(JSON.stringify({
  buildings:{total:buildings.length,built:built.length,planned,footprintArea:Math.round(footprintArea),maxHeight},
  builtBounds:{minX:Math.round(minX),maxX:Math.round(maxX),minZ:Math.round(minZ),maxZ:Math.round(maxZ),sizeX:Math.round(maxX-minX),sizeZ:Math.round(maxZ-minZ)},
  sceneBounds:{...bounds,sizeX:Math.round(sizeX),sizeZ:Math.round(sizeZ),maxY},
  budgets:[scale(1),scale(2),scale(3),scale(4)],
}, null, 2));
