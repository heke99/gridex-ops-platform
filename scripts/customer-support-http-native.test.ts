import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import { expect, it } from 'vitest'
import { proofSql, quote, readFixture, saveFixture, seedReadActors, type ReadProofFixture } from './customer-read-proof-native'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { billingConfigurationSnapshotSha256, readQualifiedLockedBillingProfile } from '@/lib/billing/billingConfigurationSnapshot'
import { lockBillingConfiguration } from '@/lib/billing/billingProfileCommand'

const env = 'GRIDEX_SUPPORT_HTTP_FIXTURE_PATH'
type Login = { userId: string; email: string; password: string }
type Staff = Login & { sessionId: string }
type Journey = { owner: Login; contractId: string; oldUnderlayId: string; nextUnderlayId: string; documentId: string; invoiceId: string; history: unknown; initialProfileRevision: number }
type Fixture = ReadProofFixture & { staff: Staff; reader: Staff; journey: Journey; ui: { companyId: string; customerId: string; owner: Login; viewer: Login } }
function journeyHistory(companyId: string, customerId: string, journey: Pick<Journey, 'oldUnderlayId' | 'documentId' | 'invoiceId'>) {
  return proofSql(`SELECT jsonb_build_object(
    'locked_basis',(SELECT to_jsonb(u) FROM public.billing_underlays u WHERE id=${quote(journey.oldUnderlayId)} AND company_id=${quote(companyId)} AND customer_id=${quote(customerId)}),
    'document',(SELECT to_jsonb(d) FROM public.customer_documents d WHERE id=${quote(journey.documentId)} AND company_id=${quote(companyId)} AND customer_id=${quote(customerId)}),
    'issued_invoice',(SELECT to_jsonb(i) FROM public.customer_invoices i WHERE id=${quote(journey.invoiceId)} AND company_id=${quote(companyId)} AND customer_id=${quote(customerId)}));`)
}
function verifySupportReadAndClosedIntake(f: ReadProofFixture, staff: Staff, reader: Staff) {
  const c = f.customers[0]
  expect(proofSql(`SET ROLE service_role; SELECT jsonb_build_object(
    'staff',public.gridex_support_ops_read_access_v1(${quote(c.companyId)},${quote(staff.userId)},${quote(staff.sessionId)}),
    'reader',public.gridex_support_ops_read_access_v1(${quote(c.companyId)},${quote(reader.userId)},${quote(reader.sessionId)}),
    'foreign_tenant',public.gridex_support_ops_read_access_v1(${quote(f.companies[1])},${quote(staff.userId)},${quote(staff.sessionId)}));`)
  ).toEqual({ staff: true, reader: true, foreign_tenant: false })
  // An expired row still exists: token/user verification does not replace this live read gate.
  expect(proofSql(`BEGIN; UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(staff.sessionId)};
    SET LOCAL ROLE service_role; SELECT to_jsonb(public.gridex_support_ops_read_access_v1(${quote(c.companyId)},${quote(staff.userId)},${quote(staff.sessionId)})); ROLLBACK;`)).toBe(false)
  const context = { companyId: c.companyId, customerId: c.customerId, mode: 'ops', actorUserId: staff.userId,
    sessionId: staff.sessionId, clientId: null, subject: null }
  const apiContext = { companyId: c.companyId, customerId: c.customerId, mode: 'api', actorUserId: null,
    sessionId: null, clientId: c.clientId, subject: c.userId }
  const create = { ...context, channel: 'ops', operation: 'create', caseId: null, caseReference: null,
    expectedRevision: 0, idempotencyKey: 'support-http-native-closed-regression', payload: { title: 'Synthetic closed-publication regression', body: 'Synthetic rollback-only case' } }
  expect(proofSql(`BEGIN; SET LOCAL ROLE service_role; DO $proof$
    DECLARE created jsonb; intake jsonb; before_intents bigint; denied boolean:=false;
    BEGIN
      created:=public.gridex_support_case_command_v1(${quote(JSON.stringify(create))}::jsonb);
      PERFORM public.gridex_support_case_publication_v1(${quote(JSON.stringify(context))}::jsonb,
        jsonb_build_object('operation','publish','caseId',created->>'caseId','title','Closed to customer changes',
          'body','Synthetic explicitly authored summary','status','closed','channel','phone','expectedRevision',0));
      IF NOT EXISTS(SELECT 1 FROM public.customer_cases WHERE id=(created->>'caseId')::uuid AND status='open' AND support_revision=2) THEN
        RAISE EXCEPTION 'support_native_closed_publication_fixture_invalid'; END IF;
      SELECT count(*) INTO before_intents FROM public.canonical_event_outbox WHERE company_id=${quote(c.companyId)} AND topic='customer.support.attachment.scan_requested';
      intake:=jsonb_build_object('stage','reserve','caseReference',created->>'caseReference','expectedRevision',2,
        'idempotencyKey','support-http-native-closed-intake','visibility','customer','fileName','synthetic-closed.txt',
        'mediaType','text/plain','byteSize',3,'sha256',repeat('a',64));
      BEGIN
        PERFORM public.gridex_support_attachment_intake_v1(${quote(JSON.stringify(apiContext))}::jsonb,intake);
      EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM<>'support_case_closed' THEN RAISE; END IF; denied:=true;
      END;
      IF NOT denied OR EXISTS(SELECT 1 FROM public.customer_support_attachments WHERE customer_case_id=(created->>'caseId')::uuid)
        OR (SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(c.companyId)} AND topic='customer.support.attachment.scan_requested')<>before_intents THEN
        RAISE EXCEPTION 'support_native_closed_publication_intake_allowed_or_partial'; END IF;
      -- The internal case is still open, so a staff-only attachment may reserve.
      PERFORM public.gridex_support_attachment_intake_v1(${quote(JSON.stringify(context))}::jsonb,
        (intake-'caseReference')||jsonb_build_object('caseId',created->>'caseId','visibility','internal','idempotencyKey','support-http-native-internal-intake'));
      IF NOT EXISTS(SELECT 1 FROM public.customer_support_attachments WHERE customer_case_id=(created->>'caseId')::uuid AND visibility='internal' AND uploaded_at IS NULL) THEN
        RAISE EXCEPTION 'support_native_closed_publication_internal_reservation_failed'; END IF;
    END $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
}
async function loginActor(tag: string): Promise<Login> {
  const email = `support-ui-${tag}-${randomUUID().slice(0, 8)}@example.invalid`
  const password = randomBytes(24).toString('base64url')
  const result = await supabaseService.auth.admin.createUser({ email, password, email_confirm: true })
  if (result.error || !result.data.user) throw new Error('support_ui_auth_fixture_failed')
  return { userId: result.data.user.id, email, password }
}
it('seeds API support actors with real OPS/read-only sessions and verifies the cross-channel commit graph', async () => {
  if (process.env.GRIDEX_SUPPORT_HTTP_VERIFY_AFTER_HTTP === '1') {
    const f = readFixture<Fixture>(env)
    for (const [index, c] of f.customers.entries()) {
      const counts = proofSql<{ cases: number; commands: number; audits: number; publicMessages: number; internalMessages: number }>(`SELECT jsonb_build_object(
        'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)} AND source='tenant_support_api'),
        'commands',(SELECT count(*) FROM public.canonical_command_results r WHERE company_id=${quote(c.companyId)} AND command_type='customer.support.command.v1' AND request_payload->>'customerId'=${quote(c.customerId)}),
        'audits',(SELECT count(*) FROM public.canonical_audit_events a JOIN public.customer_cases ca ON ca.id=a.aggregate_id AND ca.company_id=a.company_id WHERE a.company_id=${quote(c.companyId)} AND ca.customer_id=${quote(c.customerId)} AND a.event_type='CUSTOMER_SUPPORT_COMMAND'),
        'publicMessages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)} AND visibility='customer'),
        'internalMessages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)} AND visibility='internal'));
      `)
      expect(counts).toEqual(index === 0 ? { cases: 2, commands: 5, audits: 5, publicMessages: 6, internalMessages: 1 }
        : { cases: 1, commands: 1, audits: 1, publicMessages: 1, internalMessages: 0 })
    }
    const ui = f.ui
    expect(proofSql(`SELECT jsonb_build_object(
      'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${quote(ui.companyId)} AND customer_id=${quote(ui.customerId)} AND source='tenant_support_portal'),
      'revision',(SELECT support_revision FROM public.customer_cases WHERE company_id=${quote(ui.companyId)} AND customer_id=${quote(ui.customerId)}),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(ui.companyId)} AND command_type='customer.support.command.v1' AND request_payload->>'customerId'=${quote(ui.customerId)}),
      'publicMessages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(ui.companyId)} AND customer_id=${quote(ui.customerId)} AND visibility='customer'),
      'internalMessages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(ui.companyId)} AND customer_id=${quote(ui.customerId)} AND visibility='internal'),
      'audits',(SELECT count(*) FROM public.canonical_audit_events a JOIN public.customer_cases c ON c.id=a.aggregate_id AND c.company_id=a.company_id WHERE c.customer_id=${quote(ui.customerId)} AND a.event_type='CUSTOMER_SUPPORT_COMMAND'));
    `)).toEqual({ cases: 1, revision: 4, commands: 4, publicMessages: 3, internalMessages: 1, audits: 4 })
    const attachments = proofSql<Array<{ company_id: string; customer_id: string; customer_case_id: string; id: string; object_key: string; content_sha256: string; byte_size: number; scan_status: string }>>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.customer_support_attachments a
      WHERE company_id IN (${f.companies.map(quote).join(',')}) AND uploaded_at IS NOT NULL;`)
    expect(attachments).toHaveLength(2)
    const customer = f.customers[0], journey = f.journey
    const original = proofSql<{ id: string; revision: number }>(`SELECT jsonb_build_object('id',id,'revision',support_revision) FROM public.customer_cases
      WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND title='Synthetic case A1' AND source='tenant_support_api';`)
    expect(original.revision).toBe(8)
    expect(proofSql(`SELECT jsonb_build_object(
      'publications',(SELECT count(*) FROM public.customer_case_publications WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND customer_case_id=${quote(original.id)}),
      'currentPhone',(SELECT count(*) FROM public.customer_case_publications WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND customer_case_id=${quote(original.id)} AND revoked_at IS NULL AND revision=2 AND public_status='open' AND channel='phone' AND author_user_id=${quote(f.staff.userId)}),
      'phoneMessages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND customer_case_id=${quote(original.id)} AND visibility='customer' AND author_kind='staff' AND actor_user_id=${quote(f.staff.userId)} AND channel='phone' AND caller_verification='not_applicable' AND publication_id IS NOT NULL),
      'privatePhoneNote',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND customer_case_id=${quote(original.id)} AND visibility='internal' AND author_kind='staff' AND actor_user_id=${quote(f.staff.userId)} AND channel='phone' AND caller_verification='unverified' AND publication_id IS NULL AND body='INTERNAL SECRET SUPPORT NOTE'),
      'publicationAudits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(customer.companyId)} AND aggregate_id=${quote(original.id)} AND event_type='CUSTOMER_SUPPORT_PUBLICATION'),
      'attachmentAudits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(customer.companyId)} AND aggregate_id=${quote(original.id)} AND event_type='CUSTOMER_SUPPORT_ATTACHMENT'),
      'attachmentCommands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(customer.companyId)} AND command_type='customer.support.attachment.v1' AND request_payload->>'caseId'=${quote(original.id)}));`)
    ).toEqual({ publications: 2, currentPhone: 1, phoneMessages: 2, privatePhoneNote: 1, publicationAudits: 2, attachmentAudits: 2, attachmentCommands: 2 })
    expect(proofSql(`SELECT jsonb_build_object('all',count(*),'api',count(*) FILTER(WHERE channel='api'),'portal',count(*) FILTER(WHERE channel='portal'))
      FROM public.customer_support_attachments WHERE company_id IN (${f.companies.map(quote).join(',')});`)).toEqual({ all: 2, api: 1, portal: 1 })
    const authenticated = createClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    expect((await authenticated.auth.signInWithPassword({ email: f.staff.email, password: f.staff.password })).error).toBeNull()
    for (const attachment of attachments) {
      expect(attachment.company_id).toBe(customer.companyId)
      expect(attachment.customer_id).toBe(customer.customerId)
      expect(attachment.customer_case_id).toBe(original.id)
      expect(attachment.object_key).toBe(`${attachment.company_id}/${attachment.customer_id}/${attachment.customer_case_id}/${attachment.id}`)
      expect(attachment.scan_status).toBe('quarantined')
      const downloaded = await supabaseService.storage.from('customer-support-quarantine').download(attachment.object_key)
      expect(downloaded.error).toBeNull()
      expect(downloaded.data?.size).toBe(attachment.byte_size)
      expect(createHash('sha256').update(new Uint8Array(await downloaded.data!.arrayBuffer())).digest('hex')).toBe(attachment.content_sha256)
      const anonymous = createClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
      expect((await anonymous.storage.from('customer-support-quarantine').download(attachment.object_key)).error).not.toBeNull()
      expect((await authenticated.storage.from('customer-support-quarantine').download(attachment.object_key)).error).not.toBeNull()
    }
    expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.canonical_event_outbox o
      WHERE company_id IN (${f.companies.map(quote).join(',')}) AND topic='customer.support.changed';`)).toBe(11)
    expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.canonical_event_outbox o
      WHERE company_id IN (${f.companies.map(quote).join(',')}) AND topic='customer.support.attachment.scan_requested';`)).toBe(2)
    expect(proofSql(`SELECT jsonb_build_object(
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id IN (${f.companies.map(quote).join(',')}) AND payload::text~'INTERNAL SECRET SUPPORT NOTE|SYNTHETIC PRIVATE BROWSER NOTE'),
      'notifications',(SELECT count(*) FROM public.customer_notifications n WHERE company_id IN (${f.companies.map(quote).join(',')}) AND to_jsonb(n)::text~'INTERNAL SECRET SUPPORT NOTE|SYNTHETIC PRIVATE BROWSER NOTE'));`)
    ).toEqual({ outbox: 0, notifications: 0 })
    const current = proofSql<Record<string, unknown>>(`SELECT to_jsonb(c) FROM public.customers c WHERE company_id=${quote(customer.companyId)} AND id=${quote(customer.customerId)};`)
    const contract = proofSql<Record<string, unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND id=${quote(journey.contractId)};`)
    expect(current.billing_profile_revision).toBe(journey.initialProfileRevision + 1)
    expect(current.email).toBe('journey-contact-before@example.invalid')
    const effective = resolveEffectiveBillingProfile({ companyId: customer.companyId, customerId: customer.customerId, customer: current, contract, defaultDistributionMethod: 'email' })
    expect(effective).toMatchObject({ profileRevision: journey.initialProfileRevision + 1, email: 'journey-billing@example.invalid', blockers: [] })
    const snapshot = { schema: 'billing_configuration_v2', company_id: customer.companyId, customer_id: customer.customerId, contract_id: journey.contractId, effective_billing_profile: effective }
    const hash = billingConfigurationSnapshotSha256(snapshot)
    await lockBillingConfiguration({ companyId: customer.companyId, underlayId: journey.nextUnderlayId, effectiveProfile: effective, snapshot, snapshotSha256: hash })
    const next = proofSql<{ billing_configuration_snapshot: unknown; billing_configuration_sha256: string }>(`SELECT jsonb_build_object('billing_configuration_snapshot',billing_configuration_snapshot,'billing_configuration_sha256',billing_configuration_sha256)
      FROM public.billing_underlays WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)} AND id=${quote(journey.nextUnderlayId)};`)
    expect(readQualifiedLockedBillingProfile(next.billing_configuration_snapshot, { companyId: customer.companyId, customerId: customer.customerId, contractId: journey.contractId, snapshotSha256: next.billing_configuration_sha256 })).toMatchObject({ email: 'journey-billing@example.invalid', profileRevision: journey.initialProfileRevision + 1 })
    expect(JSON.stringify(journeyHistory(customer.companyId, customer.customerId, journey))).toBe(JSON.stringify(journey.history))
    console.log('SUPPORT_HTTP_POST_NATIVE_PASS customers=3 cases=4 logical_commands=7 command_audits=7 publication_audits=2 attachment_audits=2 public_messages=8 internal_notes=1 durable_support_intents=8 private_scan_intents=2')
    console.log('SUPPORT_INTERACTIVE_POST_NATIVE_PASS cases=1 revision=4 logical_commands=4 audits=4 public_messages=3 internal_notes=1 durable_intents=3')
    console.log('SUPPORT_JOURNEY_POST_NATIVE_PASS same_api_case=true support_revision=8 phone_staff_publications=2 independently_authorized_billing_revision=true next_basis_lock=true old_locked_basis_unchanged=true synthetic_document_invoice_rows_unchanged=true attachments_actual_bytes_private_quarantined=true issuer_unconfigured=true scanner_unconfigured=true caller_identity_unverified=true')
    return
  }
  const f = await seedReadActors('support-http', '/api/v1/customer/cases', ['customer_cases.read', 'customer_cases.write', 'customer_billing.read', 'customer_billing.write', 'customer_profile.read'])
  const staff = { ...await loginActor('staff'), sessionId: randomUUID() }, reader = { ...await loginActor('reader'), sessionId: randomUUID() }
  for (const [actor, write] of [[staff, true], [reader, false]] as const) {
    const roleId = randomUUID(), roleKey = `support_http_${actor.userId.replaceAll('-', '_')}`
    proofSql(`      INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(${quote(actor.sessionId)},${quote(actor.userId)},now(),now());
      INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor.userId)},${quote(actor.email)},'Synthetic HTTP support staff','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
      INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(f.companies[0])},${quote(actor.userId)},${write ? "'company_admin'" : "'viewer'"},'active',now(),${write ? "'company_admin'" : "'viewer'"},true,now(),${write ? "'company_admin'" : "'finance_readonly'"});
      INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(roleId)},${quote(roleKey)},'Synthetic support browser role','company');
      INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${quote(actor.userId)},${quote(f.companies[0])},${quote(roleId)},${quote(roleKey)},'active',true);
      INSERT INTO public.permissions(key,name) VALUES('cases.read','Synthetic support read'),('cases.write','Synthetic support write'),('customers.read','Synthetic customer read'),('masterdata.write','Synthetic independently authorized billing edit') ON CONFLICT(key) DO NOTHING;
      INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
        SELECT ${quote(actor.userId)},${quote(f.companies[0])},id,key FROM public.permissions WHERE key IN (${write ? "'cases.read','cases.write','customers.read','masterdata.write'" : "'cases.read'"});
      INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key)
        SELECT ${quote(roleId)},${quote(roleKey)},id,key FROM public.permissions WHERE key IN (${write ? "'cases.read','cases.write','customers.read','masterdata.write'" : "'cases.read'"});
      SELECT to_jsonb(count(*)) FROM auth.sessions WHERE id=${quote(actor.sessionId)};`)
    const auth = createClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    const signed = await auth.auth.signInWithPassword({ email: actor.email, password: actor.password })
    expect(signed.error).toBeNull()
    const context = await auth.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: f.companies[0] })
    expect(context.error).toBeNull()
    expect(context.data).toMatchObject({ authorized: true, selected_company_id: f.companies[0] })
    expect(context.data.permissions).toContain('cases.read')
    if (write) expect(context.data.permissions).toContain('cases.write')
    else expect(context.data.permissions).not.toContain('cases.write')
  }
  expect(proofSql<boolean>(`SELECT to_jsonb(has_table_privilege('anon','public.customer_support_threads','SELECT')
    OR has_table_privilege('authenticated','public.customer_support_messages','SELECT')
    OR has_function_privilege('authenticated','public.gridex_support_case_command_v1(jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.gridex_support_ops_read_access_v1(uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.gridex_support_ops_read_access_v1(uuid,uuid,uuid)','EXECUTE'));`)).toBe(false)
  verifySupportReadAndClosedIntake(f, staff, reader)
  const ui = { companyId: f.companies[0], customerId: randomUUID(), owner: await loginActor('owner'), viewer: await loginActor('viewer') }
  proofSql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
    VALUES(${quote(ui.customerId)},${quote(ui.companyId)},${quote(`support-ui-${ui.customerId.slice(0, 8)}`)},'Synthetic interactive support customer','private');
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email) VALUES
    ${([['owner', ui.owner], ['viewer', ui.viewer]] as const).map(([role, actor]) => `(${quote(ui.companyId)},${quote(ui.customerId)},${quote(actor.userId)},${quote(actor.userId)},'active',true,${quote(role)},${quote(actor.email)})`).join(',')};
    SELECT to_jsonb(count(*)) FROM public.customer_portal_accounts WHERE customer_id=${quote(ui.customerId)};`)
  const customer = f.customers[0], password = randomBytes(24).toString('base64url')
  const owner = await supabaseService.auth.admin.updateUserById(customer.userId, { password })
  if (owner.error || !owner.data.user?.email) throw new Error('support_journey_owner_seed_failed')
  const journey: Journey = { owner: { userId: customer.userId, email: owner.data.user.email, password }, contractId: randomUUID(), oldUnderlayId: randomUUID(), nextUnderlayId: randomUUID(), documentId: randomUUID(), invoiceId: randomUUID(), history: null, initialProfileRevision: 0 }
  proofSql(`UPDATE public.customers SET email='journey-contact-before@example.invalid',invoice_email='journey-billing-before@example.invalid',
    billing_profile='{"recipient":"Synthetic journey customer","distributionMethod":"email","email":"journey-billing-before@example.invalid"}'::jsonb
    WHERE id=${quote(customer.customerId)} AND company_id=${quote(customer.companyId)};
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status) VALUES(${quote(journey.contractId)},${quote(customer.companyId)},${quote(customer.customerId)},'draft');
    INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status) VALUES
      (${quote(journey.oldUnderlayId)},${quote(customer.companyId)},${quote(customer.customerId)},${quote(journey.contractId)},${quote(journey.contractId)},2026,8,'pending'),
      (${quote(journey.nextUnderlayId)},${quote(customer.companyId)},${quote(customer.customerId)},${quote(journey.contractId)},${quote(journey.contractId)},2026,9,'pending');
    INSERT INTO public.customer_documents(id,company_id,customer_id,document_type,title,file_name,mime_type,source_system,raw_payload)
      VALUES(${quote(journey.documentId)},${quote(customer.companyId)},${quote(customer.customerId)},'signed_contract_pdf','Synthetic historical document row','synthetic-signed.pdf','application/pdf','synthetic_native_proof','{"original_bytes_base64":"JVBERi0xLjQKc3ludGhldGljIGhpc3Rvcnk=","billing_email":"journey-billing-before@example.invalid"}');
    INSERT INTO public.customer_invoices(id,company_id,customer_id,status,invoice_number,issued_at,source_system,raw_payload,metadata)
      VALUES(${quote(journey.invoiceId)},${quote(customer.companyId)},${quote(customer.customerId)},'issued',${quote(`support-journey-${journey.invoiceId}`)},now(),'synthetic_native_proof','{"billing_email":"journey-billing-before@example.invalid"}','{"synthetic":true}');
    SELECT to_jsonb(true);`)
  const initial = proofSql<Record<string, unknown>>(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(customer.customerId)} AND company_id=${quote(customer.companyId)};`)
  const contract = proofSql<Record<string, unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${quote(journey.contractId)} AND company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)};`)
  journey.initialProfileRevision = Number(initial.billing_profile_revision)
  const effective = resolveEffectiveBillingProfile({ companyId: customer.companyId, customerId: customer.customerId, customer: initial, contract, defaultDistributionMethod: 'email' })
  expect(effective.blockers).toEqual([])
  const snapshot = { schema: 'billing_configuration_v2', company_id: customer.companyId, customer_id: customer.customerId, contract_id: journey.contractId, effective_billing_profile: effective }
  await lockBillingConfiguration({ companyId: customer.companyId, underlayId: journey.oldUnderlayId, effectiveProfile: effective, snapshot, snapshotSha256: billingConfigurationSnapshotSha256(snapshot) })
  journey.history = journeyHistory(customer.companyId, customer.customerId, journey)
  saveFixture(env, { ...f, staff, reader, ui, journey })
  console.log('SUPPORT_HTTP_SEED_NATIVE_PASS customers=3 tenants=2 synthetic_users=true synthetic_delegation_issuer=true ops_session=true readonly_session=true live_read_expiry_denied=true closed_publication_intake_denied=true direct_client_grants=false')
})
