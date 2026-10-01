import {createHash} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createZ06fReadingNativeFixture} from './helpers/ediel-z06f-reading-followup-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {supabaseService} from '@/lib/supabase/service'

// The external SMTP acceptance is explicitly synthetic. Database, registry,
// canonical/source owner, original review, structural apply, accepted series,
// protected contract and observation consumers all use actual implementations.
const external=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.send})}}))
beforeEach(()=>{
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only')
 external.send.mockReset()
})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
const fixture=()=>createZ06fReadingNativeFixture(email=>external.send.mockResolvedValue({accepted:[email],rejected:[],messageId:'synthetic-owned-original',response:'250 explicitly synthetic accepted'}))
const own=(f:Awaited<ReturnType<typeof fixture>>,source:string)=>sql<{expectations:{id:string;source_message_id:string;contract:Record<string,unknown>;contract_hash:string}[];observations:{id:string;utilts_source_message_id:string;transaction_id:string;source_payload_hash:string;receipt:Record<string,unknown>;receipt_hash:string}[]}>(`SELECT jsonb_build_object('expectations',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM gridex_received_reading_expectations.expectations e WHERE company_id=${literal(f.f.companyId)} AND source_message_id=${literal(source)}),'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM gridex_received_reading_expectations.observations o JOIN gridex_received_reading_expectations.expectations e ON e.id=o.expectation_id WHERE e.company_id=${literal(f.f.companyId)} AND e.source_message_id=${literal(source)}))`)

it('actual F apply creates own pending expectation; accepted physical AES/MG/QTY220/DTM597 persist fulfills only that source without extra market request',async()=>{
 const f=await fixture(),change=await f.change(),before=own(f,change.message.id)
 expect(before.expectations).toHaveLength(1);expect(before.observations).toEqual([])
 expect(before.expectations[0].contract).toMatchObject({mode:'meter_reading',expectedRegisterIds:['101'],measurementMethod:'Z04',deadline:null,automaticRequestAllowed:false})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.structural_object_apply_receipts WHERE company_id=${literal(f.f.companyId)} AND source_message_id=${literal(change.message.id)}`)).toBe(1)
 const reading=await f.reading(),outboundBefore=f.snapshots().outbound
 expect(reading.qualified.runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
 // Observe BEFORE the read-reconcile RPC: the actual after-persist callback,
 // rather than a later read or manually invoked helper, must mint the receipt.
 expect(own(f,change.message.id).observations).toEqual([])
 expect(await reading.persist()).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted'}])
 const observed=own(f,change.message.id);expect(observed.expectations).toEqual(before.expectations);expect(observed.observations).toHaveLength(1)
 const receipt=observed.observations[0];expect(receipt).toMatchObject({utilts_source_message_id:reading.message.id,transaction_id:reading.qualified.runtime.facts.transactions[0].transactionId,source_payload_hash:createHash('sha256').update(reading.message.raw_payload!).digest('hex')})
 expect(receipt.receipt).toMatchObject({utiltsSourceId:reading.message.id,observation:'actual_accepted_persisted_member',reading:[{registerId:'101',meterNumber:'METER-1'}]})
 expect(sql(`SELECT to_jsonb(gridex_utilts_binding.stored_contract_v1(${literal(f.f.companyId)},${literal(reading.message.id)},${literal(receipt.transaction_id)}) IS NOT NULL)`)).toBe(true)
 const view=await f.read(change.message.id);expect(view.error).toBeNull();expect(view.data).toMatchObject({criterion:'AT-Z06F-SUPPLIER',expectations:[{status:'reading_observed',automaticRequestAllowed:false,deadline:null}]})
 expect(f.snapshots().outbound).toBe(outboundBefore);expect(external.send).toHaveBeenCalledTimes(1)
 const stable=f.snapshots();await reading.persist();await change.apply();expect(f.snapshots()).toEqual(stable)
})

it.each([{register:'901'},{meter:'FOREIGN-METER'},{agency:'89'},{date:'202610160000'},{quantity:'NULL'}])('actual misaligned or missing own reading %j cannot fulfill F or borrow sibling evidence',async options=>{
 const f=await fixture(),change=await f.change(),before=own(f,change.message.id),reading=await f.reading(options)
 // The actual national/functional decision is observed rather than fabricated
 // as a caller-provided accepted flag. A valid reading at another instant can
 // be accepted and still not fulfill this precise F boundary. The actual native
 // owner must retain its own complete outcome in every case, without a skip.
 const persisted=await reading.persist()
 expect(persisted.map(x=>x.disposition)).toEqual(reading.qualified.runtime.transactionDispositions.map(x=>x.disposition))
 const after=own(f,change.message.id);expect(after.expectations).toEqual(before.expectations);expect(after.observations).toEqual([])
 const view=await f.read(change.message.id);expect(view.error).toBeNull();expect(view.data).toMatchObject({expectations:[{status:'pending'}]})
})

it('actual G apply creates no F expectation or fabricated boundary-reading fulfillment',async()=>{
 const f=await fixture(),change=await f.change('G')
 expect(own(f,change.message.id)).toEqual({expectations:[],observations:[]})
 const view=await f.read(change.message.id);expect(view.error).toBeNull();expect(view.data).toMatchObject({expectations:[]})
})

it('native current customer read denial and cross-company/source hashes cannot grant followup authority or mint observations',async()=>{
 const f=await fixture(),change=await f.change(),before=own(f,change.message.id)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,valid_from,valid_to) VALUES(${literal(f.operator.id)},${literal(f.f.companyId)},'customers.read','deny',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day')`)
 const denied=await f.read(change.message.id);expect(denied.error?.code).toBe('42501');expect(own(f,change.message.id)).toEqual(before)
 const foreign=await supabaseService.rpc('ediel_read_z06f_reading_followup_v1',{p_company_id:'00000000-0000-4000-8000-000000000999',p_environment:'test',p_actor_user_id:f.operator.id,p_source_message_id:change.message.id})
 expect(foreign.error?.code).toBe('42501');expect(own(f,change.message.id)).toEqual(before)
 expect(()=>sql(`BEGIN;SET LOCAL ROLE service_role;INSERT INTO gridex_received_reading_expectations.observations(expectation_id,company_id,environment,utilts_source_message_id,transaction_id,source_payload_hash,receipt,receipt_hash) VALUES(${literal(before.expectations[0].id)},${literal(f.f.companyId)},'test',${literal(change.message.id)},'CALLER-FORGED',repeat('f',64),'{"fulfilled":true}',repeat('f',64));ROLLBACK;`)).toThrow(/permission denied/)
 expect(own(f,change.message.id)).toEqual(before)
})
