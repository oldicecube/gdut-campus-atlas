from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r'D:\Cube GDUT\ObjToSchematic-src\ObjToSchematic-ots-1.0')
root = root.resolve()

def edit(rel, replacements):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    changed = False
    for old, new in replacements:
        if new in s:
            continue
        if old not in s:
            raise SystemExit(f'patch context not found in {p}: {old[:100]!r}')
        s = s.replace(old, new, 1)
        changed = True
    if changed:
        p.write_text(s, encoding='utf-8', newline='\n')
        print('patched', rel)

edit('src/voxel_mesh.ts', [
    ('    neighbours: number,\n', '    neighbours: number,\n    /** Source GLTF material name, when the exporter supplied one. */\n    materialName?: string,\n'),
    ('public addVoxel(inPos: Vector3, colour: RGBA) {', 'public addVoxel(inPos: Vector3, colour: RGBA, materialName?: string) {'),
    ('                ++voxel.collisions;\n', "                ++voxel.collisions;\n                if (voxel.materialName === undefined && materialName !== undefined) voxel.materialName = materialName;\n"),
    ('                neighbours: 0,\n', '                neighbours: 0,\n                materialName,\n'),
])

edit('src/voxelisers/bvh-ray-voxeliser.ts', [
    ('voxelMesh.addVoxel(position, voxelColour);', 'voxelMesh.addVoxel(position, voxelColour, mesh.getMaterialByTriangle(intersection.triangleIndex));'),
])
edit('src/voxelisers/bvh-ray-voxeliser-plus-thickness.ts', [
    ('voxelMesh.addVoxel(position, voxelColour);', 'voxelMesh.addVoxel(position, voxelColour, mesh.getMaterialByTriangle(intersection.triangleIndex));'),
    ('voxelMesh.addVoxel(depthPosition, voxelColour);', 'voxelMesh.addVoxel(depthPosition, voxelColour, mesh.getMaterialByTriangle(intersection.triangleIndex));'),
])
# Normalize the idempotent material hint if an earlier interrupted patch left it twice.
vp = root / 'src/voxel_mesh.ts'
vs = vp.read_text(encoding='utf-8')
dup = '''                if (voxel.materialName === undefined && materialName !== undefined) voxel.materialName = materialName;
                // Keep the first source material as the semantic hint. The
                // colour still averages all ray hits, while source roles such
                // as glass/water/foliage survive into block assignment.
                if (voxel.materialName === undefined && materialName !== undefined) voxel.materialName = materialName;'''
one = '''                // Keep the first source material as the semantic hint. The
                // colour still averages all ray hits, while source roles such
                // as glass/water/foliage survive into block assignment.
                if (voxel.materialName === undefined && materialName !== undefined) voxel.materialName = materialName;'''
if dup in vs:
    vp.write_text(vs.replace(dup, one, 1), encoding='utf-8', newline='\n')
    print('normalized src/voxel_mesh.ts')

for rel in ['src/voxelisers/normal-corrected-ray-voxeliser.ts', 'src/voxelisers/ray-voxeliser.ts']:
    edit(rel, [
        ('this._voxelMesh.addVoxel(voxelPosition, voxelColour);', 'this._voxelMesh.addVoxel(voxelPosition, voxelColour, materialName);'),
    ])

block = root / 'src/block_mesh.ts'
s = block.read_text(encoding='utf-8')
if 'function semanticRole(materialName?: string)' not in s:
    s = s.replace("import { AtlasPalette, EFaceVisibility } from './block_assigner';", "import { AtlasPalette, EFaceVisibility, TBlockCollection } from './block_assigner';", 1)
    anchor = "export type FallableBehaviour = 'replace-falling' | 'replace-fallable' | 'place-string' | 'do-nothing';\n"
    helpers = r'''

function semanticRole(materialName?: string): string | undefined {
    const match = materialName?.match(/^mc:([^:]+):/);
    if (!match || match[1] === 'unknown') return undefined;
    return match[1];
}

function forcedSemanticBlockName(role?: string): string | undefined {
    switch (role) {
        case 'water': return 'minecraft:water';
        case 'grass': return 'minecraft:grass_block';
        case 'soil': return 'minecraft:dirt';
        case 'tree_trunk': return 'minecraft:oak_log';
        case 'tree_leaf': return 'minecraft:oak_leaves';
        case 'rail': return 'minecraft:iron_bars';
        default: return undefined;
    }
}

function roleMatchesBlock(role: string, blockName: string): boolean {
    const base = blockName.split('[')[0];
    switch (role) {
        case 'water': return base === 'minecraft:water';
        case 'grass': return base === 'minecraft:grass_block' || base === 'minecraft:moss_block';
        case 'soil': return /minecraft:(dirt|coarse_dirt|rooted_dirt|mud)$/.test(base);
        case 'tree_trunk': return /minecraft:(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry)_(log|wood)$/.test(base);
        case 'tree_leaf': return /minecraft:(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|azalea|flowering_azalea)_leaves$/.test(base);
        case 'glass': return base === 'minecraft:glass' || base.endsWith('_stained_glass');
        case 'rail': return base === 'minecraft:iron_bars' || base === 'minecraft:chain';
        case 'roof': return /minecraft:(.*_terracotta|.*_concrete|bricks|.*_bricks|deepslate_tiles|blackstone)$/.test(base);
        case 'wood': return /minecraft:(.*_planks|.*_log|.*_wood)$/.test(base);
        case 'metal': return base === 'minecraft:iron_block' || base === 'minecraft:iron_bars' || base.endsWith('_concrete');
        case 'road':
        case 'paving':
        case 'wall':
        case 'stone':
        case 'tile':
        case 'sport_surface':
        case 'sport_line':
        case 'light':
        case 'shore':
            return base.endsWith('_concrete') || base.endsWith('_terracotta') || base.endsWith('_wool') ||
                /minecraft:(stone|smooth_stone|bricks|quartz_block|sand|smooth_sandstone|prismarine|end_stone)$/.test(base);
        default: return false;
    }
}

function concreteFallbackCollection(all: TBlockCollection): TBlockCollection | undefined {
    const blocks = new Map<string, TAtlasBlock>();
    all.blocks.forEach((block, name) => { if (name.split('[')[0].endsWith('_concrete')) blocks.set(name, block); });
    if (blocks.size === 0) return undefined;
    return {blocks, cache: new Map()};
}

function roleCollection(role: string, all: TBlockCollection): TBlockCollection | undefined {
    const blocks = new Map<string, TAtlasBlock>();
    all.blocks.forEach((block, name) => { if (roleMatchesBlock(role, name)) blocks.set(name, block); });
    if (blocks.size === 0) return undefined;
    return {blocks, cache: new Map()};
}
'''
    if anchor not in s:
        raise SystemExit('block_mesh fallable anchor not found')
    s = s.replace(anchor, anchor + helpers, 1)
    old = "        const allBlockCollection = atlasPalette.createBlockCollection([]);\n        const nonFallableBlockCollection = atlasPalette.createBlockCollection(Array.from(AppRuntimeConstants.Get.FALLABLE_BLOCKS));"
    new = "        const allBlockCollection = atlasPalette.createBlockCollection([]);\n        const semanticCollections = new Map<string, TBlockCollection>();\n        const colourFallbackCollection = concreteFallbackCollection(allBlockCollection) ?? allBlockCollection;\n        const getSemanticCollection = (role: string) => {\n            if (!semanticCollections.has(role)) semanticCollections.set(role, roleCollection(role, allBlockCollection) ?? allBlockCollection);\n            const collection = semanticCollections.get(role)!;\n            return collection === allBlockCollection ? undefined : collection;\n        };\n        const nonFallableBlockCollection = atlasPalette.createBlockCollection(Array.from(AppRuntimeConstants.Get.FALLABLE_BLOCKS));"
    if old not in s: raise SystemExit('block_mesh collection anchor not found')
    s = s.replace(old, new, 1)
    old = "            let block = atlasPalette.getBlock(voxelColour, allBlockCollection, faceVisibility, blockMeshParams.errorWeight);"
    new = "            const semantic = semanticRole(voxel.materialName);\n            const semanticCollection = semantic ? getSemanticCollection(semantic) : undefined;\n            const forcedName = forcedSemanticBlockName(semantic);\n            let block: TAtlasBlock;\n            if (forcedName) {\n                const template = colourFallbackCollection.blocks.values().next().value as TAtlasBlock;\n                block = {...template, name: forcedName};\n            } else {\n                const colourCollection = semanticCollection ?? colourFallbackCollection;\n                block = atlasPalette.getBlock(voxelColour, colourCollection, faceVisibility, blockMeshParams.errorWeight);\n            }"
    if old not in s: raise SystemExit('block_mesh assignment anchor not found')
    s = s.replace(old, new, 1)
    old = "                block = atlasPalette.getBlock(voxelColour, nonFallableBlockCollection, faceVisibility, blockMeshParams.errorWeight);"
    new = "                block = semanticCollection\n                    ? atlasPalette.getBlock(voxelColour, semanticCollection, faceVisibility, blockMeshParams.errorWeight)\n                    : atlasPalette.getBlock(voxelColour, colourFallbackCollection, faceVisibility, blockMeshParams.errorWeight);"
    if old not in s: raise SystemExit('block_mesh fallable assignment anchor not found')
    s = s.replace(old, new, 1)
    old = "            if (AppRuntimeConstants.Get.GRASS_LIKE_BLOCKS.has(block.name)) {"
    new = "            if (!forcedName && semantic && !semanticCollection && AppRuntimeConstants.Get.GRASS_LIKE_BLOCKS.has(block.name)) {"
    if old not in s: raise SystemExit('block_mesh grass anchor not found')
    s = s.replace(old, new, 1)
    block.write_text(s, encoding='utf-8', newline='\n')
    print('patched src/block_mesh.ts')
else:
    print('already patched src/block_mesh.ts')
