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
const inputManifest=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))),projection={constraints,ackMatrix,scopes,profiles,logicalCodes,...(currentSwedishUtilts?{qualifiedCurrentSources:currentSwedishUtilts.sources,qualifiedMarketHandbook:currentSwedishUtilts.marketHandbook}:{})},edition={sourceVersion:hash(JSON.stringify({inputManifest,projection})),inputManifest,projection}
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
 fs.writeFileSync(target,content.replace(marker,()=>block).replaceAll('CANONICAL_TECHNICAL_EXPECTATION_SOURCE_VERSION',edition.sourceVersion));console.log(`Generated same-owner technical expectation projection ${edition.sourceVersion}`)
}
