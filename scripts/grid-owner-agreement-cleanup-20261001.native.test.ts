import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { proofSql, quote } from './customer-read-proof-native'

// Installed real functions/ACLs with synthetic actual-table authority rows.
// All rows/faults roll back. No GoTrue, HTTP or physical Storage acceptance.
function fixture() {
  const company = randomUUID(), quiet = randomUUID(), actor = randomUUID(), session = randomUUID(), owner = randomUUID(), foreign = randomUUID(), token = randomUUID()
  const command = { operation: 'prepare_upload', actorUserId: actor, sessionId: session, companyId: company, id: null,
    expectedRevision: 0, idempotencyKey: 'cleanup-native-' + randomUUID(), payload: { gridOwnerId: owner, agreementType: 'metering_access', agreementScope: 'metering_access', status: 'draft', metadata: {}, referenceRequirements: {},
      documentFile: { bucket: 'grid-owner-agreements', name: 'owned.pdf', sha256: 'a'.repeat(64), size: 20, contentType: 'application/pdf' } } }
  const protectedTables = ['customers', 'customer_contracts', 'billing_underlays', 'customer_invoices', 'invoice_export_items', 'ediel_messages', 'outbound_requests', 'tenant_email_outbox']
  const seed = `BEGIN;
    INSERT INTO public.companies(id,name,status,lifecycle_status,is_active) VALUES
      (${quote(company)},'Synthetic cleanup A','active','active',true),(${quote(quiet)},'Synthetic cleanup B','active','active',true);
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(actor)},'authenticated','authenticated',${quote(actor + '@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(actor + '@example.invalid')},'Synthetic cleanup actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(session)},${quote(actor)},now(),now(),clock_timestamp()+interval '1 hour');
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(actor)},'platform_admin',true);
    INSERT INTO public.grid_owners(id,company_id,name) VALUES(${quote(owner)},${quote(company)},'Owned cleanup owner'),(${quote(foreign)},${quote(quiet)},'Quiet cleanup owner');
    CREATE TEMP TABLE agreement_cleanup_protected(table_name text primary key,digest text) ON COMMIT DROP;
    ${protectedTables.map(name => `INSERT INTO agreement_cleanup_protected SELECT ${quote(name)},encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.${name} t;`).join('\n')}
    SELECT set_config('gridex.cleanup.native_command',${quote(JSON.stringify(command))},true);
    SELECT set_config('gridex.cleanup.quiet_owner_hash',(SELECT encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') FROM public.grid_owners g WHERE id=${quote(foreign)}),true);`
  const finish = `RESET ROLE;
    ${protectedTables.map(name => `DO $protected$ BEGIN IF (SELECT digest FROM agreement_cleanup_protected WHERE table_name=${quote(name)}) IS DISTINCT FROM
      (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.${name} t)
      THEN RAISE EXCEPTION 'cleanup_native_protected_graph_changed'; END IF; END $protected$;`).join('\n')}
    DO $quiet$ BEGIN IF current_setting('gridex.cleanup.quiet_owner_hash') IS DISTINCT FROM
      (SELECT encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') FROM public.grid_owners g WHERE id=${quote(foreign)}) THEN RAISE EXCEPTION 'cleanup_native_foreign_changed'; END IF; END $quiet$;
    SELECT jsonb_build_object('passed',true) AS proof_receipt; ROLLBACK;`
  return { company, quiet, actor, session, owner, token, command, seed, finish }
}
function run(f: ReturnType<typeof fixture>, sql: string) { return proofSql<{ passed: boolean }>(f.seed + sql + f.finish) }

it('real installed cleanup seals one explicit tenant orphan and periodically settles the same exact key', () => {
  const f = fixture()
  expect(run(f, `SET LOCAL ROLE service_role;
    DO $prepare$ DECLARE p jsonb; BEGIN p:=public.gridex_grid_owner_agreement_command_v1(current_setting('gridex.cleanup.native_command')::jsonb);
      PERFORM set_config('gridex.cleanup.native_intent',p->'intent'->>'id',true); END $prepare$;
    RESET ROLE; UPDATE private.gridex_agreement_uploads_v1 SET created_at=clock_timestamp()-interval '1 hour' WHERE id=current_setting('gridex.cleanup.native_intent')::uuid;
    DELETE FROM auth.sessions WHERE id=${quote(f.session)};
    SET LOCAL ROLE service_role;
    DO $proof$ DECLARE r jsonb; c jsonb; done jsonb; denied boolean:=false; BEGIN
      IF jsonb_array_length(public.gridex_claim_agreement_cleanup_v1(${quote(f.quiet)},${quote(randomUUID())},1))<>0 THEN RAISE EXCEPTION 'cleanup_native_foreign_claim'; END IF;
      r:=public.gridex_claim_agreement_cleanup_v1(${quote(f.company)},${quote(f.token)},1);
      IF jsonb_array_length(r)<>1 THEN RAISE EXCEPTION 'cleanup_native_missing_claim'; END IF; c:=r->0;
      IF public.gridex_validate_agreement_cleanup_v1(c) IS DISTINCT FROM true THEN RAISE EXCEPTION 'cleanup_native_current_lease_missing'; END IF;
      done:=public.gridex_finish_agreement_cleanup_v1(c,'removed');
      IF done->>'finished' IS DISTINCT FROM 'true' OR public.gridex_finish_agreement_cleanup_v1(c,'removed')->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'cleanup_native_finish_once_failed'; END IF;
      PERFORM set_config('gridex.cleanup.native_receipt',c::text,true);
    END $proof$;
    RESET ROLE; UPDATE private.gridex_agreement_cleanup_claims_v1 SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE upload_intent_id=current_setting('gridex.cleanup.native_intent')::uuid;
    SET LOCAL ROLE service_role;
    DO $settle$ DECLARE c jsonb; BEGIN c:=public.gridex_claim_agreement_cleanup_v1(${quote(f.company)},${quote(randomUUID())},1)->0;
      IF c->>'attempt' IS DISTINCT FROM '2' OR c->>'path' IS DISTINCT FROM current_setting('gridex.cleanup.native_receipt')::jsonb->>'path' THEN RAISE EXCEPTION 'cleanup_native_settlement_binding_failed'; END IF;
      PERFORM public.gridex_finish_agreement_cleanup_v1(c,'retry'); END $settle$;
    RESET ROLE;
    DO $facts$ BEGIN IF (SELECT count(*) FROM private.gridex_agreement_cleanup_events_v1 WHERE company_id=${quote(f.company)})<>4
      OR EXISTS(SELECT 1 FROM public.grid_owner_access_agreements WHERE company_id=${quote(f.company)}) THEN RAISE EXCEPTION 'cleanup_native_business_effect'; END IF; END $facts$;`)).toEqual({ passed: true })
})

it('real installed writer preserves attached documents and rejects manual publication of a never-attached key', () => {
  const f = fixture()
  expect(run(f, `SET LOCAL ROLE service_role;
    DO $proof$ DECLARE c jsonb:=current_setting('gridex.cleanup.native_command')::jsonb; p jsonb; r jsonb; denied boolean:=false; BEGIN
      p:=public.gridex_grid_owner_agreement_command_v1(c);
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','save','idempotencyKey',c->>'idempotencyKey'||'-manual','payload',
        ((c->'payload')-'documentFile')||jsonb_build_object('documentPath',(p->'intent'->>'bucket')||':'||(p->'intent'->>'path')))); EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'cleanup_native_manual_race_open'; END IF;
      r:=public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','save','uploadIntentId',p->'intent'->>'id','cleanupToken',p->'intent'->>'token'));
      PERFORM set_config('gridex.cleanup.attached_document',r->'agreement'->>'document_path',true);
    END $proof$;
    RESET ROLE; UPDATE private.gridex_agreement_uploads_v1 SET created_at=clock_timestamp()-interval '1 hour' WHERE company_id=${quote(f.company)};
    SET LOCAL ROLE service_role;
    DO $claim$ BEGIN IF jsonb_array_length(public.gridex_claim_agreement_cleanup_v1(${quote(f.company)},${quote(f.token)},1))<>0 THEN RAISE EXCEPTION 'cleanup_native_attached_exposed'; END IF; END $claim$;
    RESET ROLE; DO $facts$ BEGIN IF (SELECT count(*) FROM public.grid_owner_access_agreements WHERE company_id=${quote(f.company)} AND document_path=current_setting('gridex.cleanup.attached_document'))<>1 THEN RAISE EXCEPTION 'cleanup_native_attached_resource_changed'; END IF; END $facts$;`)).toEqual({ passed: true })
})

it('real cleanup claim audit rollback and least-privilege boundaries keep prepared and foreign resources intact', () => {
  const f = fixture()
  expect(run(f, `SET LOCAL ROLE service_role; SELECT public.gridex_grid_owner_agreement_command_v1(current_setting('gridex.cleanup.native_command')::jsonb);
    RESET ROLE; UPDATE private.gridex_agreement_uploads_v1 SET created_at=clock_timestamp()-interval '1 hour' WHERE company_id=${quote(f.company)};
    CREATE FUNCTION private.cleanup_native_fault_${f.actor.replaceAll('-', '')}() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN IF NEW.company_id=${quote(f.company)}::uuid THEN RAISE EXCEPTION 'owned_cleanup_claim_fault'; END IF; RETURN NEW; END $fault$;
    CREATE TRIGGER cleanup_native_owned_fault BEFORE INSERT ON private.gridex_agreement_cleanup_events_v1 FOR EACH ROW EXECUTE FUNCTION private.cleanup_native_fault_${f.actor.replaceAll('-', '')}();
    SET LOCAL ROLE service_role;
    DO $proof$ DECLARE denied boolean:=false; BEGIN BEGIN PERFORM public.gridex_claim_agreement_cleanup_v1(${quote(f.company)},${quote(f.token)},1); EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='owned_cleanup_claim_fault'; END;
      IF NOT denied THEN RAISE EXCEPTION 'cleanup_native_claim_rollback_missing'; END IF;
      denied:=false; BEGIN PERFORM private.gridex_agreement_command_v1_unchecked(current_setting('gridex.cleanup.native_command')::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'cleanup_native_unchecked_exposed'; END IF; END $proof$;
    RESET ROLE; DO $facts$ BEGIN IF EXISTS(SELECT 1 FROM private.gridex_agreement_uploads_v1 WHERE company_id=${quote(f.company)} AND status<>'prepared')
      OR EXISTS(SELECT 1 FROM private.gridex_agreement_cleanup_claims_v1 c JOIN private.gridex_agreement_uploads_v1 u ON u.id=c.upload_intent_id WHERE u.company_id=${quote(f.company)})
      THEN RAISE EXCEPTION 'cleanup_native_partial_seal'; END IF; END $facts$;
    SET LOCAL ROLE authenticated; DO $denied$ DECLARE d boolean:=false; BEGIN BEGIN PERFORM public.gridex_claim_agreement_cleanup_v1(${quote(f.company)},${quote(f.token)},1); EXCEPTION WHEN insufficient_privilege THEN d:=true; END;
      IF NOT d THEN RAISE EXCEPTION 'cleanup_native_public_exposed'; END IF; END $denied$;`)).toEqual({ passed: true })
})
