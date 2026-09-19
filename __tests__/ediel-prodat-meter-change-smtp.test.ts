import {beforeEach,it,expect,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {changeRaw} from './fixtures/prodat-meter-change'
const io=vi.hoisted(()=>({from:vi.fn(()=>{throw new Error('DB_BOUNDARY_REACHED')}),provider:vi.fn(()=>{throw new Error('PROVIDER_BOUNDARY_REACHED')}),event:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:io.provider}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:vi.fn(),createEdielMessageEvent:io.event,updateEdielMessageStatus:io.update}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
beforeEach(()=>vi.clearAllMocks())
for(const [wire,label] of [['Z10','Z10'],['Z10','Z04'],['Z04','Z10']])it(`actual shared SMTP rejects unqualified ${wire}/${label} before all external edges`,async()=>{
 const row={id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:label,raw_payload:changeRaw().replace('BGM+Z10+','BGM+'+wire+'+'),parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:{facts:{meterChange:{source:{kind:'tgt'}}}}}}} as unknown as EdielMessageRow
 await expect(sendEdielMessageViaSmtp(row,{actorUserId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
 expect(io.from).not.toHaveBeenCalled();expect(io.provider).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled()
})
