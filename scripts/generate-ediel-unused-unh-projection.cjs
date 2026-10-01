// A derivative of the SAME pure source port, never a second profile/rule map.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const argv=process.argv.slice(2),root=path.resolve(__dirname,'..'),target=path.resolve(argv[argv.indexOf('--migration')+1])
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),inputs={},cache=new Map()
function load(file){
 if(cache.has(file))return cache.get(file)
 const source=fs.readFileSync(path.join(root,file),'utf8');inputs[file]=hash(source)
 if(file.endsWith('.json'))return {__esModule:true,default:JSON.parse(source)}
 const module={exports:{}};cache.set(file,module.exports)
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('require','module','exports',output)(specifier=>{
  const resolved=specifier.startsWith('@/')?specifier.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier))+'.ts'
  const allowed=['lib/ediel/core/edifactReferenceConstraints.ts','docs/ediel/masterplan-v2/registers/source_manifest.json']
  // The generator only reads the constant; actual tokenizer is not executed.
  if(resolved==='lib/ediel/core/edifactTokenizer.ts')return {}
  if(!allowed.includes(resolved))throw Error(`Unexpected UNH source dependency: ${specifier}`)
  return load(resolved)
 },module,module.exports)
 cache.set(file,module.exports);return module.exports
}
const projection=load('lib/ediel/core/edifactHeaderConstraints.ts').EDIFACT_UNUSED_HEADER_CONSTRAINTS
if(projection?.version!==1||!projection.profiles.length)throw Error('Unused UNH source port unavailable')
inputs['scripts/generate-ediel-unused-unh-projection.cjs']=hash(fs.readFileSync(__filename,'utf8'))
const edition={sourceVersion:hash(JSON.stringify({inputManifest:inputs,projection})),inputManifest:inputs,projection},content=fs.readFileSync(target,'utf8')
if(argv.includes('--check')){
 const literal=content.match(/-- BEGIN CANONICAL UNUSED UNH PROJECTION\n-- (.+)\n-- END CANONICAL UNUSED UNH PROJECTION/)?.[1]
 if(!literal)throw Error('Published unused UNH edition missing')
 const published=JSON.parse(literal)
 if(published.sourceVersion!==hash(JSON.stringify({inputManifest:published.inputManifest,projection:published.projection})))throw Error('Unused UNH provenance invalid')
 if(JSON.stringify(published.projection)!==JSON.stringify(projection))throw Error('Unused UNH source changed: publish a NEW forward')
 console.log('Unused UNH native projection matches the same source owner')
}else{
 if(!content.includes('-- CANONICAL UNUSED UNH PROJECTION PLACEHOLDER'))throw Error('Existing UNH publication must never be rewritten')
 fs.writeFileSync(target,content.replace('-- CANONICAL UNUSED UNH PROJECTION PLACEHOLDER',`-- BEGIN CANONICAL UNUSED UNH PROJECTION\n-- ${JSON.stringify(edition)}\n-- END CANONICAL UNUSED UNH PROJECTION`).replaceAll('__UNUSED_UNH_PROJECTION__',JSON.stringify(projection).replaceAll("'","''")))
 console.log(`Generated unused UNH source projection ${edition.sourceVersion}`)
}
