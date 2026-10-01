// Native bounds are a derivative of the same pure source port used by the
// codec, syntax validator and canonical facade. No runtime/DB import is allowed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const argv=process.argv.slice(2),target=path.resolve(argv[argv.indexOf('--migration')+1]),root=path.resolve(__dirname,'..')
const hash=value=>crypto.createHash('sha256').update(value).digest('hex')
const owner='lib/ediel/core/edifactReferenceConstraints.ts',manifest='docs/ediel/masterplan-v2/registers/source_manifest.json'
const source=fs.readFileSync(path.join(root,owner),'utf8'),data=fs.readFileSync(path.join(root,manifest),'utf8'),moduleValue={exports:{}}
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
new Function('require','module','exports',output)(specifier=>{
 if(specifier!==`@/${manifest}`)throw Error(`Unexpected reference source dependency: ${specifier}`)
 return {__esModule:true,default:JSON.parse(data)}
},moduleValue,moduleValue.exports)
const projection=moduleValue.exports.EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS
if(projection?.version!==1||!Array.isArray(projection.profiles)||!projection.profiles.length)throw Error('Message reference source port unavailable')
const inputManifest={[owner]:hash(source),[manifest]:hash(data),'scripts/generate-ediel-message-reference-projection.cjs':hash(fs.readFileSync(__filename,'utf8'))}
const edition={sourceVersion:hash(JSON.stringify({inputManifest,projection})),inputManifest,projection},content=fs.readFileSync(target,'utf8')
if(argv.includes('--check')){
 const literal=content.match(/-- BEGIN CANONICAL MESSAGE REFERENCE PROJECTION\n-- (.+)\n-- END CANONICAL MESSAGE REFERENCE PROJECTION/)?.[1]
 if(!literal)throw Error('Published reference edition missing')
 const published=JSON.parse(literal)
 if(published.sourceVersion!==hash(JSON.stringify({inputManifest:published.inputManifest,projection:published.projection})))throw Error('Reference projection provenance invalid')
 if(JSON.stringify(published.projection)!==JSON.stringify(projection))throw Error('Reference source changed: publish a NEW forward')
 console.log('Message reference native projection matches the same source owner')
}else{
 if(!content.includes('-- CANONICAL MESSAGE REFERENCE PROJECTION PLACEHOLDER'))throw Error('Existing reference publication must never be rewritten')
 fs.writeFileSync(target,content.replace('-- CANONICAL MESSAGE REFERENCE PROJECTION PLACEHOLDER',`-- BEGIN CANONICAL MESSAGE REFERENCE PROJECTION\n-- ${JSON.stringify(edition)}\n-- END CANONICAL MESSAGE REFERENCE PROJECTION`).replaceAll('__REFERENCE_PROJECTION__',JSON.stringify(projection).replaceAll("'","''")))
 console.log(`Generated reference source projection ${edition.sourceVersion}`)
}
