import type {ParsedActorRegistryActor,ActorRegistryRoute} from './types'
const base=['Market','CompanyName','SvkId','EdielId','Address1','Address2','PostCode','Place','CountryCode','WebSiteAddress']
const block=['SubAddress','CommunicationAddress','InterchangePartyId','PartyId']
const nullable=(s:string)=>s===''?null:s
// Same normalisation as normalizeActor (kept local: this parser is also loaded
// standalone by scripts/ediel-authentic-registry-source-regression.mjs).
const cleanString=(s:string)=>s.replace(/\s+/g,' ').trim()||null
const normalizeEmail=(s:string)=>cleanString(s)?.toLowerCase()??null
/** Positional family blocks from SHA ee26868a... official 2026-09-10 export.
 * The unquoted address continuation is part of its original field. This is
 * deliberately separate from customer AI/BI CSV and custom actor CSV. Absent
 * org/role/charset/qualifier fields confer no defaults or send authority. */
export function parseActorRegistryTxt(text:string):ParsedActorRegistryActor[]{
 if(Buffer.byteLength(text,'utf8')>16777216||text.includes('\0'))throw Error('actor_registry_txt_source_limit')
 const lines=text.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').split('\n')
 const header=lines.shift()?.split(';')??[]
 if(base.some((key,n)=>header[n]!==key)||(header.length-base.length)%5!==0||header.length===base.length)throw Error('actor_registry_txt_header_required')
 const families:string[]=[]
 for(let offset=base.length;offset<header.length;offset+=5){
  const family=header[offset].match(/^Type ([A-Z][A-Z0-9_]*)$/)?.[1]
  if(!family||families.includes(family)||block.some((key,n)=>header[offset+n+1]!==key))throw Error('actor_registry_txt_header_family_blocks_required')
  families.push(family)
 }
 const records:Array<{raw:string;line:number}>=[];let current:{raw:string;line:number}|null=null;let generatedAt:string|null=null
 for(const [n,line] of lines.entries()){
  if(line.startsWith('Data generated at:')){
   if(generatedAt||n!==lines.findLastIndex(x=>x!==''))throw Error('actor_registry_txt_footer_ambiguous')
   generatedAt=line.slice('Data generated at:'.length);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(generatedAt)||!Number.isFinite(Date.parse(generatedAt)))throw Error('actor_registry_txt_footer_invalid');continue
  }
  if(!line&&n===lines.length-1)continue
  if(/^[A-Z][A-Z0-9_]{1,15};/.test(line)){
   if(current)records.push(current);current={raw:line,line:n+2}
  }else if(current&&current.raw.split(';').length<10){current.raw+='\n'+line}
  else throw Error(`actor_registry_txt_unbounded_continuation:line_${n+2}`)
 }
 if(current)records.push(current)
 if(!records.length||records.length>4096)throw Error('actor_registry_txt_record_limit')
 const actors=records.map(({raw,line}):ParsedActorRegistryActor=>{
  const fields=raw.split(';')
  if(fields.length<base.length||fields.length>header.length||(fields.length-base.length)%5!==0)throw Error(`actor_registry_txt_field_count:line_${line}`)
  if(!fields[0]||!fields[1])throw Error(`actor_registry_txt_identity_required:line_${line}`)
  if(fields.some((value,n)=>value.includes('\n')&&![4,5].includes(n)))throw Error(`actor_registry_txt_multiline_scope:line_${line}`)
  const market=fields[0]==='EL'||fields[0]==='GAS'?fields[0]:null
  const routes:ActorRegistryRoute[]=[],emptyFamilies:string[]=[]
  for(let n=0;n<families.length;n++){
   const offset=base.length+n*5;if(fields.length<=offset)continue
   const [family,subaddress,email,technical,legal]=fields.slice(offset,offset+5)
   if(!family){if(fields.slice(offset+1,offset+5).some(Boolean))throw Error(`actor_registry_txt_family_missing:line_${line}`);continue}
   if(family!==families[n]&&!family.startsWith(families[n]+'_'))throw Error(`actor_registry_txt_family_mismatch:line_${line}`)
   if(family.startsWith('UTILTS')&&subaddress)throw Error(`actor_registry_txt_utilts_subaddress:line_${line}`)
   // A family block without a declared SMTP address is not a route (the XML
   // adapter holds the same EDIFACTDetails as a diagnostic). The official export
   // writes e.g. `PRODAT;;;;;` or party ids without address; the atomic owner
   // rejects transport-less routes, which previously aborted the whole TXT file.
   if(!email){emptyFamilies.push(family);continue}
   const referenceOnly=!fields[3]||market!=='EL'||!['PRODAT','UTILTS'].includes(family)
   routes.push({messageFamily:family,market,environment:'production',applicationReference:null,subaddress:nullable(subaddress),communicationType:email?'smtp':null,
    communicationAddress:normalizeEmail(email),interchangePartyId:nullable(technical),partyId:nullable(legal),partyIdQualifier:null,partyIdResponsible:null,interchangeIdQualifier:null,ediCharset:null,ediSyntax:null,
    isVerified:false,status:referenceOnly?'blocked':'needs_review',metadata:{source:'companies_txt',originalFamily:family,originalMarket:fields[0],qualifiersUnspecified:true,representation_requires_mandate:technical!==legal}})
  }
  return{name:cleanString(fields[1])??fields[1],legalName:null,market,svkId:nullable(fields[2]),edielId:nullable(fields[3]),orgNumber:null,eic:null,countryCode:nullable(fields[8]),roles:[],certificates:[],routes,
   raw:{sourceKind:'companies_txt',sourceFragment:raw,sourceLine:line,generatedAt,originalMarket:fields[0],originalCountry:fields[8],originalRoles:[],fields:Object.fromEntries(base.map((key,n)=>[key,fields[n]])),diagnostics:[...(!routes.length?['registered_routes_absent']:[]),...emptyFamilies.map(family=>`declared_family_without_transport:${family}`),...(!fields[3]?['registered_legal_identifier_absent']:[])],extractedWith:'official_txt_positional_family_blocks_v1'}}
 })
 if(!actors.some(actor=>actor.routes.length))throw Error('actor_registry_txt_zero_routes_requires_review')
 return actors
}
