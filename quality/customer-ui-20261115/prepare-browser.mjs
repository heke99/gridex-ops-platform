import fs from 'node:fs';
import path from 'node:path';
const root=process.env.GRIDEX_UI_FIXTURE_DIR || '/tmp/gridex-ui-browser-20261115';
fs.mkdirSync(root,{recursive:true});
for(const [source,target] of [['browser-fixture.tsx.txt','fixture.tsx'],['browser-index.html.txt','index.html']]){
 const text=fs.readFileSync(new URL(source,import.meta.url),'utf8').replaceAll('__REPO__',process.cwd());
 fs.writeFileSync(path.join(root,target),text);
}
if(!fs.existsSync(path.join(root,'node_modules'))) fs.symlinkSync(path.join(process.cwd(),'node_modules'),path.join(root,'node_modules'),'dir');
console.log('Prepared isolated browser fixtures. Generate server HTML using GRIDEX_UI_FIXTURE_DIR and the two role-render tests, then run browser-server.mjs and browser-check.mjs.');
