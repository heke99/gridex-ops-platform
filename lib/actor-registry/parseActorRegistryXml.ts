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
type RegistrySourceDiagnostic={code:string;missingFields?:string[];sourceFragment?:string|null;declaredFamily?:string|null}
function sourceFragment(value:Node,xml:string):string|null {
  const meta=(value as Record<symbol,XMLMetaData>)[XMLParser.getMetaDataSymbol() as symbol]
  return meta?.startIndex!==undefined&&meta?.endIndex!==undefined?xml.slice(meta.startIndex,meta.endIndex):null
}
function routes(company:Node,market:ParsedActorRegistryActor['market'],xml:string):{routes:ActorRegistryRoute[];diagnostics:RegistrySourceDiagnostic[]}{
  const result:ActorRegistryRoute[]=[],diagnostics:RegistrySourceDiagnostic[]=[]
  for(const value of descendants(company,['EDIFACTDetails','Route','CommunicationRoute','MessageRoute'])){
    const r=node(value), partyNode=node(r.PartyId??r.PartyID), interchangeNode=node(r.InterchangePartyId??r.InterchangePartyID), address=node(r.CommunicationAddress)
    const declaredFamily=field(r,['MessageFamily','MessageType','Family'])??attr(r,['Type','messageFamily','messageType','family'])
    const messageFamily=declaredFamily?.toUpperCase()??null
    const partyId=normalizeEdielId(field(r,['PartyId','PartyID'])??attr(r,['partyId']))
    const interchangePartyId=normalizeEdielId(field(r,['InterchangePartyId','InterchangePartyID','TechnicalPartyId','TransportPartyId'])??attr(r,['interchangePartyId','technicalPartyId']))
    const communicationAddress=normalizeEmail(field(r,['CommunicationAddress','Address','Email','SmtpEmail','SMTP'])??attr(r,['email','smtp','address']))
    const communicationType=field(r,['CommunicationType','Protocol','TransportType'])??attr(address,['Type'])??attr(r,['communicationType','protocol'])
    const missingFields=[['messageFamily',messageFamily],['partyId',partyId],['interchangePartyId',interchangePartyId],['communicationType',communicationType],['communicationAddress',communicationAddress]].filter(([,value])=>!value).map(([field])=>field as string)
    if(missingFields.length){diagnostics.push({code:'actor_registry_declared_route_source_required',missingFields,declaredFamily,sourceFragment:sourceFragment(r,xml)});continue}
    const represented=partyId!==interchangePartyId
    result.push({messageFamily:messageFamily!,market,environment:env(field(r,['Environment','Env'])??attr(r,['environment','env'])),
      applicationReference:field(r,['ApplicationReference','ApplicationRef'])??attr(r,['applicationReference']),
      subaddress:normalizeSubaddress(field(r,['SubAddress','Subaddress','Sub-Address'])??attr(r,['subaddress','subAddress'])),
      communicationType,communicationAddress,partyId,interchangePartyId,
      partyIdQualifier:attr(partyNode,['IdCodeQualifier']),partyIdResponsible:attr(partyNode,['IdCodeResponsible']),interchangeIdQualifier:attr(interchangeNode,['IdCodeQualifier']),
      ediCharset:field(r,['EDICharset','EdiCharset']),ediSyntax:field(r,['EDISyntax','EdiSyntax']),
      status:market==='GAS'?'blocked':market!=='EL'||represented?'needs_review':'active',
      isVerified:market==='EL'&&!represented,metadata:{source:'xml_import',representation_requires_mandate:represented,
        originalFamily:declaredFamily,sourceFragment:sourceFragment(r,xml)}})
  }
  if(!result.length&&!diagnostics.length)diagnostics.push({code:'actor_registry_declared_route_source_required',missingFields:['source_route_node']})
  return {routes:result,diagnostics}
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
        const companyMarket=attr(c,['Market'])??field(c,['Market']),marketConflict=Boolean(marketContext&&companyMarket&&marketContext!==companyMarket)
        const rawMarket=marketConflict?null:marketContext??companyMarket,market=rawMarket==='EL'||rawMarket==='GAS'?rawMarket:null
        const name=field(c,['Name','CompanyName','OrganisationName','OrganizationName','LegalName'])??attr(c,['name','companyName','legalName'])
        const edielId=normalizeEdielId(keys.EdielId??field(c,['EdielId','EdielID','EDIELID','Ediel','PartyId'])??attr(c,['edielId','edielID','partyId']))
        const orgNumber=normalizeOrgNumber(keys.OrgNo??field(c,['OrgNo','OrgNumber','OrganizationNumber','OrganisationNumber','CompanyRegistrationNumber'])??attr(c,['orgNo','orgNumber','organizationNumber']))
        const eic=normalizeEic(keys.EIC??field(c,['EIC','EicCode'])??attr(c,['eic','eicCode']))
        if(!name&&!edielId&&!orgNumber&&!eic)continue
        const rawRoles=descendants(c,['Role','ActorRole','MarketRole']).map(value=>field(node(value),['Code','Name','Value'])??text(value)).filter((role):role is string=>Boolean(role))
        const attributeRole=attr(c,['role','actorRole','marketRole']);if(attributeRole)rawRoles.push(attributeRole)
        const roles=uniqueStrings(rawRoles.map(normalizeRole))
        const companyCountry=attr(c,['CountryCode','Country'])??field(c,['Country','CountryCode']),countryConflict=Boolean(countryContext&&companyCountry&&countryContext!==companyCountry)
        const fragment=sourceFragment(c,xml),countryCode=countryConflict?null:countryContext??companyCountry
        const parsedRoutes=routes(c,market,xml)
        if(marketConflict)parsedRoutes.diagnostics.push({code:'actor_registry_source_market_conflict',missingFields:['unambiguous_market']})
        if(countryConflict)parsedRoutes.diagnostics.push({code:'actor_registry_source_country_conflict',missingFields:['unambiguous_country']})
        if(!countryCode)parsedRoutes.diagnostics.push({code:'actor_registry_source_country_required',missingFields:['countryCode']})
        actors.push({name:name??edielId??orgNumber??'Okänd aktör',market,svkId:cleanString(keys.SvKId),legalName:field(c,['LegalName','RegisteredName']),edielId,orgNumber,eic,
          countryCode,roles:roles.length?roles:['other'],routes:parsedRoutes.routes,certificates:certificates(c),
          raw:{sourceFragment:fragment,sourceFragmentLength:fragment?.length??null,originalMarket:rawMarket,originalCountry:countryCode,originalParentMarket:marketContext,originalCompanyMarket:companyMarket,originalParentCountry:countryContext,originalCompanyCountry:companyCountry,originalRoles:rawRoles,registryDiagnostics:parsedRoutes.diagnostics,extractedWith:'fast_xml_parser_5_11_2_no_entities'}})
      }
    }
  }
  walk(node(parsed));return actors
}
