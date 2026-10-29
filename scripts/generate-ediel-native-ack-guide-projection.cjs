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
 // This authority is used only by exported live ACK validation functions,
 // never by the projected constants. Preserve its exact source hash but do
 // not load credentials/DB/transport transitively. Any value use fails closed.
 if(file===path.join(root,'lib/ediel/ack/prodatCommonHeaderRejectionAuthority.ts')){
  module.exports=new Proxy({}, {get(){throw Error('Runtime common-header authority cannot execute in source projection')}})
  return module.exports
 }
 if(path.extname(file)==='.json'){module.exports={__esModule:true,default:JSON.parse(source)};return module.exports}
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const localRequire=name=>{if(name.startsWith('@/'))return load(path.join(root,name.slice(2)));if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));throw Error(`ACK guide source unexpectedly imports runtime service: ${name}`)}
 new Function('require','module','exports',output)(localRequire,module,module.exports);return module.exports
}
// Explicit opt-in for a NEW Swedish U5 edition. Historical publications keep
// their original P/U/T identities; a current source is never a relabelled U.
function qualifiedCurrentSwedishUtilts(){
 if(!argv.includes('--current-swedish-utilts'))return null
 const file='docs/ediel/utilts-25a5/source-manifest.json',bytes=fs.readFileSync(path.join(root,file),'utf8')
 inputs[file]=hash(bytes)
 const manifest=JSON.parse(bytes),primary=manifest.primarySource
 const original=load(path.join(root,'lib/ediel/rulebook/utilts25A5.ts')).UTILTS_25_A_5_SOURCE
 const guides=load(path.join(root,'lib/ediel/rulebook/guideRegistry.ts'))
 const selected=guides.resolveAuthoritativeEdielGuide({family:'UTILTS',referenceDate:original.effectiveFrom,associationAssignedCode:'E5SE5A'})
 if(manifest.schema!=='gridex-ediel-source-supplement-v1'||primary?.id!=='U5-SV'||primary.language!=='sv'||primary.pages!==135
  ||primary.guideRevision!==original.guideRevision||primary.sha256!==original.sha256||primary.url!==original.locator
  ||primary.effectiveFrom!==original.effectiveFrom||primary.associationAssignedCode!=='E5SE5A'
  ||selected.guideRevision!==original.guideRevision||selected.primarySource?.sha256!==original.sha256)throw Error('Qualified current Swedish UTILTS primary required')
 for(const name of ['guideRegistry','canonicalEdielPolicy','utiltsRulebook','utilts25A4','utilts25A5','ackGuidePolicy']){
  const logical='lib/ediel/rulebook/'+name+'.ts';inputs[logical]=hash(fs.readFileSync(path.join(root,logical),'utf8'))
 }
 const scopes=load(path.join(root,'lib/ediel/rulebook/canonicalEdielFacade.ts')).canonicalRegisteredEdielGuideScopes()
 const scope=scopes.find(s=>s.family==='UTILTS'&&s.canonicalGuideRevision===original.guideRevision)
 if(!scope||scope.guideVersion!=='25-A-5'||scope.guideRevision!=='5')throw Error('Current Swedish UTILTS named scope required')
 const supersessions=guides.AUTHORITATIVE_EDIEL_GUIDES.filter(g=>g.family==='UTILTS'&&g.supersededBy===original.guideRevision).map(g=>{
  const old=scopes.find(s=>s.family==='UTILTS'&&s.canonicalGuideRevision===g.guideRevision)
  if(!old||!g.supersededFrom)throw Error('Source supersession requires named original scope')
  return {market:'electricity',family:'UTILTS',guideVersion:old.guideVersion,guideRevision:old.guideRevision,from:g.supersededFrom,supersededBy:original.guideRevision}
 })
 if(supersessions.length!==1||supersessions[0].guideVersion!=='25-A-4'||supersessions[0].from!==original.effectiveFrom)throw Error('Exact source U4 supersession required')
 const handbookFile='docs/ediel/handbook-26b/source-reconciliation.json',handbookBytes=fs.readFileSync(path.join(root,handbookFile),'utf8'),handbookManifest=JSON.parse(handbookBytes),handbook=handbookManifest.currentHandbook
 inputs[handbookFile]=hash(handbookBytes)
 const obligationSource='lib/ediel/rulebook/reportingObligationPolicy.ts';inputs[obligationSource]=hash(fs.readFileSync(path.join(root,obligationSource),'utf8'))
 if(handbook?.edition!=='26B'||handbook.date!=='2026-10-01'||handbook.url!=='https://www.elmarknadshandboken.se/Dokumentation/Texter/NEMHB.pdf'||handbook.allFrozenCriteriaRecertified!==false||!Array.isArray(handbookManifest.openQualifications))throw Error('Qualified current handbook26B dependency required')
 // Actual official235-page PDF identity, qualified independently of the JSON
 // reconciliation hash. This does not recertify frozen26A rules or legal clocks.
 const marketHandbook={id:'H26B',sourceType:'market_handbook',title:'Svensk Elmarknadshandbok26B',revision:handbook.edition,effectiveFrom:handbook.date,language:'sv',pages:235,
  sha256:'36d6a92ac55adecf427d8af21278144c045458a7234ca6487c95a1f4df2a1876',locator:handbook.url,allFrozenCriteriaRecertified:false,openQualifications:handbookManifest.openQualifications}
 return {sources:[{id:primary.id,filename:original.filename,language:original.language,pages:original.pages,guideVersion:scope.guideVersion,guideRevision:scope.guideRevision,primaryRevision:original.guideRevision,sha256:original.sha256,locator:original.locator,effectiveFrom:original.effectiveFrom}],marketHandbook,supersessions,scope}
}
const currentSwedishUtilts=qualifiedCurrentSwedishUtilts()

const constraints=load(path.join(root,'lib/ediel/rulebook/ackGuidePolicy.ts')).CANONICAL_ACK_GUIDE_CONSTRAINTS
if(constraints?.version!==1||!constraints.PRODAT||!constraints.UTILTS||!constraints.CONTRL)throw Error('Shared canonical ACK guide constraints unavailable')
const manifestFile=path.join(root,'docs/ediel/masterplan-v2/registers/source_manifest.json'),manifestSource=fs.readFileSync(manifestFile,'utf8');inputs[path.relative(root,manifestFile)]=hash(manifestSource)
const sources=JSON.parse(manifestSource).filter(source=>Object.values(constraints).some(value=>value?.source?.id===source.id))
if(sources.length!==3)throw Error('ACK native source originals missing from frozen manifest')
inputs['scripts/generate-ediel-native-ack-guide-projection.cjs']=hash(fs.readFileSync(__filename,'utf8'))
const inputManifest=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))),projection={constraints,originalSources:sources,...(currentSwedishUtilts?{qualifiedCurrentSources:currentSwedishUtilts.sources,qualifiedMarketHandbook:currentSwedishUtilts.marketHandbook}:{})},edition={sourceVersion:hash(JSON.stringify({inputManifest,projection})),inputManifest,projection}
const literal=JSON.stringify(edition).replaceAll("'","''"),block=`-- BEGIN CANONICAL ACK GUIDE PROJECTION\nINSERT INTO gridex_ediel_ack_guide.editions(source_version,input_manifest,projection)\nSELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '${literal}'::jsonb value) edition;\n-- END CANONICAL ACK GUIDE PROJECTION`
const content=fs.readFileSync(target,'utf8')
if(argv.includes('--check')){
 const match=content.match(/-- BEGIN CANONICAL ACK GUIDE PROJECTION[\s\S]*?FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)?.[1];if(!match)throw Error('Published native ACK guide edition unavailable')
 const published=JSON.parse(match.replaceAll("''","'"));if(published.sourceVersion!==hash(JSON.stringify({inputManifest:published.inputManifest,projection:published.projection})))throw Error('Native ACK guide input provenance hash invalid')
 if(JSON.stringify(published.projection)!==JSON.stringify(projection))throw Error('Canonical ACK guide values changed: publish a NEW forward edition')
 console.log('Native ACK guide source projection matches the current shared canonical owner; immutable publication provenance valid')
}else{
 const marker='-- CANONICAL ACK GUIDE PROJECTION PLACEHOLDER';if(!content.includes(marker))throw Error('New migration marker missing; existing publication must never be rewritten')
 fs.writeFileSync(target,content.replace(marker,()=>block));console.log(`Generated same-owner P/U/T ACK guide source projection ${edition.sourceVersion}`)
}
