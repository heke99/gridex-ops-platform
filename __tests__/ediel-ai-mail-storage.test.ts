import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({gate:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:vi.fn()}}))
vi.mock('@/lib/ediel/aiBiPersonalDataStorage',()=>({requireAiBiPersonalDataStorage:io.gate}))
import {storeInboundEmail} from '@/lib/inbound-mail/edielMailboxPoller.part-2'
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
beforeEach(()=>{vi.clearAllMocks();io.gate.mockRejectedValue(new Error('ai_bi_processing_decision_missing'))})
it('gates actual raw mail before dedupe reads, email insert, attachment insert or queue writes',async()=>{
 await expect(storeInboundEmail({mailboxId:'mailbox',companyId:'company',actorUserId:'actor',environment:'test',bodyText:csv,rawEmail:'Content-Type: text/plain\r\n\r\n'+csv})).rejects.toThrow('ai_bi_processing_decision_missing')
 expect(io.from).not.toHaveBeenCalled()
 expect(io.gate).toHaveBeenCalledWith(expect.objectContaining({companyId:'company',actorUserId:'actor',environment:'test',candidates:expect.arrayContaining([csv])}))
})
it('decodes an actual base64 CSV MIME part before storing the encoded raw container',async()=>{
 const raw='Content-Type: multipart/mixed; boundary="X"\r\n\r\n--X\r\nContent-Type: text/csv\r\nContent-Disposition: attachment; filename="AI.csv"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(csv).toString('base64')+'\r\n--X--'
 await expect(storeInboundEmail({mailboxId:'mailbox',companyId:null,actorUserId:null,environment:'test',rawEmail:raw})).rejects.toThrow('ai_bi_processing_decision_missing')
 expect(io.from).not.toHaveBeenCalled()
 expect(io.gate.mock.calls[0][0].candidates).toContain(csv)
})
