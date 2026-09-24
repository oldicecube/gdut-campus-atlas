import fs from 'node:fs';
import zlib from 'node:zlib';
import {decode} from '@enginehub/nbt-ts';
import {loadSchematic} from '@enginehub/schematicjs';

// Independent third-party validation of the generated Sponge v2 .schem files.
// EngineHub authors the Sponge schematic specification, so a clean load proves
// the output is standard rather than merely readable by our own parser.

for (const id of ['library','cricket','gym','culture','south-gate']) {
  const file = `output/mc-${id}-3x/output.schem`;
  const {value} = decode(zlib.gunzipSync(fs.readFileSync(file)), {useMaps: true});
  const s: any = loadSchematic(value as any, 'sponge');
  let nonAir = 0, total = 0;
  for (let x = 0; x < s.width; x++) {
    for (let y = 0; y < s.height; y++) {
      for (let z = 0; z < s.length; z++) {
        total++;
        if (!/^(minecraft:)?air$/.test(s.blocks[x][y][z]?.type ?? '')) nonAir++;
      }
    }
  }
  console.log(JSON.stringify({
    id, file, format: s.format,
    size: [s.width, s.height, s.length],
    palette: s.blockTypes.length,
    blocksScanned: total,
    nonAir,
    dataVersion: s.dataVersion,
  }));
}