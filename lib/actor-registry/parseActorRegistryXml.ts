import { XMLParser, XMLValidator, type XMLMetaData } from 'fast-xml-parser'
import type { ParsedActorRegistryActor, ActorRegistryRoute, ActorRegistryCertificate } from './types'
import { cleanString, normalizeEdielId, normalizeEmail, normalizeEic, normalizeOrgNumber, normalizeRole, normalizeSubaddress, uniqueStrings } from './normalizeActor'

type Node = Record<string, unknown>
const node = (value: unknown): Node => value && typeof value === 'object' && !Array.isArray(value) ? value as Node : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined ? [] : [value]
function decode(value:string):string {
  if(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(value))throw new Error('actor_registry_xml_unresolved_entity')
  return value.replace(/&#(x[\da-f]+|\d+);/gi,(_all,code:string)=>{
    const point=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code)
    if(point<=0||point>0x10ffff||point>=0xd800&&point<=0xdfff)throw new Error('actor_registry_xml_invalid_character')
    return String.fromCodePoint(point)
  }).replace(/&(?:amp|lt|gt|quot|apos);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[entity]!))
}
function text(value:unknown):string|null {
  if(typeof value==='string')return cleanString(decode(value))
  const n=node(value)
  if(typeof n['#cdata']==='string')return cleanString(n['#cdata'])
  return typeof n['#text']==='string'?cleanString(decode(n['#text'])):null
}
function field(n:Node,names:string[]):string|null {
  for(const name of names){const key=Object.keys(n).find(key=>key.toLowerCase()===name.toLowerCase());if(key){const values=list(n[key]);if(values.length!==1)throw new Error('actor_registry_xml_ambiguous_field');const value=text(values[0]);if(value)return value}}
  return null
}
const attr=(n:Node,names:string[])=>field(n,names.map(name=>`@_${name}`))
function descendants(n:Node,names:string[]):unknown[] {
  const result:unknown[]=[]
  for(const [key,value] of Object.entries(n)){
    if(key.startsWith('@_')||key.startsWith('#'))continue
    for(const child of list(value)){
      if(names.some(name=>name.toLowerCase()===key.toLowerCase()))result.push(child)
      else result.push(...descendants(node(child),names))
    }
  }
  return result
}
const env=(value:string|null):'test'|'production'=>['test','t','qa'].includes(value?.toLowerCase()??'')?'test':'production'
const family=(value:string|null)=>value?.toUpperCase()??'PRODAT'
function routes(company:Node,edielId:string|null,market:ParsedActorRegistryActor['market']):ActorRegistryRoute[]{
  const result:ActorRegistryRoute[]=descendants(company,['EDIFACTDetails','Route','CommunicationRoute','MessageRoute','Address']).map(value=>{
    const r=node(value), partyNode=node(r.PartyId??r.PartyID), interchangeNode=node(r.InterchangePartyId??r.InterchangePartyID), address=node(r.CommunicationAddress)
    const partyId=normalizeEdielId(field(r,['PartyId','PartyID','SenderId','UNBPartyId','EdielId'])??attr(r,['partyId','senderId'])??edielId)
    const interchangePartyId=normalizeEdielId(field(r,['InterchangePartyId','InterchangePartyID','TechnicalPartyId','TransportPartyId'])??attr(r,['interchangePartyId','technicalPartyId'])??partyId)
    const represented=Boolean(partyId&&interchangePartyId&&partyId!==interchangePartyId)
    const communicationAddress=normalizeEmail(field(r,['CommunicationAddress','Address','Email','SmtpEmail','SMTP'])??attr(r,['email','smtp','address']))
    const messageFamily=family(field(r,['MessageFamily','MessageType','ApplicationReference','Family'])??attr(r,['Type','messageFamily','messageType','family']))
    return {messageFamily,market,environment:env(field(r,['Environment','Env'])??attr(r,['environment','env'])),
      applicationReference:field(r,['ApplicationReference','ApplicationRef'])??attr(r,['applicationReference'])??messageFamily,
      subaddress:normalizeSubaddress(field(r,['SubAddress','Subaddress','Sub-Address'])??attr(r,['subaddress','subAddress'])),
      communicationType:field(r,['CommunicationType','Protocol','TransportType'])??attr(address,['Type'])??attr(r,['communicationType','protocol'])??(communicationAddress?'smtp':null),
      communicationAddress,partyId,interchangePartyId,
      partyIdQualifier:attr(partyNode,['IdCodeQualifier']),partyIdResponsible:attr(partyNode,['IdCodeResponsible']),interchangeIdQualifier:attr(interchangeNode,['IdCodeQualifier']),
      ediCharset:field(r,['EDICharset','EdiCharset']),ediSyntax:field(r,['EDISyntax','EdiSyntax']),
      status:market==='GAS'?'blocked':market!=='EL'||represented?'needs_review':'active',
      isVerified:market==='EL'&&!represented&&Boolean(partyId&&communicationAddress),metadata:{source:'xml_import',representation_requires_mandate:represented}}
  }) satisfies ActorRegistryRoute[]
  const fallback=normalizeEmail(field(company,['SmtpEmail','Email','CommunicationEmail']))
  if(!result.length&&fallback)result.push({messageFamily:'PRODAT',market,environment:'production',applicationReference:'PRODAT',communicationAddress:fallback,communicationType:'smtp',partyId:edielId,interchangePartyId:edielId,subaddress:null,status:'needs_review',isVerified:false,metadata:{source:'xml_import_fallback',family_requires_registry_confirmation:true}})
  return result
}
function certificates(company:Node):ActorRegistryCertificate[]{
  return descendants(company,['Certificate','X509Certificate','PublicCertificate']).map(value=>{const c=node(value);return{
    environment:env(field(c,['Environment','Env'])??attr(c,['environment','env'])),purpose:cleanString(field(c,['Purpose','Usage'])??attr(c,['purpose','usage']))?.toLowerCase()??'encryption',
    pem:field(c,['PEM','Pem','CertificatePem','PublicCertificatePem'])??(text(value)?.includes('BEGIN CERTIFICATE')?text(value):null),
    fingerprintSha256:field(c,['FingerprintSha256','SHA256','Fingerprint'])??attr(c,['fingerprintSha256','sha256']),validFrom:field(c,['ValidFrom','NotBefore']),validTo:field(c,['ValidTo','NotAfter']),subject:field(c,['Subject']),issuer:field(c,['Issuer']),serialNumber:field(c,['SerialNumber']),metadata:{source:'xml_import'}}})
}
/** Parse actual Market/Company AST nodes. Comments/CDATA never become records.
 * Source text is bounded, validated and never expands external/custom entities. */
export function parseActorRegistryXml(xml:string):ParsedActorRegistryActor[]{
  if(Buffer.byteLength(xml,'utf8')>16*1024*1024)throw new Error('actor_registry_xml_too_large')
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new Error('actor_registry_xml_unsafe_declaration')
  if(XMLValidator.validate(xml)!==true)throw new Error('actor_registry_xml_invalid')
  const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:false,htmlEntities:false,captureMetaData:true,cdataPropName:'#cdata',removeNSPrefix:true,maxNestedTags:32}).parse(xml)
  const actors:ParsedActorRegistryActor[]=[]
  function walk(parent:Node,marketContext:string|null=null,countryContext:string|null=null){
    for(const [key,value] of Object.entries(parent)){
      if(key.startsWith('@_')||key.startsWith('#')||key.startsWith('?'))continue
      for(const child of list(value)){
        const c=node(child)
        if(key.toLowerCase()==='market'&&descendants(c,['Company']).length){walk(c,attr(c,['Code'])??field(c,['Code']),attr(c,['CountryCode','Country'])??field(c,['CountryCode','Country']));continue}
        if(!['actor','marketactor','company','organisation','organization'].includes(key.toLowerCase())){walk(c,marketContext,countryContext);continue}
        if(actors.length>=4096)throw new Error('actor_registry_xml_record_limit')
        const keys:Record<string,string|null>={}
        for(const value of descendants(c,['Key'])){const k=node(value),type=attr(k,['Type']);if(type){if(type in keys)throw new Error('actor_registry_xml_duplicate_identifier');keys[type]=text(value)}}
        const rawMarket=marketContext??attr(c,['Market'])??field(c,['Market']),market=rawMarket==='EL'||rawMarket==='GAS'?rawMarket:null
        const name=field(c,['Name','CompanyName','OrganisationName','OrganizationName','LegalName'])??attr(c,['name','companyName','legalName'])
        const edielId=normalizeEdielId(keys.EdielId??field(c,['EdielId','EdielID','EDIELID','Ediel','PartyId'])??attr(c,['edielId','edielID','partyId']))
        const orgNumber=normalizeOrgNumber(keys.OrgNo??field(c,['OrgNo','OrgNumber','OrganizationNumber','OrganisationNumber','CompanyRegistrationNumber'])??attr(c,['orgNo','orgNumber','organizationNumber']))
        const eic=normalizeEic(keys.EIC??field(c,['EIC','EicCode'])??attr(c,['eic','eicCode']))
        if(!name&&!edielId&&!orgNumber&&!eic)continue
        const rawRoles=descendants(c,['Role','ActorRole','MarketRole']).map(value=>field(node(value),['Code','Name','Value'])??text(value)).filter((role):role is string=>Boolean(role))
        const attributeRole=attr(c,['role','actorRole','marketRole']);if(attributeRole)rawRoles.push(attributeRole)
        const roles=uniqueStrings(rawRoles.map(normalizeRole))
        const meta=(c as Record<symbol,XMLMetaData>)[XMLParser.getMetaDataSymbol() as symbol]
        const sourceFragment=meta?.startIndex!==undefined&&meta?.endIndex!==undefined?xml.slice(meta.startIndex,meta.endIndex):null
        actors.push({name:name??edielId??orgNumber??'Okänd aktör',market,svkId:cleanString(keys.SvKId),legalName:field(c,['LegalName','RegisteredName']),edielId,orgNumber,eic,
          countryCode:countryContext??attr(c,['CountryCode','Country'])??field(c,['Country','CountryCode'])??'SE',roles:roles.length?roles:['other'],routes:routes(c,edielId,market),certificates:certificates(c),
          raw:{sourceFragment,sourceFragmentLength:sourceFragment?.length??null,originalMarket:rawMarket,originalCountry:countryContext??attr(c,['CountryCode','Country'])??field(c,['Country','CountryCode']),originalRoles:rawRoles,extractedWith:'fast_xml_parser_5_11_2_no_entities'}})
      }
    }
  }
  walk(node(parsed));return actors
}
