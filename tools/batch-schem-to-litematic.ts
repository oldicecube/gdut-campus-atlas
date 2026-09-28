import fs from 'node:fs';
import path from 'node:path';
import {convert} from './schem-to-litematic';
const dir=process.argv[2]??'deliverables/full-campus-500x500';
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.schem')).sort();
const concurrency=Number(process.argv[3]??3);
let next=0;
async function worker(id){
 while(true){const i=next++; if(i>=files.length)return; const f=files[i]; const input=path.join(dir,f); const output=input.replace(/\.schem$/,'.litematic'); const name=path.basename(output,'.litematic'); if(fs.existsSync(output)){console.log(`[${id}] skip ${name}`);continue;} const s=await convert(input,output,name,'gdut-campus-atlas'); console.log(`[${id}] ${name} ${s.size.join('x')} nonAir=${s.nonAirBlocks} bytes=${fs.statSync(output).size}`);}
}
await Promise.all(Array.from({length:concurrency},(_,i)=>worker(i)));
