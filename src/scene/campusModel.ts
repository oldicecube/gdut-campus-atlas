import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildings,places,toWorld,type Area,type Point} from '../data/campus';
import {
 landPolygons,lakePolygons,lakeIsland,lakeBankRings,adminForecourt,libraryWestForecourt,libraryEastForecourt,
 residentialPark,residentialWaters,roads,promenades,inside,
} from '../data/landscape';
import {photoViews} from '../data/photoViews';
import {flatPolygon,pathMesh} from './geometry';
import {makeRoadNetwork} from './roadNetwork';
import {makeResidentialPark} from './residentialPark';
import {makeWoodedHill,woodedHillHeight,makeAdministrationFootbridge} from './woodedHill';
import {excludesPodiumTree} from './entrancePodium';
import {makeBuilding} from './models';
import {makeConnections} from './connections';

/**
 * Headless-friendly assembly of the whole campus model.
 *
 * `CampusScene` and the Minecraft export pipeline both build from these
 * functions, so the exported geometry is the same geometry the web viewer
 * shows. Everything here is DOM-free and WebGL-free: three.js geometry only.
 *
 * Deliberately excluded are elements that have no meaningful static form in a
 * Minecraft export:
 *  - the 5000x5000 backdrop plane (it would blow up the export bounds)
 *  - animated residents (lake ducks, the cycling pelican, mobility actors)
 *  - UI affordances (labels, selection ring, planning wireframes, night lights)
 */

export type CampusModelParts = {
 /** Ground, paving, water, roads, park, wooded hill and campus gates. */
 terrain?:boolean;
 /** Decorative tree canopies and trunks, as plain (non-instanced) meshes. */
 trees?:boolean;
 /** Procedural buildings plus the PDF-confirmed links between them. */
 buildings?:boolean;
 /** Restrict the building set to one district. Terrain/trees stay campus-wide. */
 area?:Area;
};

/** Ground, paving, water, roads, park, wooded hill and campus gates. */
export function makeCampusTerrain():T.Group {
 const terrain=new T.Group();terrain.name='campus-terrain';
 landPolygons.forEach(poly=>{const wp=poly.map(toWorld);terrain.add(flatPolygon(wp,'#b9c6a7',-.8));terrain.add(pathMesh([...wp,wp[0]],2.6,'#dce0cc',.1));});
 // Canal that separates west residences from east residences.
 residentialWaters.slice(1).forEach(poly=>terrain.add(flatPolygon(poly.map(toWorld),'#87b8b8',.13)));
 terrain.add(makeResidentialPark(),makeWoodedHill(),makeAdministrationFootbridge());
 lakeBankRings.forEach(poly=>{const wp=poly.map(toWorld);terrain.add(pathMesh([...wp,wp[0]],8,'#d8d4bd',.1));});
 lakePolygons.forEach(poly=>terrain.add(flatPolygon(poly.map(toWorld),'#7faeb0',.13)));
 terrain.add(flatPolygon(lakeIsland.map(toWorld),'#b9c6a7',.25));
 terrain.add(flatPolygon(libraryWestForecourt.map(toWorld),'#ded8c7',.56));
 terrain.add(makeRoadNetwork());
 promenades.forEach(p=>terrain.add(pathMesh(p.map(toWorld),3.4,'#e3dbc5',.5)));
 // Shared footprints keep library paving and vegetation clear of the avenues.
 terrain.add(flatPolygon(libraryEastForecourt.map(toWorld),'#ded8c7',.53));
 for(const gate of places.filter(p=>p.id.includes('gate')||p.id==='academic-nw')){
  const [x,z]=toWorld(gate.position);const g=new T.Group();
  for(let i=0;i<7;i++){const stripe=new T.Mesh(new T.BoxGeometry(1.1,.08,9),new T.MeshStandardMaterial({color:'#f0ecdc'}));stripe.position.x=(i-3)*2.2;g.add(stripe);}
  g.position.set(x,.7,z);g.rotation.y=gate.id==='east-gate'?Math.PI/2:gate.id==='academic-nw'?0:.39;terrain.add(g);
 }
 return terrain;
}

/**
 * Deterministic decorative tree placements: campus-wide, road/building/water
 * aware, with photo sightlines cleared. Shared by the web viewer (which draws
 * them as an InstancedMesh) and the Minecraft exporter (which needs plain
 * meshes), so the two can never disagree about where the trees are.
 */
export function campusTreePoints():{x:number;z:number;s:number;c:number}[] {
 let seed=8517;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const points:{x:number;z:number;s:number;c:number}[]=[];
 const built=buildings.filter(b=>b.kind!=='lake').map(b=>({...b,world:toWorld(b.position)}));
 const track=built.find(b=>b.id==='b-central-track')!;
 const standWest=track.world[0]-track.depth/2-50,standEast=track.world[0]-track.depth/2+8;
 const standHalfLength=track.width*.59+10;
 function nearRoad(p:Point){return roads.some(r=>r.points.some((a,i)=>{if(!i)return false;const b=r.points[i-1],dx=a[0]-b[0],dy=a[1]-b[1];const t=Math.max(0,Math.min(1,((p[0]-b[0])*dx+(p[1]-b[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-b[0]-t*dx,p[1]-b[1]-t*dy)<r.width/2+5;}));}
 for(let n=0;n<17000&&points.length<1300;n++){const uv:Point=[170+random()*1060,65+random()*1200];if(inside(uv,adminForecourt)||inside(uv,residentialPark)||inside(uv,libraryWestForecourt)||inside(uv,libraryEastForecourt)||!landPolygons.some(p=>inside(uv,p))||residentialWaters.some(p=>inside(uv,p))||(lakePolygons.some(p=>inside(uv,p))&&!inside(uv,lakeIsland))||nearRoad(uv))continue;const [x,z]=toWorld(uv);if(excludesPodiumTree(x,z)||(x>standWest&&x<standEast&&Math.abs(z-track.world[1])<standHalfLength))continue;if(built.some(b=>{const dx=x-b.world[0],dz=z-b.world[1],c=Math.cos(b.rotation),s=Math.sin(b.rotation);const lx=dx*c-dz*s,lz=dx*s+dz*c;if(b.placeIds.includes('library')&&lx>-100&&lx<-b.width/2&&Math.abs(lz)<49)return true;if(b.placeIds.includes('library')&&lx>b.width/2-5&&lx<48&&Math.abs(lz)<45)return true;if(b.placeIds.includes('gym')&&lx>-b.width*.72&&lx<82&&lz>-b.depth*.96&&lz<b.depth*.89)return true;if(b.placeIds.includes('admin')&&lx>-b.width/2-6&&lx<170&&lz>-b.depth*.7&&lz<84)return true;if(b.placeIds.includes('comprehensive')&&lx>-b.width/2-6&&lx<170&&Math.abs(lz)<b.depth*.8)return true;if(b.placeIds.includes('culture')&&lz>b.depth*.2&&lz<b.depth*1.6&&Math.abs(lx)<b.width*.65)return true;return Math.abs(lx)<b.width/2+9&&Math.abs(lz)<b.depth/2+10;}))continue;points.push({x,z,s:3.5+random()*3,c:random()});}
 // Tree positions are decorative, not surveyed. Keep low reference sightlines
 // clear so a generated canopy cannot conceal the architecture being checked.
 const sightlines=photoViews.filter(v=>v.localCamera[1]<20).flatMap(v=>{const b=built.find(b=>b.placeIds.includes(v.placeId));if(!b)return [];const [cx,,cz]=v.localCamera,c=Math.cos(b.rotation),s=Math.sin(b.rotation);return [{x:b.world[0],z:b.world[1],dx:cx*c+cz*s,dz:-cx*s+cz*c,width:b.width}];});
 for(let i=points.length-1;i>=0;i--){const p=points[i];if(sightlines.some(v=>{const t=Math.max(0,Math.min(1,((p.x-v.x)*v.dx+(p.z-v.z)*v.dz)/(v.dx*v.dx+v.dz*v.dz)));return Math.hypot(p.x-v.x-v.dx*t,p.z-v.z-v.dz*t)<12+v.width*.5*(1-t);})){points.splice(i,1);}}
 for(let n=0,added=0;n<1400&&added<110;n++){const x=-10+random()*190,z=195+random()*175;if(woodedHillHeight(x,z)<.9||points.some(p=>Math.hypot(p.x-x,p.z-z)<5))continue;points.push({x,z,s:4+random()*2.5,c:random()});added++;}
 return points;
}

/** Foliage colours used to shade the shared tree placement. */
export const campusTreeColours=['#819969','#8eab78','#718c63','#9eaf7d','#64876c'];

/** Decorative campus trees, expanded from instanced meshes into plain meshes. */
export function makeCampusTrees():T.Group {
 const group=new T.Group();group.name='campus-vegetation';
 const points=campusTreePoints();
 // One canopy batch per foliage colour keeps the mesh count low; the scene
 // renders these as InstancedMesh, which is not usable by the export pipeline.
 const colors=campusTreeColours;
 const canopies=new Map<string,T.BufferGeometry[]>();
 const trunks:T.BufferGeometry[]=[];
 for(const p of points){
  const color=colors[Math.floor(p.c*colors.length)];
  const y=woodedHillHeight(p.x,p.z);
  const canopy=new T.IcosahedronGeometry(1,1);
  canopy.scale(p.s,p.s*1.05,p.s);canopy.translate(p.x,y+5+p.s*.45,p.z);canopy.deleteAttribute('uv');
  const list=canopies.get(color)??[];list.push(canopy);canopies.set(color,list);
  const trunk=new T.CylinderGeometry(.45,.65,5,5);
  trunk.translate(p.x,y+2.8,p.z);trunk.deleteAttribute('uv');
  trunks.push(trunk);
 }
 for(const [color,geoms] of canopies){
  const merged=mergeGeometries(geoms,false);geoms.forEach(g=>g.dispose());
  const mesh=new T.Mesh(merged,new T.MeshStandardMaterial({color,roughness:1}));
  mesh.name='campus-trees';mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }
 const trunkMerged=mergeGeometries(trunks,false);trunks.forEach(g=>g.dispose());
 const trunkMesh=new T.Mesh(trunkMerged,new T.MeshStandardMaterial({color:'#8f9273',roughness:1}));
 trunkMesh.name='campus-trunks';trunkMesh.castShadow=true;trunkMesh.receiveShadow=true;group.add(trunkMesh);
 return group;
}

/** Procedural buildings plus the PDF-confirmed links between them. */
export function makeCampusBuildings(area?:Area):T.Group {
 const group=new T.Group();group.name=area?`campus-buildings-${area}`:'campus-buildings';
 for(const b of buildings){
  const p=places.find(p=>p.id===b.placeIds[0]);
  if(!p||p.status!=='built')continue;
  if(area&&p.area!==area)continue;
  group.add(makeBuilding(b));
 }
 group.add(makeConnections(area));
 return group;
}

/**
 * The full static campus model in real-world metres, on the viewer's axes.
 * Merge with `mergeScene()` before handing it to an exporter: the export
 * pipeline needs one mesh per material with world matrices baked in.
 */
export function makeCampusModel(parts:CampusModelParts={}):T.Group {
 const {terrain=true,trees=true,buildings:withBuildings=true,area}=parts;
 const group=new T.Group();group.name='GDUT-University-Town';
 if(terrain)group.add(makeCampusTerrain());
 if(trees)group.add(makeCampusTrees());
 if(withBuildings)group.add(makeCampusBuildings(area));
 return group;
}