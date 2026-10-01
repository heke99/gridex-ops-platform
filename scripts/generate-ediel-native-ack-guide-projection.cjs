// Derive immutable native guide data from the SAME TS guide owner used by all
// consumers. This is source data publication, never schema/type provenance.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const argv=process.argv.slice(2),option=name=>argv[argv.indexOf(name)+1]
const root=path.resolve(argv.includes('--repo-root')?option('--repo-root'):path.join(__dirname,'..')),target=path.resolve(option('--migration'))
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),inputs={},cache=new Map()
function load(file){
 if(!path.extname(file))file+='.ts'
 if(cache.has(file))return cache.get(file).exports
 if(!file.startsWith(root+path.sep))throw Error('ACK guide projection input outside repository')
 const source=fs.readFileSync(file,'utf8');inputs[path.relative(root,file)]=hash(source);const module={exports:{}};cache.set(file,module)
 if(path.extname(file)==='.json'){module.exports={__esModule:true,default:JSON.parse(source)};return module.exports}
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const localRequire=name=>{if(name.startsWith('@/'))return load(path.join(root,name.slice(2)));if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));throw Error(`ACK guide source unexpectedly imports runtime service: ${name}`)}
 new Function('require','module','exports',output)(localRequire,module,module.exports);return module.exports
}
const constraints=load(path.join(root,'lib/ediel/rulebook/ackGuidePolicy.ts')).CANONICAL_ACK_GUIDE_CONSTRAINTS
if(constraints?.version!==1||!constraints.PRODAT||!constraints.UTILTS||!constraints.CONTRL)throw Error('Shared canonical ACK guide constraints unavailable')
const manifestFile=path.join(root,'docs/ediel/masterplan-v2/registers/source_manifest.json'),manifestSource=fs.readFileSync(manifestFile,'utf8');inputs[path.relative(root,manifestFile)]=hash(manifestSource)
const sources=JSON.parse(manifestSource).filter(source=>Object.values(constraints).some(value=>value?.source?.id===source.id))
if(sources.length!==3)throw Error('ACK native source originals missing from frozen manifest')
inputs['scripts/generate-ediel-native-ack-guide-projection.cjs']=hash(fs.readFileSync(__filename,'utf8'))
const inputManifest=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))),projection={constraints,originalSources:sources},edition={sourceVersion:hash(JSON.stringify({inputManifest,projection})),inputManifest,projection}
const literal=JSON.stringify(edition).replaceAll("'","''"),block=`-- BEGIN CANONICAL ACK GUIDE PROJECTION\nINSERT INTO gridex_ediel_ack_guide.editions(source_version,input_manifest,projection)\nSELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '${literal}'::jsonb value) edition;\n-- END CANONICAL ACK GUIDE PROJECTION`
const content=fs.readFileSync(target,'utf8')
if(argv.includes('--check')){
 const match=content.match(/-- BEGIN CANONICAL ACK GUIDE PROJECTION[\s\S]*?FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)?.[1];if(!match)throw Error('Published native ACK guide edition unavailable')
 const published=JSON.parse(match.replaceAll("''","'"));if(published.sourceVersion!==hash(JSON.stringify({inputManifest:published.inputManifest,projection:published.projection})))throw Error('Native ACK guide input provenance hash invalid')
 if(JSON.stringify(published.projection)!==JSON.stringify(projection))throw Error('Canonical ACK guide values changed: publish a NEW forward edition')
 console.log('Native ACK guide source projection matches the current shared canonical owner; immutable publication provenance valid')
}else{
 const marker='-- CANONICAL ACK GUIDE PROJECTION PLACEHOLDER';if(!content.includes(marker))throw Error('New migration marker missing; existing publication must never be rewritten')
 fs.writeFileSync(target,content.replace(marker,block));console.log(`Generated same-owner P/U/T ACK guide source projection ${edition.sourceVersion}`)
}
