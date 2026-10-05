import {expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('unexpected database')},rpc:()=>{throw Error('unexpected database')}}}))
import {parseEdielFile} from '@/lib/ediel/fileEngine'
const raw='AI;54321;BIG Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;BRP;;;;;;;199001011234;Person;;;'
it('the actual manual/batch file parser uses exact AI type, source header and positional rows without fabricated interchange references',()=>{
 const parsed=parseEdielFile(raw,'BIG-AI.csv')
 expect(parsed).toMatchObject({messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:'AI',messageVersion:'Ver20140401',interchangeReference:null,externalReference:null,senderEdielId:null,receiverEdielId:null})
 expect(parsed.parsedPayload).toMatchObject({parser:'shared_ai_bi_technical_codec',technicalHeader:{networkEdielId:'54321',supplierEdielId:'12345'},technicalRows:[{rawColumns:{customer_identity:'199001011234',customer_name:'Person'}}]})
})
it('the actual file parser rejects malformed AI details instead of marking CSV as automatically valid',()=>{
 expect(()=>parseEdielFile(raw.replace('Ver20140401','UNKNOWN'),'AI.csv')).toThrow('ai_list_version_unsupported')
 expect(()=>parseEdielFile(raw.replace(';199001011234;Person;;;',';INTERNAL-SITE;;;;'),'AI.csv')).toThrow()
})
