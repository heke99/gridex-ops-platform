// masterplan: IMP-01, AT-IMP-01
import { describe, expect, it } from 'vitest'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'

const source = `<Companies><Company Market="EL"><Name>Provider</Name><Key Type="EdielId">21660</Key><Key Type="OrgNo">556000-0000</Key><Role>PowerSupplier</Role><Role>ESCO</Role><EDIFACTDetails Type="PRODAT"><SubAddress></SubAddress><CommunicationAddress Type="SMTP">edi@example.se</CommunicationAddress><EDICharset>UNOC</EDICharset><EDISyntax>3</EDISyntax><PartyId IdCodeQualifier="ZZ" IdCodeResponsible="260">21660</PartyId><InterchangePartyId IdCodeQualifier="ZZ">99888</InterchangePartyId></EDIFACTDetails></Company><Company Market="GAS"><Name>Gas provider</Name><Key Type="EdielId">99100</Key><Role>NetOwner</Role><EDIFACTDetails Type="UTILTS"><SubAddress></SubAddress><CommunicationAddress Type="SMTP">gas@example.se</CommunicationAddress><PartyId>99100</PartyId><InterchangePartyId>99200</InterchangePartyId></EDIFACTDetails></Company></Companies>`

describe('actor source identities', () => {
  it('preserves company market and exact legal/technical identities without granting representation', () => {
    const actors = parseActorRegistryXml(source)
    expect(actors).toHaveLength(2)
    expect(actors[0]).toMatchObject({ market: 'EL', edielId: '21660', orgNumber: '5560000000', roles: ['electricity_supplier', 'energy_service_company'] })
    expect(actors[0].routes[0]).toMatchObject({ partyId:'21660', interchangePartyId:'99888', subaddress:null, isVerified:false, status:'needs_review' })
    expect(actors[1]).toMatchObject({market:'GAS', edielId:'99100'})
    expect(actors[1].routes[0]).toMatchObject({status:'blocked', isVerified:false})
  })
  it('preserves a generic explicitly different transport party', () => {
    const actors = parseActorRegistryXml('<Actors><Actor><Name>X</Name><EdielId>1</EdielId><Route><MessageFamily>PRODAT</MessageFamily><PartyId>1</PartyId><InterchangePartyId>2</InterchangePartyId><CommunicationType>SMTP</CommunicationType><Email>x@example.se</Email></Route></Actor></Actors>')
    expect(actors[0].routes[0].interchangePartyId).toBe('2')
    expect(actors[0].routes[0]).toMatchObject({isVerified:false,status:'needs_review'})
  })
  it('inherits the official Market/Company context and preserves original source values',()=>{
    const actors=parseActorRegistryXml('<Registry><Market Code="EL" CountryCode="SE"><Company><Name>Legalactor</Name><Identifiers><Key Type="EdielId">21660</Key></Identifiers><Role>ESCO</Role><EDIFACTDetails Type="UTILTS"><PartyId>21660</PartyId><InterchangePartyId>21660</InterchangePartyId><CommunicationAddress Type="SMTP">edi@example.se</CommunicationAddress></EDIFACTDetails></Company></Market><Market Code="GAS" CountryCode="SE"><Company><Name>Gasactor</Name><Key Type="EdielId">99900</Key><Role>Netowner</Role></Company></Market></Registry>')
    expect(actors.map(actor=>actor.market)).toEqual(['EL','GAS'])
    expect(actors[0].raw.originalRoles).toEqual(['ESCO'])
    expect(actors[0].raw.sourceFragment).toContain('<Identifiers>')
    expect(actors[0]).toMatchObject({countryCode:'SE',edielId:'21660'})
  })
  it('rejects malformed XML and custom entities before producing source records',()=>{
    expect(()=>parseActorRegistryXml('<Company><Name>X</Company>')).toThrow('actor_registry_xml_invalid')
    expect(()=>parseActorRegistryXml('<Company><Name>&custom;</Name></Company>')).toThrow('actor_registry_xml_unresolved_entity')
  })
  it('uses AST records so comments and CDATA cannot inject actors or legal identities',()=>{
    const actors=parseActorRegistryXml('<Registry><!--<Company Market="EL"><Name>Fake</Name><EdielId>99888</EdielId></Company>--><Market Code="EL"><Company><Name><![CDATA[Real <Company>]]></Name><Key Type="EdielId">21660</Key><Role>ESCO</Role></Company></Market></Registry>')
    expect(actors).toHaveLength(1);expect(actors[0]).toMatchObject({name:'Real <Company>',edielId:'21660'})
    expect(actors[0].raw.sourceFragment).toContain('<![CDATA[Real <Company>]]>')
  })
  it('rejects DTD/entity sources before import creates records', () => {
    expect(() => parseActorRegistryXml('<!DOCTYPE companies [<!ENTITY x SYSTEM "file:///etc/passwd">]><Companies/>')).toThrow('actor_registry_xml_unsafe_declaration')
  })
  it.each([
    '<Email>contact@example.invalid</Email>',
    '<Address><Street>Source street</Street><Email>postal@example.invalid</Email></Address>',
    '<EDIFACTDetails><PartyId>21660</PartyId><InterchangePartyId>99888</InterchangePartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails>',
    '<EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails>',
    '<EDIFACTDetails Type="PRODAT"><InterchangePartyId>99888</InterchangePartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails>',
    '<EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><InterchangePartyId>99888</InterchangePartyId><CommunicationAddress>edi@example.invalid</CommunicationAddress></EDIFACTDetails>',
  ])('retains incomplete source fragments and diagnostics without inventing a route from %s', (route) => {
    const actors=parseActorRegistryXml(`<Market Code="EL" Country="SE"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key>${route}</Company></Market>`)
    expect(actors[0].routes).toEqual([])
    expect(actors[0].raw.sourceFragment).toContain(route)
    expect(actors[0].raw.registryDiagnostics).toContainEqual(expect.objectContaining({code:'actor_registry_declared_route_source_required'}))
  })
  it('preserves absent country and exact explicit family/application/technical identity as separate source facts', () => {
    const [actor]=parseActorRegistryXml('<Market Code="EL"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key><EDIFACTDetails Type="UTILTS"><ApplicationReference>SOURCE-APP</ApplicationReference><PartyId>21660</PartyId><InterchangePartyId>99888</InterchangePartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>')
    expect(actor.countryCode).toBeNull();expect(actor.raw.originalCountry).toBeNull()
    expect(actor.raw.registryDiagnostics).toContainEqual({code:'actor_registry_source_country_required',missingFields:['countryCode']})
    expect(actor.routes[0]).toMatchObject({messageFamily:'UTILTS',applicationReference:'SOURCE-APP',partyId:'21660',interchangePartyId:'99888',communicationType:'SMTP',metadata:{originalFamily:'UTILTS'}})
  })
  it('does not manufacture application identity from family or discard a separate complete route', () => {
    const [actor]=parseActorRegistryXml('<Market Code="EL" Country="FI"><Company><Name>Synthetic</Name><Key Type="EdielId">21660</Key><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><CommunicationAddress Type="SMTP">held@example.invalid</CommunicationAddress></EDIFACTDetails><EDIFACTDetails Type="UTILTS"><PartyId>21660</PartyId><InterchangePartyId>99888</InterchangePartyId><CommunicationAddress Type="SMTP">own@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>')
    expect(actor.countryCode).toBe('FI');expect(actor.routes).toHaveLength(1)
    expect(actor.routes[0]).toMatchObject({messageFamily:'UTILTS',applicationReference:null,interchangePartyId:'99888',communicationAddress:'own@example.invalid'})
    expect(actor.raw.registryDiagnostics).toContainEqual(expect.objectContaining({missingFields:['interchangePartyId']}))
  })
  it('holds conflicting parent and Company market/country instead of silently choosing one', () => {
    const [actor]=parseActorRegistryXml('<Market Code="EL" Country="SE"><Company Market="GAS" Country="FI"><Name>Synthetic</Name><Key Type="EdielId">21660</Key><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><InterchangePartyId>21660</InterchangePartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>')
    expect(actor).toMatchObject({market:null,countryCode:null,raw:{originalParentMarket:'EL',originalCompanyMarket:'GAS',originalParentCountry:'SE',originalCompanyCountry:'FI'}})
    expect(actor.raw.registryDiagnostics).toContainEqual(expect.objectContaining({code:'actor_registry_source_market_conflict'}))
    expect(actor.raw.registryDiagnostics).toContainEqual(expect.objectContaining({code:'actor_registry_source_country_conflict'}))
    expect(actor.routes[0]).toMatchObject({market:null,isVerified:false,status:'needs_review'})
  })
})
