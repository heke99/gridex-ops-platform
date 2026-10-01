import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { quote, session, sql, until } from './partner-queue-continuation-20260930-native'
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { executeSupportCommand } from '@/lib/customer-operations/supportCommand'
import { intakeSupportAttachment } from '@/lib/customer-cases/attachments'
import { publicReference } from '@/lib/integrations/publicReferences'
import { assessSupportAttachmentScan, prepareSupportAttachmentScan, recordSupportAttachmentScannerVerdict } from '@/lib/customer-cases/attachmentScan'
import { scanBinding, scannerSha256, scannerTrustEntry, SUPPORT_SCAN_PURPOSE,
  verifySupportAttachmentScannerProof, type SupportScanChallenge } from '@/lib/customer-cases/scannerProof'

async function fixture() {
  const company = randomUUID(),customer = randomUUID(),sibling = randomUUID(),user = randomUUID(),authSession = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(company)},'Synthetic scanner lineage','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(user)},'authenticated','authenticated',${quote(user+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status)
      VALUES(${quote(user)},${quote(user+'@example.invalid')},'Synthetic scanner attachment owner','active');
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
      VALUES(${quote(authSession)},${quote(user)},now(),now(),clock_timestamp()+interval '1 hour');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
      (${quote(customer)},${quote(company)},${quote(customer)},'Synthetic scanner customer','private'),
      (${quote(sibling)},${quote(company)},${quote(sibling)},'Synthetic scanner sibling','private');
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
      VALUES(${quote(company)},${quote(customer)},${quote(user)},${quote(user)},'active',true,'owner',${quote(user+'@example.invalid')});
    SELECT to_jsonb(true);`)
  const context = { companyId: company,customerId: customer,actor: { kind: 'portal' as const,userId: user,sessionId: authSession } }
  const created = await executeSupportCommand({ ...context,operation: 'create',expectedRevision: 0,idempotencyKey: 'scanner-private-case-'+randomUUID(),
    payload: { title: 'Synthetic scanner case',body: 'Only local authenticated evidence, no external scanner' } })
  const bytes = 'Synthetic inert untrusted scanner bytes\n'
  await intakeSupportAttachment({ context,caseReference: publicReference('case',company,created.caseId)!,expectedRevision: 1,
    idempotencyKey: 'scanner-private-upload-'+randomUUID(),file: new File([bytes],'synthetic.txt',{ type: 'text/plain' }) })
  const attachment = sql<{ id: string; object_key: string }>(`SELECT jsonb_build_object('id',id,'object_key',object_key)
    FROM public.customer_support_attachments WHERE company_id=${quote(company)} AND customer_id=${quote(customer)};`)
  const pair = await generateKeyPair('RS256'),kid = 'synthetic-'+randomUUID()
  const jwk = { ...await exportJWK(pair.publicKey),kid,alg: 'RS256',use: 'sig' }
  const configuration = JSON.stringify({ [company]: { issuer: 'https://synthetic-scanner.example.invalid',audience: 'isolated-native-scan',
    subject: 'synthetic-scanner-principal',kid,purpose: SUPPORT_SCAN_PURPOSE,jwks: { keys: [jwk] } } })
  vi.stubEnv('GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST',configuration)
  const entry = await scannerTrustEntry(company,configuration)
  sql(`INSERT INTO private.support_attachment_scanner_roots(company_id,issuer_hash,subject_hash,key_hash)
    VALUES(${quote(company)},${quote(entry!.trust.issuerHash)},${quote(entry!.trust.subjectHash)},${quote(entry!.trust.keyHash)}); SELECT to_jsonb(true);`)
  const token = (challenge: SupportScanChallenge,verdict: 'clean' | 'malicious' | 'unknown' = 'clean',patch: Record<string,unknown> = {}) =>
    new SignJWT({ purpose: SUPPORT_SCAN_PURPOSE,binding_sha256: scannerSha256(scanBinding(challenge)),verdict,...patch })
      .setProtectedHeader({ alg: 'RS256',kid,typ: 'gridex-support-attachment-scan+jwt' }).setIssuer(entry!.issuer).setSubject(entry!.subject)
      .setAudience(entry!.audience).setIssuedAt(challenge.issuedAt).setExpirationTime(challenge.expiresAt).setJti(challenge.nonceId).sign(pair.privateKey)
  const snapshot = () => sql<Record<string,unknown[]>>(`SELECT jsonb_build_object(
    'attachments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.customer_support_attachments a WHERE company_id=${quote(company)}),
    'challenges',(SELECT jsonb_agg(to_jsonb(c) ORDER BY nonce_id) FROM private.support_attachment_scan_challenges c WHERE company_id=${quote(company)}),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY nonce_id) FROM private.support_attachment_scan_receipts r WHERE company_id=${quote(company)}));`)
  return { company,customer,sibling,user,authSession,context,bytes,attachment,caseId: created.caseId,entry: entry!,configuration,token,snapshot,
    prepare: () => prepareSupportAttachmentScan({ companyId: company,attachmentId: attachment.id }) }
}

describe.sequential('native authenticated scan lineage; provider remains unqualified', () => {
  it('actual intake and Storage bytes bind a controlled signed verdict; replay is one logical receipt and clean still cannot release', async () => {
    const f = await fixture(),challenge = await f.prepare(),signed = await f.token(challenge),before = f.snapshot()
    expect(challenge.sha256).toBe(scannerSha256(f.bytes))
    expect(challenge.byteSize).toBe(Buffer.byteLength(f.bytes))
    expect(await recordSupportAttachmentScannerVerdict({ challenge,token: signed })).toMatchObject({ verdict: 'clean',releaseAllowed: false,replayed: false })
    const committed = f.snapshot()
    expect(await recordSupportAttachmentScannerVerdict({ challenge,token: signed })).toMatchObject({ replayed: true,releaseAllowed: false })
    expect(f.snapshot()).toEqual(committed)
    expect(committed.attachments).toEqual(before.attachments); expect(committed.receipts).toHaveLength(1)
    expect(await assessSupportAttachmentScan(f.context,f.attachment.id)).toEqual({ releaseAllowed: false,quarantine: 'quarantined',
      outcome: 'blocked_provider_qualification',verdict: 'clean',physicalHashVerified: true })
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{ auth: { persistSession: false } })
    expect((await anonymous.storage.from('customer-support-quarantine').download(f.attachment.object_key)).error).not.toBeNull()
  })
  it('low database roles and signed wrong binding/physical witnesses cannot consume a nonce', async () => {
    const f = await fixture(),challenge = await f.prepare(),signed = await f.token(challenge),before = f.snapshot()
    for (const role of ['anon','authenticated']) expect(() => sql(`SET ROLE ${role}; SELECT public.gridex_reserve_support_attachment_scan_v1(
      ${quote(f.company)},${quote(f.attachment.id)},${quote(JSON.stringify(f.entry.trust))}::jsonb);`)).toThrow(/permission denied/)
    await expect(recordSupportAttachmentScannerVerdict({ challenge,token: await f.token(challenge,'clean',{ binding_sha256: 'b'.repeat(64) }) })).rejects.toThrow('support_attachment_scan_unavailable')
    const proof = await verifySupportAttachmentScannerProof({ challenge,token: signed,configuration: f.configuration })
    const response = await supabaseService.rpc('gridex_record_support_attachment_scan_v1', { p_nonce_id: challenge.nonceId,
      p_proof: { ...proof,physicalSha256: 'b'.repeat(64),physicalByteSize: challenge.byteSize } })
    expect(response.error?.code).toBe('23505'); expect(f.snapshot()).toEqual(before)
  })
  it('two real transactions serialize the same authenticated nonce into one receipt', async () => {
    const f = await fixture(),challenge = await f.prepare(),signed = await f.token(challenge)
    const proof = await verifySupportAttachmentScannerProof({ challenge,token: signed,configuration: f.configuration })
    const p = { ...proof,physicalSha256: challenge.sha256,physicalByteSize: challenge.byteSize }
    const command = `SELECT public.gridex_record_support_attachment_scan_v1(${quote(challenge.nonceId)},${quote(JSON.stringify(p))}::jsonb);`
    const first = session('scan_nonce_first_'+randomUUID()),name = 'scan_nonce_second_'+randomUUID(),second = session(name)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${command}\n\\echo SCAN_NONCE_FIRST_HELD\n`)
      await until(() => first.output().stdout.includes('SCAN_NONCE_FIRST_HELD'),'scan_nonce_first_not_held')
      second.child.stdin.end(`SET ROLE service_role; ${command}`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'));`),'scan_nonce_second_not_waiting')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited,first.output().stderr).toBe(0); expect(await second.exited,second.output().stderr).toBe(0)
      expect(JSON.parse(second.output().stdout.trim())).toMatchObject({ replayed: true,releaseAllowed: false })
      expect(f.snapshot().receipts).toHaveLength(1)
    } finally {
      for (const connection of [first,second]) if (connection.child.exitCode === null) connection.child.kill('SIGTERM')
      await Promise.allSettled([first.exited,second.exited])
    }
  })
  it('a late nonce-consumption trigger failure rolls receipt insertion back and clean retry records once', async () => {
    const f = await fixture(),challenge = await f.prepare(),signed = await f.token(challenge),fault = 'synthetic_scan_consume_'+randomUUID().replaceAll('-',''),before = f.snapshot()
    try {
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id=${quote(f.company)} THEN RAISE EXCEPTION 'synthetic_scan_consume_fault'; END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE UPDATE ON private.support_attachment_scan_challenges FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      await expect(recordSupportAttachmentScannerVerdict({ challenge,token: signed })).rejects.toThrow('support_attachment_scan_unavailable')
      expect(f.snapshot()).toEqual(before)
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON private.support_attachment_scan_challenges; DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
    }
    expect(await recordSupportAttachmentScannerVerdict({ challenge,token: signed })).toMatchObject({ replayed: false,releaseAllowed: false })
    expect(f.snapshot().receipts).toHaveLength(1)
  })
  it('current scanner revocation and current portal session expiry still deny replay/eligibility after a clean receipt', async () => {
    const f = await fixture(),challenge = await f.prepare(),signed = await f.token(challenge)
    await recordSupportAttachmentScannerVerdict({ challenge,token: signed }); const before = f.snapshot()
    sql(`UPDATE private.support_attachment_scanner_roots SET status='revoked' WHERE company_id=${quote(f.company)}; SELECT to_jsonb(true);`)
    await expect(recordSupportAttachmentScannerVerdict({ challenge,token: signed })).rejects.toThrow('support_attachment_scan_unavailable')
    await expect(assessSupportAttachmentScan(f.context,f.attachment.id)).rejects.toThrow('support_attachment_scan_unavailable')
    sql(`UPDATE private.support_attachment_scanner_roots SET status='active' WHERE company_id=${quote(f.company)};
      UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(f.authSession)}; SELECT to_jsonb(true);`)
    await expect(assessSupportAttachmentScan(f.context,f.attachment.id)).rejects.toThrow('support_attachment_scan_unavailable')
    expect(f.snapshot()).toEqual(before)
  })
  it('malicious and unknown signed evidence leave the actual file private and quarantined', async () => {
    for (const verdict of ['malicious','unknown'] as const) {
      const f = await fixture(),challenge = await f.prepare()
      await recordSupportAttachmentScannerVerdict({ challenge,token: await f.token(challenge,verdict) })
      expect(await assessSupportAttachmentScan(f.context,f.attachment.id)).toMatchObject({ verdict,outcome: 'blocked_scan_verdict',releaseAllowed: false })
      expect(sql<string>(`SELECT to_jsonb(scan_status) FROM public.customer_support_attachments WHERE id=${quote(f.attachment.id)};`)).toBe('quarantined')
    }
  })
  it('scanner-root expiry during a real late insert wait rolls the private challenge back', async () => {
    const f = await fixture(),fault = 'synthetic_scan_wait_'+randomUUID().replaceAll('-',''),before = f.snapshot()
    try {
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id=${quote(f.company)} THEN PERFORM pg_sleep(0.6); END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON private.support_attachment_scan_challenges FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      expect(() => sql(`UPDATE private.support_attachment_scanner_roots SET valid_until=clock_timestamp()+interval '0.4 seconds'
        WHERE company_id=${quote(f.company)}; SET ROLE service_role; SELECT public.gridex_reserve_support_attachment_scan_v1(
          ${quote(f.company)},${quote(f.attachment.id)},${quote(JSON.stringify(f.entry.trust))}::jsonb);`)).toThrow(/support_scanner_unavailable/)
      expect(f.snapshot()).toEqual(before)
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON private.support_attachment_scan_challenges; DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
    }
  })
  it('a parent-held intake interleaving can lock its attachment before the scanner resumes without a child-parent deadlock', async () => {
    const f = await fixture(),first = session('scan_parent_first_'+randomUUID()),name = 'scan_parent_second_'+randomUUID(),second = session(name)
    try {
      first.child.stdin.write(`BEGIN; SELECT to_jsonb(id) FROM public.customers WHERE id=${quote(f.customer)} FOR UPDATE;
        SELECT to_jsonb(id) FROM public.customer_cases WHERE id=${quote(f.caseId)} FOR UPDATE;\n\\echo SCAN_PARENT_HELD\n`)
      await until(() => first.output().stdout.includes('SCAN_PARENT_HELD'),'scan_parent_not_held')
      second.child.stdin.end(`SET ROLE service_role; SELECT public.gridex_reserve_support_attachment_scan_v1(
        ${quote(f.company)},${quote(f.attachment.id)},${quote(JSON.stringify(f.entry.trust))}::jsonb);`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'));`),'scan_parent_second_not_waiting')
      first.child.stdin.write(`SELECT to_jsonb(id) FROM public.customer_support_attachments WHERE id=${quote(f.attachment.id)} FOR UPDATE;\n\\echo SCAN_ATTACHMENT_HELD\n`)
      await until(() => first.output().stdout.includes('SCAN_ATTACHMENT_HELD'),'scan_parent_child_lock_not_acquired')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited,first.output().stderr).toBe(0); expect(await second.exited,second.output().stderr).toBe(0)
      expect(JSON.parse(second.output().stdout.trim())).toMatchObject({ attachmentId: f.attachment.id,customerId: f.customer })
    } finally {
      for (const connection of [first,second]) if (connection.child.exitCode === null) connection.child.kill('SIGTERM')
      await Promise.allSettled([first.exited,second.exited])
    }
  })
  // Retain own immutable intake/audit/scan receipts, companies/legal versions
  // and private Storage objects until disposable teardown. Only own temporary
  // fault triggers/functions are removed; no guard or quarantine is bypassed.
})
