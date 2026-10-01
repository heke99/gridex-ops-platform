import { createClient } from '@supabase/supabase-js'
import { afterAll, expect, it } from 'vitest'
import { claimManualPurchase, completeManualPurchase } from '@/lib/billing/manualPurchaseIntentReconstructed'
import { proofSql, quote } from './customer-read-proof-native'
import { API, blocked, callSql, fixture, nativeResponse, session, stop, until } from './manual-purchase-intent-reconstructed-20261001-native.fixture'

const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
  if (url.hostname !== '127.0.0.1' || url.port !== '54321') throw new Error('manual_purchase_native_external_transport_forbidden')
  return originalFetch(input, init)
}
afterAll(() => { globalThis.fetch = originalFetch })
const lock = (company: string, item: string) => `SELECT pg_advisory_xact_lock(hashtextextended(${quote(company+':manual-purchase:'+item)},0));`
const completeInput = (f: Awaited<ReturnType<typeof fixture>>, receipt: Awaited<ReturnType<typeof claimManualPurchase>>) => ({
  ...f.command, intentId: receipt.intentId, requestHash: receipt.requestHash, snapshotHash: receipt.snapshotHash,
  outcome: 'response_observed', observation: nativeResponse,
})
function receipt(worker: ReturnType<typeof session>) {
  const values = worker.output().trim().split('\n').filter(row=>row.startsWith('{'))
  if (values.length!==1) throw new Error('manual_purchase_native_single_receipt_required')
  return JSON.parse(values[0]) as { intentId: string; shouldPost: boolean; requestHash: string; snapshotHash: string }
}

it('installed commands with a genuine current GoTrue session commit/replay one local observation and preserve original graphs', async () => {
  const f=await fixture(), before=f.graphs(false)
  const first=await claimManualPurchase(f.command)
  expect(first.shouldPost).toBe(true);expect(first.status).toBe('dispatch_started')
  const done=await completeManualPurchase(f.command,first,'response_observed',nativeResponse)
  expect(done.status).toBe('response_observed');expect(JSON.stringify(done.response)===JSON.stringify(nativeResponse)).toBe(true)
  const after=f.graphs(),replay=await claimManualPurchase(f.command)
  expect(JSON.stringify(replay)===JSON.stringify({...done,shouldPost:false})).toBe(true)
  expect(JSON.stringify(await completeManualPurchase(f.command,first,'response_observed',nativeResponse))===JSON.stringify(done)).toBe(true)
  expect(f.effects()).toEqual({intents:1,events:1,audits:1,intentStatus:'response_observed'})
  expect(f.graphs()).toEqual(after);expect(f.graphs(false)).toEqual(before);expect(f.originalUnchanged()).toBe(true)
  console.log('MANUAL_PURCHASE_NATIVE_COMMAND_REPLAY_PASS realSession=true intents1=true observations1=true audits1=true originalGraphsUnchanged=true provider0=true')
})

it('real anon and authenticated clients cannot execute the private commands or read intent rows', async () => {
  const f=await fixture(),before=f.graphs(),effects=f.effects()
  const anon=createClient(API,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  for(const client of [anon,f.writer.client]) {
    const result=await client.rpc('gridex_claim_manual_invoice_purchase_v1',{p_command:f.command})
    expect(result.error?.code).toBe('42501');expect(result.data===null).toBe(true)
    const rows=await client.from('invoice_manual_purchase_intents').select('id').eq('company_id',f.ids.company)
    expect(rows.error?.code).toBe('42501');expect(rows.data===null).toBe(true)
  }
  expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
  console.log('MANUAL_PURCHASE_NATIVE_LOW_ROLE_DENIAL_PASS anon=true authenticated=true effects0=true originalGraphsUnchanged=true')
})

it('current foreign selection, mismatched actor and missing native session never grant an attempt', async () => {
  const f=await fixture(),before=f.graphs(),effects=f.effects()
  const selected=await f.writer.client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:f.ids.foreign})
  if(selected.error)throw new Error('manual_purchase_native_foreign_context_rpc_failed')
  expect(selected.data?.selected_company_id===f.ids.foreign && selected.data?.authorized===true).toBe(false)
  for(const change of [{companyId:f.ids.foreign},{actorUserId:f.ids.foreign},{sessionId:f.ids.foreign}]) {
    await expect(claimManualPurchase({...f.command,...change})).rejects.toMatchObject({status:403})
  }
  expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
  console.log('MANUAL_PURCHASE_NATIVE_CURRENT_TUPLE_DENIAL_PASS foreignSelected=true wrongActor=true wrongSession=true effects0=true')
})

it.each(['role','permission'] as const)('completed replay rechecks a revoked current %s before any new effect', async kind => {
  const f=await fixture(),first=await claimManualPurchase(f.command)
  await completeManualPurchase(f.command,first,'response_observed',nativeResponse)
  const before=f.graphs(),effects=f.effects()
  proofSql(`BEGIN;${kind==='role'
    ? `UPDATE public.user_roles SET is_active=false,status='disabled' WHERE user_id=${quote(f.writer.userId)} AND company_id=${quote(f.ids.company)} AND role_id=${quote(f.ids.role)};`
    : `UPDATE public.role_permissions SET effect='deny' WHERE role_id=${quote(f.ids.role)};`}
    COMMIT;SELECT to_jsonb(true);`)
  await expect(claimManualPurchase(f.command)).rejects.toMatchObject({status:403})
  await expect(completeManualPurchase(f.command,first,'response_observed',nativeResponse)).rejects.toMatchObject({status:403})
  expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
  console.log(`MANUAL_PURCHASE_NATIVE_REVOKED_AUTHORITY_PASS kind=${kind} replayDenied=true effects0=true originalGraphsUnchanged=true`)
})

it.each(['fresh','completed'] as const)('actual expired GoTrue session denies %s command/replay without effects', async phase => {
  const f=await fixture()
  if(phase==='completed') {const first=await claimManualPurchase(f.command);await completeManualPurchase(f.command,first,'response_observed',nativeResponse)}
  const before=f.graphs(),effects=f.effects()
  expect(proofSql<boolean>(`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(f.writer.sessionId)} AND user_id=${quote(f.writer.userId)};
    SELECT to_jsonb(count(*)=1) FROM auth.sessions WHERE id=${quote(f.writer.sessionId)} AND not_after<=clock_timestamp();`)).toBe(true)
  await expect(claimManualPurchase(f.command)).rejects.toMatchObject({status:403})
  expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
  console.log(`MANUAL_PURCHASE_NATIVE_EXPIRED_SESSION_PASS phase=${phase} effects0=true originalGraphsUnchanged=true`)
})

it.each(['invoice_purchase_events','invoice_export_items','domain_events','invoice_manual_purchase_intents'] as const)(
  'real late %s write fault rolls back all settlement effects with the permanent pre-POST intent retained', async table => {
    const f=await fixture(),first=await claimManualPurchase(f.command),before=f.graphs(),effects=f.effects()
    const target=table==='invoice_export_items'?`NEW.id=${quote(f.ids.item)}::uuid`
      : table==='invoice_manual_purchase_intents'?`NEW.invoice_export_item_id=${quote(f.ids.item)}::uuid`
        :table==='invoice_purchase_events'?`NEW.invoice_export_item_id=${quote(f.ids.item)}::uuid`
          :`NEW.company_id=${quote(f.ids.company)}::uuid AND NEW.event_type LIKE 'invoice.manual_purchase.%'`
    const out=proofSql<{denied:boolean;witness:boolean}>(`BEGIN;
      CREATE TEMPORARY SEQUENCE manual_native_fault_witness;
      GRANT USAGE,SELECT ON SEQUENCE manual_native_fault_witness TO service_role;
      CREATE FUNCTION pg_temp.manual_native_late_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF ${target} THEN PERFORM nextval('pg_temp.manual_native_fault_witness');
          RAISE EXCEPTION 'synthetic_manual_native_late_fault' USING errcode='XX000'; END IF;RETURN NEW;END;$fault$;
      CREATE TRIGGER zz_manual_native_late_fault AFTER ${['invoice_export_items','invoice_manual_purchase_intents'].includes(table)?'UPDATE':'INSERT'}
        ON public.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.manual_native_late_fault();
      SET LOCAL ROLE service_role;
      DO $attempt$ BEGIN
        BEGIN PERFORM public.gridex_complete_manual_invoice_purchase_v1(${quote(JSON.stringify(completeInput(f,first)))}::jsonb);
          RAISE EXCEPTION 'manual_native_late_fault_not_reached' USING errcode='P0001';
        EXCEPTION WHEN SQLSTATE 'XX000' THEN PERFORM set_config('gridex.manual_native.denied','true',true);END;
      END;$attempt$;RESET ROLE;
      SELECT jsonb_build_object('denied',current_setting('gridex.manual_native.denied',true)='true',
        'witness',(SELECT is_called FROM pg_temp.manual_native_fault_witness));ROLLBACK;`)
    expect(out).toEqual({denied:true,witness:true});expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before)
    expect((await claimManualPurchase(f.command)).shouldPost).toBe(false);expect(f.originalUnchanged()).toBe(true)
    console.log(`MANUAL_PURCHASE_NATIVE_LATE_WRITE_ROLLBACK_PASS table=${table} witness=true settlementEffects0=true permanentIntent1=true originalGraphsUnchanged=true`)
  })

it('two real psql sessions overlap on the actual item fence and grant exactly one attempt', async () => {
  const f=await fixture(),before=f.graphs(),first=session('first'),second=session('second')
  try {
    first.child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;${callSql('claim',f.command)}\n\\echo MANUAL_NATIVE_FIRST_HELD\n`)
    await until(()=>first.output().includes('MANUAL_NATIVE_FIRST_HELD'),'manual_purchase_native_first_receipt_missing')
    second.child.stdin.end(`SET ROLE service_role;${callSql('claim',f.command)}\n`)
    await blocked(second,first);first.child.stdin.end('COMMIT;\n')
    expect(await first.exited).toBe(0);expect(await second.exited).toBe(0)
    const a=receipt(first),b=receipt(second)
    expect(a.shouldPost).toBe(true);expect(b.shouldPost).toBe(false);expect(b.intentId).toBe(a.intentId)
    expect(b.requestHash).toBe(a.requestHash);expect(b.snapshotHash).toBe(a.snapshotHash)
    expect(f.effects()).toEqual({intents:1,events:0,audits:0,intentStatus:'dispatch_started'})
    expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
    console.log('MANUAL_PURCHASE_NATIVE_TWO_SESSION_ONE_ATTEMPT_PASS observedSpecificWait=true shouldPost1=true intents1=true effectsOnlyBarrier=true originalGraphsUnchanged=true')
  }finally{stop(first,second)}
})

it.each(['session','role'] as const)('a real blocked claim observes current %s revocation before it can commit an intent', async kind => {
  const f=await fixture(),before=f.graphs(),effects=f.effects(),owner=session('revoker'),waiter=session('revoked')
  try {
    owner.child.stdin.write(`BEGIN;${lock(f.ids.company,f.ids.item)}\n\\echo MANUAL_NATIVE_KEY_HELD\n`)
    await until(()=>owner.output().includes('MANUAL_NATIVE_KEY_HELD'),'manual_purchase_native_revocation_fence_missing')
    waiter.child.stdin.end(`SET ROLE service_role;${callSql('claim',f.command)}\n`)
    await blocked(waiter,owner)
    owner.child.stdin.end(`${kind==='session'
      ?`DELETE FROM auth.sessions WHERE id=${quote(f.writer.sessionId)} AND user_id=${quote(f.writer.userId)};`
      :`UPDATE public.user_roles SET is_active=false,status='disabled' WHERE user_id=${quote(f.writer.userId)} AND company_id=${quote(f.ids.company)} AND role_id=${quote(f.ids.role)};`}COMMIT;\n`)
    expect(await owner.exited).toBe(0);expect(await waiter.exited).not.toBe(0);expect(waiter.code()).toBe('42501')
    expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
    console.log(`MANUAL_PURCHASE_NATIVE_REVOKED_WAITER_PASS kind=${kind} observedSpecificWait=true intents0=true originalGraphsUnchanged=true`)
  }finally{stop(owner,waiter)}
})

it('the real session clock expires during a late audit wait and the final authority check rolls settlement back', async () => {
  const f=await fixture(),first=await claimManualPurchase(f.command),before=f.graphs(),effects=f.effects()
  const owner=session('audit'),waiter=session('clock')
  try {
    owner.child.stdin.write(`BEGIN;INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,source,payload,idempotency_key)
      VALUES(${quote(f.ids.company)},'synthetic.manual.audit.blocker','invoice_manual_purchase_intent',${quote(first.intentId)},
      'manual_purchase_native_owned_blocker','{}',${quote('manual-purchase-complete:'+first.intentId)});\n\\echo MANUAL_NATIVE_AUDIT_HELD\n`)
    await until(()=>owner.output().includes('MANUAL_NATIVE_AUDIT_HELD'),'manual_purchase_native_audit_fence_missing')
    expect(proofSql<boolean>(`UPDATE auth.sessions SET not_after=clock_timestamp()+interval '8 seconds'
      WHERE id=${quote(f.writer.sessionId)} AND user_id=${quote(f.writer.userId)};
      SELECT to_jsonb(count(*)=1) FROM auth.sessions WHERE id=${quote(f.writer.sessionId)} AND not_after>clock_timestamp();`)).toBe(true)
    waiter.child.stdin.end(`SET ROLE service_role;${callSql('complete',completeInput(f,first))}\n`)
    await blocked(waiter,owner)
    await until(()=>proofSql<boolean>(`SELECT to_jsonb(not_after<=clock_timestamp()) FROM auth.sessions WHERE id=${quote(f.writer.sessionId)};`),
      'manual_purchase_native_clock_not_expired')
    owner.child.stdin.end('ROLLBACK;\n')
    expect(await owner.exited).toBe(0);expect(await waiter.exited).not.toBe(0);expect(waiter.code()).toBe('42501')
    expect(f.effects()).toEqual(effects);expect(f.graphs()).toEqual(before);expect(f.originalUnchanged()).toBe(true)
    console.log('MANUAL_PURCHASE_NATIVE_LATE_AUDIT_CLOCK_PASS observedSpecificWait=true expiredAfterEntry=true settlementEffects0=true permanentIntent1=true originalGraphsUnchanged=true')
  }finally{stop(owner,waiter)}
})
