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
    const actors = parseActorRegistryXml('<Actors><Actor><Name>X</Name><EdielId>1</EdielId><Route><MessageFamily>PRODAT</MessageFamily><PartyId>1</PartyId><InterchangePartyId>2</InterchangePartyId><Email>x@example.se</Email></Route></Actor></Actors>')
    expect(actors[0].routes[0].interchangePartyId).toBe('2')
    expect(actors[0].routes[0]).toMatchObject({isVerified:false,status:'needs_review'})
  })
  it('rejects DTD/entity sources before import creates records', () => {
    expect(() => parseActorRegistryXml('<!DOCTYPE companies [<!ENTITY x SYSTEM "file:///etc/passwd">]><Companies/>')).toThrow('actor_registry_xml_unsafe_declaration')
  })
})
