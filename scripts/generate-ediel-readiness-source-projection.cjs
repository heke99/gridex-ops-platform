// Derivative of the existing canonical source authority, not a second role table.
// Regenerate only into a NEW forward migration. --check verifies an existing
// immutable publication against the current source catalog without rewriting it.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const argv = process.argv.slice(2)
const option = name => argv[argv.indexOf(name) + 1]
const root = path.resolve(argv.includes('--repo-root') ? option('--repo-root') : path.join(__dirname, '..'))
const target = path.resolve(option('--migration'))
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const inputs = {}; const cache = new Map()
function load(file) {
  if (!path.extname(file)) file += '.ts'
  if (cache.has(file)) return cache.get(file).exports
  if (!file.startsWith(root + path.sep)) throw new Error('Source projection must stay inside the repository')
  const source = fs.readFileSync(file, 'utf8'); inputs[path.relative(root, file)] = hash(source)
  const module = { exports: {} }; cache.set(file, module)
  if (path.extname(file) === '.json') {
    // TypeScript's resolveJsonModule emits a default import while ordinary
    // require retains the JSON value. Supply both through its __esModule
    // interop contract without transpiling JSON as TypeScript source.
    const value = JSON.parse(source)
    module.exports = { __esModule: true, default: value }
    return module.exports
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const localRequire = name => {
    if (name.startsWith('@/')) return load(path.join(root, name.slice(2)))
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name))
    throw new Error(`Canonical projection unexpectedly requires a runtime service: ${name}`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports)
  return module.exports
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

const authority = load(path.join(root, 'lib/ediel/rulebook/canonicalEdielFacade.ts'))
const inboundContext = argv.includes('--with-inbound-context')
const utiltsApplications = inboundContext ? load(path.join(root, 'lib/ediel/rulebook/utiltsApplicationReference.ts')) : null
const rows = authority.canonicalBusinessSemanticsCatalog().filter(row => ['PRODAT', 'UTILTS'].includes(row.family)).map(row => ({
  family: row.family, code: row.code, subtype: row.subtype, transactionReasonCode: row.transactionReasonCode,
  senderRoles: [...row.senderRoles], direction: row.direction,
  ...(inboundContext ? { receiverRoles: [...row.receiverRoles], applicationReferences: row.family === 'PRODAT'
    ? [authority.canonicalProdatProfileForMessage(row.code).applicationReference]
    : [...new Set((utiltsApplications.UTILTS_25_A_3_REQUEST_TARGETS[row.code] ?? [row.code])
      .flatMap(code => utiltsApplications.UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES[code] ?? []))].sort() } : {}),
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
let registryProjection=null
if(currentSwedishUtilts){
 const owner=load(path.join(root,'lib/ediel/rulebook/utiltsRulebook.ts'))
 const semantics=authority.canonicalBusinessSemanticsCatalog().filter(row=>['UTILTS','UTILTS_ERR'].includes(row.family))
 const profiles=owner.UTILTS_CANONICAL_PROFILES.map(base=>{
  const profile=owner.resolveCanonicalUtiltsProfile({messageCode:base.messageCode,businessDate:currentSwedishUtilts.sources[0].effectiveFrom,version:'E5SE5A'})
  const semantic=semantics.find(row=>row.code===profile.messageCode)
  if(!semantic||profile.guideVersion!=='25-A-5'||profile.guideRevision!=='5')throw Error('Current named canonical UTILTS profile required')
  // Registry activation is deliberately narrower than the guide: manual and
  // partial supplier sends acquire no new outbound or state capability.
  const builder=profile.productionReadiness==='full'||profile.productionReadiness==='ack_only'
  const direction=profile.messageCode==='ERR'?'both':builder?semantic.direction:'inbound'
  return {messageCode:profile.messageCode,direction,businessProcess:profile.businessProcess,phase:profile.phase,
   profileKey:`UTILTS:${profile.messageCode}:E5SE5A:5`,profile:{...profile,family:'UTILTS',canonicalDirection:direction,source:'canonical-swedish-utilts25a5-projection',sourceDependencies:{marketHandbook:currentSwedishUtilts.marketHandbook}},
   capabilities:{parser:true,builder,validator:true,ack:true,state:profile.productionReadiness!=='partial'}}
 })
 registryProjection={primary:currentSwedishUtilts.sources[0],marketHandbook:currentSwedishUtilts.marketHandbook,supersessions:currentSwedishUtilts.supersessions,profiles}
}
inputs['scripts/generate-ediel-readiness-source-projection.cjs'] = hash(fs.readFileSync(__filename, 'utf8'))
const manifest = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)))
const edition = { sourceVersion: hash(JSON.stringify({ inputManifest: manifest, catalog: rows })), inputManifest: manifest, catalog: rows }
const literal = JSON.stringify(edition).replaceAll("'", "''")
const block = `-- BEGIN CANONICAL SOURCE PROJECTION\nINSERT INTO gridex_ediel_readiness.source_editions(source_version,input_manifest,catalog)\nSELECT value->>'sourceVersion',value->'inputManifest',value->'catalog' FROM (SELECT '${literal}'::jsonb value) edition;\n-- END CANONICAL SOURCE PROJECTION`
let registryBlock=null
if(registryProjection){
 const registration={sourceVersion:hash(JSON.stringify({inputManifest:manifest,projection:registryProjection})),inputManifest:manifest,projection:registryProjection}
 const data=JSON.stringify(registration).replaceAll("'","''"),supersessions=JSON.stringify(registryProjection.supersessions).replaceAll("'","''")
 registryBlock=`-- BEGIN CURRENT SWEDISH UTILTS REGISTRY PROJECTION
DO $register_swedish_utilts25a5$
DECLARE edition jsonb:='${data}'::jsonb;data jsonb;pack_id uuid;item jsonb;
BEGIN
 data:=edition->'projection';
 IF EXISTS(SELECT FROM public.ediel_rule_packs WHERE market='electricity' AND family='UTILTS' AND guide_version='25-A-5' AND guide_revision='5') THEN RAISE EXCEPTION 'ediel_swedish_utilts25a5_new_named_pack_required';END IF;
 INSERT INTO public.ediel_rule_packs(market,family,guide_version,guide_revision,unh_association_code,valid_from,valid_to,status,source_document,source_hash,field_matrix_version,code_list_versions,metadata)
 VALUES('electricity','UTILTS','25-A-5','5','E5SE5A',(data#>>'{primary,effectiveFrom}')::date,NULL,'active',data#>>'{primary,filename}',edition->>'sourceVersion','25-A-5','{"market":"Sweden"}',jsonb_build_object('sourceInputManifest',edition->'inputManifest','primary',data->'primary','qualification','source implementation; native and market activation remain separate')) RETURNING id INTO pack_id;
 INSERT INTO public.ediel_rule_pack_sources(rule_pack_id,source_type,priority,title,revision,valid_from,source_hash,source_locator,metadata)
 VALUES(pack_id,'technical_guide',3,data#>>'{primary,filename}','25-A-5',(data#>>'{primary,effectiveFrom}')::date,data#>>'{primary,sha256}',data#>>'{primary,locator}',jsonb_build_object('sourceId','U5-SV','language','sv','sourceVersion',edition->>'sourceVersion'));
 INSERT INTO public.ediel_rule_pack_sources(rule_pack_id,source_type,priority,title,revision,valid_from,source_hash,source_locator,metadata)
 VALUES(pack_id,'market_handbook',2,data#>>'{marketHandbook,title}',data#>>'{marketHandbook,revision}',(data#>>'{marketHandbook,effectiveFrom}')::date,data#>>'{marketHandbook,sha256}',data#>>'{marketHandbook,locator}',jsonb_build_object('sourceId','H26B','sourceVersion',edition->>'sourceVersion','allFrozenCriteriaRecertified',false,'openQualifications',data#>'{marketHandbook,openQualifications}'));
 FOR item IN SELECT value FROM jsonb_array_elements(data->'profiles') LOOP
  INSERT INTO public.ediel_message_profiles(rule_pack_id,message_code,transaction_subtype,direction,business_process,phase,profile_key,profile)
  VALUES(pack_id,item->>'messageCode','',item->>'direction',item->>'businessProcess',item->>'phase',item->>'profileKey',item->'profile');
  INSERT INTO public.ediel_runtime_capabilities(rule_pack_id,message_code,transaction_subtype,direction,parser_ready,builder_ready,validator_ready,ack_ready,state_machine_ready,verification)
  VALUES(pack_id,item->>'messageCode','',item->>'direction',(item#>>'{capabilities,parser}')::boolean,(item#>>'{capabilities,builder}')::boolean,(item#>>'{capabilities,validator}')::boolean,(item#>>'{capabilities,ack}')::boolean,(item#>>'{capabilities,state}')::boolean,
   jsonb_build_object('source','canonical-swedish-utilts25a5-projection','sourceVersion',edition->>'sourceVersion','implementationProfile',item#>>'{profile,productionReadiness}','nativeTests','NOT_RUN','marketAuthorization','NOT_GRANTED'));
 END LOOP;
END $register_swedish_utilts25a5$;
-- Supersession is a source fact, not a test for a currently eligible successor.
-- Missing/draft/disabled U5 must HOLD, never resurrect U4. No old row is edited.
CREATE FUNCTION gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(p_market text,p_family text,p_version text,p_revision text,p_date date) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $supersession$
 SELECT EXISTS(SELECT FROM jsonb_array_elements('${supersessions}'::jsonb)s WHERE s->>'market'=p_market AND s->>'family'=p_family AND s->>'guideVersion'=p_version AND s->>'guideRevision'=p_revision AND p_date>=(s->>'from')::date)
$supersession$;
REVOKE ALL ON FUNCTION gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(text,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;
-- END CURRENT SWEDISH UTILTS REGISTRY PROJECTION`
}
const content = fs.readFileSync(target, 'utf8')
if (argv.includes('--check')) {
  const publishedLiteral = content.match(/-- BEGIN CANONICAL SOURCE PROJECTION[\s\S]*?FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)?.[1]
  if (!publishedLiteral) throw new Error('Published canonical projection unavailable')
  const published = JSON.parse(publishedLiteral.replaceAll("''", "'"))
  if (hash(JSON.stringify(published.inputManifest)) !== published.sourceVersion
    && hash(JSON.stringify({ inputManifest: published.inputManifest, catalog: published.catalog })) !== published.sourceVersion) throw new Error('Published source input provenance hash mismatch')
  if (JSON.stringify(published.catalog) !== JSON.stringify(rows)) throw new Error('Readiness source projection differs from the current canonical catalog; publish a new forward edition')
  const changedInputs = Object.keys(manifest).filter(file => published.inputManifest[file] !== manifest[file]).length
  console.log(`Canonical readiness projection: ${rows.length} current own scopes match; immutable publication input provenance valid; ${changedInputs} source files changed since publication without changing projected scope values`)
} else {
  const marker = '-- CANONICAL SOURCE PROJECTION PLACEHOLDER'
  if (!content.includes(marker)) throw new Error('New migration projection placeholder missing; never rewrite a published edition')
  let generated=content.replace(marker,()=>block)
  if(currentSwedishUtilts){
   const registryMarker='-- CURRENT SWEDISH UTILTS REGISTRY PROJECTION PLACEHOLDER'
   if(!generated.includes(registryMarker))throw new Error('New current registry projection marker required')
   generated=generated.replace(registryMarker,()=>registryBlock)
  }
  fs.writeFileSync(target,generated)
  console.log(`Generated ${rows.length} canonical readiness scopes; actual source version ${edition.sourceVersion}`)
}
