import {describe,expect,it} from 'vitest'
import {parseActorRegistryXml} from '@/lib/actor-registry/parseActorRegistryXml'
import {parseActorRegistryTxt} from '@/lib/actor-registry/parseActorRegistryTxt'
const header='Market;CompanyName;SvkId;EdielId;Address1;Address2;PostCode;Place;CountryCode;WebSiteAddress;Type PRODAT;SubAddress;CommunicationAddress;InterchangePartyId;PartyId;Type UTILTS;SubAddress;CommunicationAddress;InterchangePartyId;PartyId'
const row='EL;Synthetic Å Actor;SYN;12345;Street 12;;12345;Town;SE;;PRODAT;;relay@example.invalid;54321;12345;UTILTS;;measure@example.invalid;54321;12345'
describe('authentic companies TXT grammar with synthetic values',()=>{
 it('uses actual postal country and source roles without converting postal addresses into transport routes',()=>{
  const xml='<CompanyListMessage><Market Code="EL" CountryCode="SE"><Company><Name>Synthetic foreign actor</Name><Identifiers><Key Type="EdielId">12345</Key></Identifiers><Addresses><Address Type="Postal"><CountryCode>DK</CountryCode></Address></Addresses><Roles><Role>BalanceResponsible</Role><Role>SystemSupplier</Role><Role>ESP</Role></Roles><EdielAddressing><EDIFACTDetails Type="PRODAT"><SubAddress>actor-prodat</SubAddress><CommunicationAddress Type="SMTP">route@example.invalid</CommunicationAddress><PartyId>12345</PartyId><InterchangePartyId>12345</InterchangePartyId></EDIFACTDetails></EdielAddressing></Company><Company><Name>Synthetic metadata</Name><Identifiers><Key Type="EdielId">23456</Key></Identifiers><Addresses><Address Type="Postal"><CountryCode>SE</CountryCode></Address></Addresses></Company></Market></CompanyListMessage>'
  const actors=parseActorRegistryXml(xml)
  expect(actors[0]).toMatchObject({countryCode:'DK',roles:['balance_responsible','system_supplier','edi_operator']})
  expect(actors[0].routes).toHaveLength(1);expect(actors[0].routes[0].subaddress).toBe('actor-prodat');expect(actors[1].routes).toEqual([])
  expect(actors[0].raw).toMatchObject({marketCountry:'SE',originalCountry:'DK'})
 })
 it('separates repeated family columns and preserves legal versus technical identity',()=>{
  const [actor]=parseActorRegistryTxt(header+'\r\n'+row+'\r\nData generated at:2026-09-10T06:34:58Z')
  expect(actor.name).toBe('Synthetic Å Actor');expect(actor.routes.map(r=>[r.messageFamily,r.communicationAddress,r.interchangePartyId,r.partyId])).toEqual([['PRODAT','relay@example.invalid','54321','12345'],['UTILTS','measure@example.invalid','54321','12345']])
  expect(actor.roles).toEqual([]);expect(actor.orgNumber).toBeNull();expect(actor.routes.every(r=>!r.isVerified&&r.status==='needs_review')).toBe(true)
  expect(actor.raw.sourceFragment).toBe(row);expect(actor.raw.generatedAt).toBe('2026-09-10T06:34:58Z')
 })
 it('joins an unquoted embedded address newline without inventing another actor',()=>{
  const wire=row.replace('Street 12','Street 12\nFloor 2')
  const [actor]=parseActorRegistryTxt(header+'\n'+wire)
  expect(actor.raw.fields).toMatchObject({Address1:'Street 12\nFloor 2'});expect(actor.routes).toHaveLength(2)
 })
 it('keeps metadata-only companies with missing-route diagnostics and retains GAS reference routes',()=>{
  const actors=parseActorRegistryTxt(header+'\nEL;Synthetic Metadata;SYN;23456;Street;;12345;Town;SE;\n'+row.replace('EL;','GAS;'))
  expect(actors).toHaveLength(2);expect(actors[0].routes).toEqual([]);expect(actors[0].raw.diagnostics).toContain('registered_routes_absent')
  expect(actors[1].market).toBe('GAS');expect(actors[1].routes.every(r=>r.status==='blocked')).toBe(true)
 })
 it('retains missing legal IDs as held metadata, without name-based joins',()=>{
  const actors=parseActorRegistryTxt(header+'\nEL;Synthetic without ID;SYN;;Street;;12345;Town;SE;\n'+row)
  expect(actors[0].edielId).toBeNull();expect(actors[0].raw.diagnostics).toContain('registered_legal_identifier_absent')
 })
 it('preserves registered case/empty subaddresses and forbids unsupported UTILTS subaddress',()=>{
  const [actor]=parseActorRegistryTxt(header+'\n'+row.replace('PRODAT;;','PRODAT;actor-prodat;'))
  expect(actor.routes[0].subaddress).toBe('actor-prodat');expect(actor.routes[1].subaddress).toBeNull()
  expect(()=>parseActorRegistryTxt(header+'\n'+row.replace('UTILTS;;','UTILTS;WRONG;'))).toThrow('utilts_subaddress')
 })
 it('preserves unknown family blocks as non-executable reference routes',()=>{
  const [actor]=parseActorRegistryTxt(header.replace('Type PRODAT','Type FUTURE')+'\n'+row.replace('PRODAT;;','FUTURE;;'))
  expect(actor.routes[0]).toMatchObject({messageFamily:'FUTURE',status:'blocked',isVerified:false})
 })
 it.each([
  ['header',header.replace('Type UTILTS','Type PRODAT')+'\n'+row],
  ['family_mismatch',header+'\n'+row.replace('UTILTS;;','PRODAT;;')],
  ['field_count',header+'\n'+row+';extra'],
  ['incomplete',header+'\nEL;Synthetic;SYN;12345;Street'],
  ['zero_routes',header+'\nEL;Metadata;SYN;12345;Street;;12345;Town;SE;'],
 ])('rejects %s with a bounded source diagnostic',(_kind,text)=>expect(()=>parseActorRegistryTxt(text)).toThrow('actor_registry_txt_'))
})
