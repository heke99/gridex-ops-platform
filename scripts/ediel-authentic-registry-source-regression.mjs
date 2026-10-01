// Private original inputs stay outside Git/artifacts. Output contains only
// source hashes, aggregate structural facts and code hashes, never actor data.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),ts=require('typescript'),hash=b=>createHash('sha256').update(b).digest('hex')
const original=readFileSync(process.argv[2]),sourceHash=hash(original)
assert.equal(sourceHash,'ee26868abc53f7ed60918806d81e225e4ba33cd6ae24afcecc741805fd34f0de')
const source=readFileSync(new URL('../lib/actor-registry/parseActorRegistryTxt.ts',import.meta.url),'utf8'),exports={}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,Error,Set,Object,JSON,Number})
const actors=exports.parseActorRegistryTxt(new TextDecoder('utf-8',{fatal:true}).decode(original))
const evidence={sourceHash,sourceBytes:original.length,parserHash:hash(source),encoding:'utf-8',logicalActors:actors.length,markets:Object.fromEntries(['EL','GAS'].map(market=>[market,actors.filter(a=>a.market===market).length])),registeredRoutes:actors.flatMap(a=>a.routes).length,metadataOnlyActors:actors.filter(a=>!a.routes.length).length,multilineAddressRecords:actors.filter(a=>a.raw.sourceFragment.includes('\n')).length,routeFamilies:Object.fromEntries(['PRODAT','UTILTS'].map(family=>[family,actors.flatMap(a=>a.routes).filter(r=>r.messageFamily===family).length])),generatedAt:actors[0].raw.generatedAt,grantsAuthority:false}
assert.equal(evidence.logicalActors,697);assert.equal(evidence.registeredRoutes,1126);assert.equal(evidence.metadataOnlyActors,134);assert.equal(evidence.multilineAddressRecords,1);assert.deepEqual(evidence.markets,{EL:651,GAS:46});assert.deepEqual(evidence.routeFamilies,{PRODAT:563,UTILTS:563});assert.ok(actors.flatMap(a=>a.routes).every(r=>!r.isVerified));console.log(JSON.stringify(evidence,null,2))
