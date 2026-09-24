import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {decode} from '@enginehub/nbt-ts';

/**
 * Third-party validation of the full-campus 3:1 shard set.
 *
 * EngineHub authors the Sponge schematic specification, so loading each shard
 * with `@enginehub/nbt-ts` proves the gzip + NBT framing, the `Palette`
 * compound, and the BlockData varint stream are standard rather than merely
 * readable by our own writer (`tools/indexed-json-to-schem.mjs`).
 *
 * For every shard in the manifest it asserts:
 *   - Version == 2 and Width/Height/Length match the manifest campusGrid size
 *   - palette slot 0 is minecraft:air and PaletteMax == Palette entry count
 *   - the varint stream decodes to exactly Width*Height*Length voxels
 *   - the non-air count equals the manifest and the litemapy verify JSON
 *
 * Usage:
 *   npx.cmd tsx tools/verify-shards-enginehub.ts [deliverables/full-campus-3x]
 */

const dir = process.argv[2] ?? 'deliverables/full-campus-3x';
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

if (manifest.blocksPerMetre !== 3) {
  throw new Error(`expected blocksPerMetre 3, got ${manifest.blocksPerMetre}`);
}

type Checks = Record<string, boolean | null>;

let ok = true;

for (const shard of manifest.shards) {
  const name = shard.name;
  const file = path.join(dir, `${name}-3x.schem`);
  const {value} = decode(zlib.gunzipSync(fs.readFileSync(file)), {useMaps: true});
  const t: any = value;

  const version = t.get('Version').value;
  const dataVersion = t.get('DataVersion').value;
  const width = t.get('Width').value;
  const height = t.get('Height').value;
  const length = t.get('Length').value;
  const paletteMax = t.get('PaletteMax').value;
  const palette = t.get('Palette') as Map<string, any>;
  const blockData = t.get('BlockData') as Buffer;

  const expectedSize = shard.campusGrid.size;
  const volume = width * height * length;

  // Decode the varint stream ourselves and count non-air voxels.
  let cursor = 0;
  let decoded = 0;
  let nonAir = 0;
  let acc = 0;
  let shift = 0;
  while (cursor < blockData.length) {
    const byte = blockData[cursor];
    acc |= (byte & 127) << shift;
    shift += 7;
    cursor++;
    if ((byte & 128) !== 128) {
      if (acc !== 0) nonAir++;
      decoded++;
      acc = 0;
      shift = 0;
    }
  }

  const verifyPath = path.join(dir, `${name}-3x.litematic-verify.json`);
  const litemapy = fs.existsSync(verifyPath) ? JSON.parse(fs.readFileSync(verifyPath, 'utf8')) : null;

  const checks: Checks = {
    version2: version === 2,
    sizeMatch: [width, height, length].join('x') === expectedSize.join('x'),
    airIsSlot0: palette.get('minecraft:air')?.value === 0,
    paletteMaxMatches: paletteMax === palette.size,
    varintsFillVolume: decoded === volume,
    nonAirMatchesManifest: nonAir === shard.campusGrid.nonAir,
    nonAirMatchesLitemapy: litemapy ? nonAir === litemapy.nonAirBlocks : null,
    litemapyZeroMismatch: litemapy ? litemapy.voxelDiff.mismatchCount === 0 : null,
  };
  const pass = Object.values(checks).every(v => v === true || v === null);
  if (!pass) ok = false;

  console.log(JSON.stringify({
    name, file, version, dataVersion, size: [width, height, length],
    paletteEntries: palette.size, volume, nonAir, checks, pass,
  }));
}

const totalNonAir = manifest.shards.reduce((a: number, s: any) => a + s.campusGrid.nonAir, 0);
console.log(JSON.stringify({
  dir,
  shards: manifest.shards.length,
  campusGrid: {origin: manifest.campusGrid.origin, size: manifest.campusGrid.size, max: manifest.campusGrid.max},
  totalNonAir,
  allPass: ok,
}, null, 2));

if (!ok) process.exit(1);
