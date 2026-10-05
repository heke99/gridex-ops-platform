// Publish only to an actual new CLI migration. Frozen requirements stay intact.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),target=path.resolve(process.argv[2]),inputs={},cache=new Map()
const hash=value=>crypto.createHash('sha256').update(value).digest('hex')
function load(file){
 if(!path.extname(file))file+='.ts'
 if(cache.has(file))return cache.get(file).exports
 if(!file.startsWith(root+path.sep))throw Error('Source must stay in repository')
 const text=fs.readFileSync(file,'utf8');inputs[path.relative(root,file)]=hash(text)
 const module={exports:{}};cache.set(file,module)
 const output=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('require','module','exports',output)(name=>{if(name.startsWith('@/'))return load(path.join(root,name.slice(2)));if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));throw Error(`Unexpected runtime dependency ${name}`)},module,module.exports)
 return module.exports
}
const guides=load(path.join(root,'lib/ediel/rulebook/guideRegistry.ts')).AUTHORITATIVE_EDIEL_GUIDES.filter(g=>g.family==='PRODAT')
const profiles=load(path.join(root,'lib/ediel/rulebook/prodatRulebook.ts')).PRODAT_CANONICAL_PROFILES
const fields=load(path.join(root,'lib/ediel/prodat/prodat26AFieldMatrix.ts'))
const labels=load(path.join(root,'lib/ediel/prodat/prodatAperakText.ts'))
const packs=[...new Set(profiles.map(p=>`${p.guideVersion}:r${p.guideRevision}`))]
if(packs.length!==1||guides.length!==1||fields.PRODAT_26A_FIELD_MATRIX.find(f=>f.fieldNumber==='202')?.documentElement!==1)throw Error('Common source projection requires explicit family/field authority')
const ack=load(path.join(root,'lib/ediel/rulebook/ackGuidePolicy.ts')).CANONICAL_ACK_GUIDE_CONSTRAINTS
const catalog={ackConstraints:ack.PRODAT,commonAckConstraints:ack.common,family:'PRODAT',technicalType:['PRODAT','D','97A','UN',guides[0].associationAssignedCode],guides,registeredVersion:packs[0],allowedCodes:[...fields.PRODAT_26A_MESSAGE_CODES],applicationReferences:[...new Set(profiles.map(p=>p.applicationReference))].sort(),field:'202',label:labels.prodatAperakFieldWireLabel('202')}
const manifestPath=path.join(root,'docs/ediel/masterplan-v2/registers/source_manifest.json'),manifestText=fs.readFileSync(manifestPath,'utf8')
inputs[path.relative(root,manifestPath)]=hash(manifestText);inputs[path.relative(root,__filename)]=hash(fs.readFileSync(__filename,'utf8'))
const inputManifest=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b)))
const edition={sourceVersion:hash(JSON.stringify({inputManifest,catalog})),inputManifest,catalog,originalSource:JSON.parse(manifestText).find(s=>s.id==='P')}
const content=fs.readFileSync(target,'utf8'),literal=JSON.stringify(edition).replaceAll("'","''")
if(!content.includes('-- COMMON HEADER SOURCE PLACEHOLDER'))throw Error('Never rewrite a published projection')
fs.writeFileSync(target,content.replace('-- COMMON HEADER SOURCE PLACEHOLDER',`INSERT INTO gridex_ediel_common_header.source_editions SELECT value->>'sourceVersion',value FROM(SELECT '${literal}'::jsonb value) edition;`))
console.log(`Generated source-bound common field202 edition ${edition.sourceVersion}; ${catalog.allowedCodes.length} original codes`)
