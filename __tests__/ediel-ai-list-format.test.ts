import {describe,expect,it} from 'vitest'
import {buildAiListCsv,buildAiListDetailFromSite} from '@/lib/ediel/aiList'
import {assertAiListOutboundMessage} from '@/lib/ediel/aiListFormat'
import {parseAiBiListCsv} from '@/lib/ediel/aiBiImportParser'
import type {CustomerSiteRow,MeteringPointRow} from '@/lib/masterdata/types'
const detail={anlaggningsId:'735123456789012345',kodlista:'9',natavrakningsomrade:'NET',balansansvarsId:'BRP',elanvandarId:'199001011234',elanvandarNamn:'Test Person',matarNummer:'METER',avrakningsmetod:'Z32',arsforbrukningKwh:3000,rapporteringsfrekvens:'D',matmetod:'Z04',produktkod:'AGG',franDatum:'2026-10-02',tillDatum:'2026-10-25'}
const input={listType:'AI' as const,senderEdielId:'12345',senderName:'Supplier',receiverEdielId:'54321',receiverName:'Network',fromDate:'2026-10-01',toDate:'2026-11-01',createdAt:'2026-09-30T12:00:00Z',details:[detail]}
describe('AI14.A.3 positional supplier adapter',()=>{
  it('puts network first in the header and blanks six network-only columns with the final delimiter',()=>{
    const [header,line]=buildAiListCsv(input).split('\n')
    expect(header).toBe('AI;54321;Network;12345;Supplier;202609301200;;20261001;20261101;Ver20140401')
    const columns=line.split(';')
    expect(columns).toHaveLength(22)
    expect(columns.slice(11,17)).toEqual(['','','','','',''])
    expect(columns.slice(17,21)).toEqual(['199001011234','Test Person','20261002','20261025'])
    expect(line.endsWith(';')).toBe(true)
  })
  it('reads the positional technical file without inventing column-name headers',()=>{
    const wire='AI;54321;Network;12345;Supplier;202609301200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;City;BRP;;;;;;;199001011234;Test Person;20261002;20261025;'
    const parsed=parseAiBiListCsv({raw:wire,listType:'AI'})
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({rowNumber:2,meteringPointExternalId:'735123456789012345',customerIdentity:'199001011234',customerName:'Test Person',gridAreaCode:'NET',gridOwnerEdielId:'54321'})
  })
  it('does not emit BI from this supplier/ESCO platform',()=>{
    expect(()=>buildAiListCsv({...input,listType:'BI'})).toThrow('ai_bi_outbound_network_role_required')
  })
  it('rejects malformed list type, version and delimiter before any rows are processed',()=>{
    for(const raw of ['AI;54321;Network;12345;Supplier;202609301200;;20261001;20261101;UNKNOWN','BI;54321;Network;12345;Supplier;202609301200;20261001;;;Ver20140401','AI,54321,Network,12345,Supplier,202609301200,,20261001,20261101,Ver20140401'])expect(()=>parseAiBiListCsv({raw,listType:'AI'})).toThrow()
  })
  it('guards stored actual-send drafts against BI, parties, malformed data and supplier network fields',()=>{
    const row={message_standard:'ai_list',message_family:'AI_LIST',raw_payload:buildAiListCsv(input),sender_ediel_id:'12345',receiver_ediel_id:'54321',file_name:'AI.csv',mime_type:'text/csv'}
    expect(()=>assertAiListOutboundMessage(row)).not.toThrow()
    expect(()=>assertAiListOutboundMessage({...row,receiver_ediel_id:'99999'})).toThrow('ai_list_outbound_party_scope_mismatch')
    expect(()=>assertAiListOutboundMessage({...row,raw_payload:'BI;54321;Network;12345;Supplier;202609301200;20261001;;;Ver20140401'})).toThrow('ai_bi_outbound_network_role_required')
    const [header,line]=row.raw_payload.split('\n');const cells=line.split(';');cells[11]='NETWORK METER'
    expect(()=>assertAiListOutboundMessage({...row,raw_payload:[header,cells.join(';')].join('\n')})).toThrow('ai_list_supplier_network_fields_present')
    expect(()=>assertAiListOutboundMessage({...row,file_name:'AI.txt'})).toThrow('ai_list_csv_file_type_required')
  })
  it('keeps different historical identities and sorts empty-to after dated-to',()=>{
    const parsed=parseAiBiListCsv({listType:'AI',raw:buildAiListCsv({...input,details:[{...detail,franDatum:null,tillDatum:null,elanvandarNamn:'First'},{...detail,franDatum:null,tillDatum:'20261020',elanvandarNamn:'Second'}]})})
    expect(parsed.rows.map(row=>row.customerName)).toEqual(['Second','First'])
  })
  it('blocks internal/site labels when verified legal customer information is unavailable',()=>{
    const site={id:'INTERNAL-SITE',customer_id:'INTERNAL-CUSTOMER',facility_id:'735123456789012345',site_name:'Site Label'} as unknown as CustomerSiteRow
    expect(()=>buildAiListDetailFromSite({site})).toThrow('ai_list_verified_customer_identity_required')
  })
  it('uses verified legal customer identity without exporting network-only snapshot fields',()=>{
    const params={site:{id:'SITE',customer_id:'INTERNAL-CUSTOMER',facility_id:'735123456789012345',site_name:'Site Label',annual_consumption_kwh:4000} as unknown as CustomerSiteRow,
      meteringPoint:{meter_point_id:'735123456789012345',reading_frequency:'daily',grid_area_code:'NET'} as unknown as MeteringPointRow,
      customer:{personal_number:'199001011234',full_name:'Test Person'},balanceResponsibleEdielId:'BRP'} as unknown as Parameters<typeof buildAiListDetailFromSite>[0]
    expect(buildAiListDetailFromSite(params)).toMatchObject({anlaggningsId:'735123456789012345',elanvandarId:'199001011234',elanvandarNamn:'Test Person',matarNummer:null,avrakningsmetod:null,arsforbrukningKwh:null,rapporteringsfrekvens:null,matmetod:null,produktkod:null})
  })
})
