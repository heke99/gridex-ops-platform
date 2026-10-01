// Derive the native internal sender watch from the actual shared TS builder,
// acknowledgement matrix and sole spec deadline constant. No local timer table.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const argv=process.argv.slice(2),option=name=>argv[argv.indexOf(name)+1]
const root=path.resolve(argv.includes('--repo-root')?option('--repo-root'):path.join(__dirname,'..')),target=path.resolve(option('--migration'))
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),inputs={},cache=new Map()
function load(file){
 if(!path.extname(file))file+='.ts'
 if(cache.has(file))return cache.get(file).exports
 if(!file.startsWith(root+path.sep))throw Error('ACK guide projection input outside repository')
 const sourceFile=argv.includes('--shared-guide-source')&&file===path.join(root,'lib/ediel/rulebook/ackGuidePolicy.ts')?path.resolve(option('--shared-guide-source')):argv.includes('--shared-identity-source')&&file===path.join(root,'lib/ediel/utilts/headerIdentityGuide.ts')?path.resolve(option('--shared-identity-source')):file
 const source=fs.readFileSync(sourceFile,'utf8');inputs[path.relative(root,file)]=hash(source);const module={exports:{}};cache.set(file,module)
 if(path.extname(file)==='.json'){module.exports={__esModule:true,default:JSON.parse(source)};return module.exports}
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const localRequire=name=>{if(name.startsWith('@/'))return load(path.join(root,name.slice(2)));if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));throw Error(`ACK guide source unexpectedly imports runtime service: ${name}`)}
 new Function('require','module','exports',output)(localRequire,module,module.exports);return module.exports
}
const port=load(path.join(root,'lib/ediel/technicalExpectations.ts'))
const constraints=port.EDIEL_TECHNICAL_ACK_EXPECTATION_CONSTRAINTS
const ackMatrix=load(path.join(root,'lib/ediel/ack/canonicalAckEngine.ts')).listCanonicalAckMatrix()
const facade=load(path.join(root,'lib/ediel/rulebook/canonicalEdielFacade.ts'))
const scopes=facade.canonicalRegisteredEdielGuideScopes()
const logicalCodes=facade.canonicalLogicalMessageCodeProjection()
const profiles=[...load(path.join(root,'lib/ediel/rulebook/prodatRulebook.ts')).PRODAT_CANONICAL_PROFILES.map(p=>({family:'PRODAT',code:p.messageCode,profileKey:p.profileKey})),...load(path.join(root,'lib/ediel/rulebook/utiltsRulebook.ts')).UTILTS_CANONICAL_PROFILES.map(p=>({family:p.messageCode==='ERR'?'UTILTS_ERR':'UTILTS',code:p.messageCode,profileKey:p.profileKey})),{family:'APERAK',code:'APERAK',profileKey:null}]
if(constraints?.version!==1||!Number.isSafeInteger(constraints.offset)||constraints.offset<=0||constraints.anchor!=='actual_accepted_smtp_observed_at'||!Array.isArray(ackMatrix))throw Error('Actual technical watch source port unavailable')
for(const name of ['lib/ediel/businessExpectations.ts','docs/ediel/masterplan-v2/registers/source_manifest.json'])inputs[name]=hash(fs.readFileSync(path.join(root,name),'utf8'))
inputs['scripts/generate-ediel-native-technical-expectation-projection.cjs']=hash(fs.readFileSync(__filename,'utf8'))
const inputManifest=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))),projection={constraints,ackMatrix,scopes,profiles,logicalCodes},edition={sourceVersion:hash(JSON.stringify({inputManifest,projection})),inputManifest,projection}
const literal=JSON.stringify(edition).replaceAll("'","''"),block=`-- BEGIN CANONICAL TECHNICAL EXPECTATION PROJECTION
INSERT INTO gridex_ediel_transport.technical_expectation_editions(source_version,input_manifest,projection)
SELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '${literal}'::jsonb value) edition;
-- END CANONICAL TECHNICAL EXPECTATION PROJECTION`
const content=fs.readFileSync(target,'utf8')
if(argv.includes('--check')){
 const match=content.match(/-- BEGIN CANONICAL TECHNICAL EXPECTATION PROJECTION[\s\S]*?FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)?.[1];if(!match)throw Error('Published native technical expectation edition unavailable')
 const published=JSON.parse(match.replaceAll("''","'"));if(published.sourceVersion!==hash(JSON.stringify({inputManifest:published.inputManifest,projection:published.projection})))throw Error('Native technical expectation input provenance hash invalid')
 if(JSON.stringify(published.projection)!==JSON.stringify(projection))throw Error('Canonical technical expectation values changed: publish a NEW forward edition')
 console.log('Native technical watch projection matches the actual shared source port; immutable publication provenance valid')
}else{
 const marker='-- CANONICAL TECHNICAL EXPECTATION PROJECTION PLACEHOLDER';if(!content.includes(marker))throw Error('New migration marker missing; existing publication must never be rewritten')
 fs.writeFileSync(target,content.replace(marker,block).replaceAll('CANONICAL_TECHNICAL_EXPECTATION_SOURCE_VERSION',edition.sourceVersion));console.log(`Generated same-owner technical expectation projection ${edition.sourceVersion}`)
}
