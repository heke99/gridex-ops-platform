// A derivative of the same canonical deadline facade and actual pure watch port.
// Only a new CLI-created migration with this placeholder may be populated.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1]
const root=path.resolve(args.includes('--repo-root')?option('--repo-root'):path.join(__dirname,'..')),target=path.resolve(option('--migration'))
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),inputs={},cache=new Map()
function load(file){
 if(!path.extname(file))file+='.ts'
 if(cache.has(file))return cache.get(file).exports
 if(!file.startsWith(root+path.sep))throw Error('Method watch projection input outside repository')
 const source=fs.readFileSync(file,'utf8');inputs[path.relative(root,file)]=hash(source);const module={exports:{}};cache.set(file,module)
 if(path.extname(file)==='.json'){module.exports={__esModule:true,default:JSON.parse(source)};return module.exports}
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const localRequire=name=>{if(name.startsWith('@/'))return load(path.join(root,name.slice(2)));if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));throw Error(`Method watch source unexpectedly imports service: ${name}`)}
 new Function('require','module','exports',output)(localRequire,module,module.exports);return module.exports
}
const projection=load(path.join(root,'lib/ediel/meteringMethodExpectationPolicy.ts')).EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS
if(projection?.ruleId!=='TM-METHOD40'||projection.constraint?.condition!=='metering_method_change'||projection.unit!=='calendar_days'||!Number.isSafeInteger(projection.offset))throw Error('Canonical method watch source unavailable')
for(const name of ['docs/ediel/masterplan-v2/registers/source_manifest.json','docs/ediel/masterplan-v2/registers/timers.json'])inputs[name]=hash(fs.readFileSync(path.join(root,name),'utf8'))
inputs['scripts/generate-ediel-method-expectation-projection.cjs']=hash(fs.readFileSync(__filename,'utf8'))
const inputManifest=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))),edition={sourceVersion:hash(JSON.stringify({inputManifest,projection})),inputManifest,projection}
const literal=JSON.stringify(edition).replaceAll("'","''"),block=`-- BEGIN CANONICAL METHOD EXPECTATION PROJECTION
INSERT INTO gridex_method_expectations.editions(source_version,input_manifest,projection)
SELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '${literal}'::jsonb value) edition;
-- END CANONICAL METHOD EXPECTATION PROJECTION`
const content=fs.readFileSync(target,'utf8')
if(args.includes('--check')){
 const match=content.match(/-- BEGIN CANONICAL METHOD EXPECTATION PROJECTION[\s\S]*?FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)?.[1];if(!match)throw Error('Published method watch edition missing')
 const published=JSON.parse(match.replaceAll("''","'"));if(published.sourceVersion!==hash(JSON.stringify({inputManifest:published.inputManifest,projection:published.projection})))throw Error('Method watch provenance hash invalid')
 if(JSON.stringify(published.projection)!==JSON.stringify(projection))throw Error('Method watch source changed: publish a new forward edition')
 console.log('Method watch matches the same canonical deadline; immutable provenance hash valid')
}else{
 const marker='-- CANONICAL METHOD EXPECTATION PROJECTION PLACEHOLDER';if(!content.includes(marker))throw Error('New migration placeholder missing; frozen publications cannot be rewritten')
 fs.writeFileSync(target,content.replace(marker,block).replaceAll('CANONICAL_METHOD_EXPECTATION_SOURCE_VERSION',edition.sourceVersion));console.log(`Generated canonical method watch ${edition.sourceVersion}`)
}
