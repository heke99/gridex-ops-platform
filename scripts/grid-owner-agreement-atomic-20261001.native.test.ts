import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { proofSql, quote } from './customer-read-proof-native'

// Actual installed schema and guarded SQL command; every synthetic row and
// fault trigger rolls back. No GoTrue, HTTP, Storage byte or provider proof.
function fixture() {
  const company = randomUUID(), quiet = randomUUID(), actor = randomUUID(), session = randomUUID(), otherSession = randomUUID(), owner = randomUUID(), foreignOwner = randomUUID()
  const command = { operation: 'save', actorUserId: actor, sessionId: session, companyId: company, id: null,
    expectedRevision: 0, idempotencyKey: 'agreement-native-' + randomUUID(),
    payload: { gridOwnerId: owner, agreementType: 'metering_access', agreementScope: 'metering_access', status: 'draft', metadata: {}, referenceRequirements: {} } }
  const seed = `BEGIN;
    INSERT INTO public.companies(id,name,status,lifecycle_status,is_active) VALUES
      (${quote(company)},'Synthetic agreement A','active','active',true),(${quote(quiet)},'Synthetic agreement B','active','active',true);
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(actor)},'authenticated','authenticated',${quote(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(actor+'@example.invalid')},'Synthetic global agreement actor','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES
      (${quote(session)},${quote(actor)},now(),now(),clock_timestamp()+interval '1 hour'),
      (${quote(otherSession)},${quote(actor)},now(),now(),clock_timestamp()+interval '1 hour');
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(actor)},'platform_admin',true);
    INSERT INTO public.grid_owners(id,company_id,name) VALUES(${quote(owner)},${quote(company)},'Synthetic owned agreement owner'),
      (${quote(foreignOwner)},${quote(quiet)},'Synthetic quiet agreement owner');
    DO $setup$ BEGIN PERFORM set_config('gridex.agreement.proof_command',${quote(JSON.stringify(command))},true); END $setup$;`
  return { company, quiet, actor, session, otherSession, owner, foreignOwner, command, seed }
}
function run(f: ReturnType<typeof fixture>, commands: string) {
  return proofSql<{ passed: boolean }>(f.seed + commands + `
    SELECT jsonb_build_object('passed',true) AS proof_receipt; ROLLBACK;`)
}

it('actual installed writer saves/replays/archives once with current authority and second live session', () => {
  const f = fixture()
  expect(run(f, `SET LOCAL ROLE service_role;
    DO $proof$ DECLARE c jsonb:=current_setting('gridex.agreement.proof_command')::jsonb; r jsonb; s jsonb; BEGIN
      r:=public.gridex_grid_owner_agreement_command_v1(c);
      IF r->'agreement'->>'revision' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'agreement_native_create_failed'; END IF;
      s:=public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('sessionId',${quote(f.otherSession)}));
      IF s->>'replayed' IS DISTINCT FROM 'true' OR s->'agreement'->>'id' IS DISTINCT FROM r->'agreement'->>'id' THEN RAISE EXCEPTION 'agreement_native_replay_failed'; END IF;
      c:=c||jsonb_build_object('operation','archive','id',r->'agreement'->>'id','expectedRevision',1,'idempotencyKey',c->>'idempotencyKey'||'-archive','payload','{}'::jsonb);
      s:=public.gridex_grid_owner_agreement_command_v1(c);
      IF s->'agreement'->>'revision' IS DISTINCT FROM '2' OR s->'agreement'->>'status' IS DISTINCT FROM 'archived' THEN RAISE EXCEPTION 'agreement_native_archive_failed'; END IF;
      PERFORM set_config('gridex.agreement.proof_id',r->'agreement'->>'id',true);
    END $proof$;
    RESET ROLE;
    DO $facts$ BEGIN
      IF (SELECT count(*) FROM private.gridex_agreement_audit_v1 WHERE agreement_id=current_setting('gridex.agreement.proof_id')::uuid)<>2
        OR (SELECT count(*) FROM public.audit_logs WHERE entity_id=current_setting('gridex.agreement.proof_id'))<>2
        OR (SELECT count(*) FROM public.grid_owners WHERE company_id=${quote(f.quiet)})<>1
        OR EXISTS(SELECT 1 FROM public.outbound_requests WHERE company_id IN (${quote(f.company)},${quote(f.quiet)}))
        OR EXISTS(SELECT 1 FROM public.tenant_email_outbox WHERE company_id IN (${quote(f.company)},${quote(f.quiet)}))
        THEN RAISE EXCEPTION 'agreement_native_atomic_facts_failed'; END IF;
    END $facts$;`)).toEqual({ passed: true })
})

it('actual revoked/expired session and removed global role deny without optional owner creation', () => {
  const f = fixture()
  expect(run(f, `UPDATE public.admin_users SET is_active=false WHERE user_id=${quote(f.actor)};
    SET LOCAL ROLE service_role;
    DO $proof$ DECLARE c jsonb:=current_setting('gridex.agreement.proof_command')::jsonb; denied boolean:=false; BEGIN
      c:=jsonb_set(c,'{payload}',(c->'payload')||jsonb_build_object('gridOwnerId',null,'newGridOwner',jsonb_build_object('name','Must never exist')));
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(c); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_role_denial_missing'; END IF;
    END $proof$;
    RESET ROLE;
    UPDATE public.admin_users SET is_active=true WHERE user_id=${quote(f.actor)};
    UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(f.session)};
    SET LOCAL ROLE service_role;
    DO $proof$ DECLARE denied boolean:=false; BEGIN
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(current_setting('gridex.agreement.proof_command')::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_expiry_denial_missing'; END IF;
    END $proof$;
    RESET ROLE;
    DELETE FROM auth.sessions WHERE id=${quote(f.session)};
    SET LOCAL ROLE service_role;
    DO $proof$ DECLARE denied boolean:=false; BEGIN
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(current_setting('gridex.agreement.proof_command')::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_revocation_denial_missing'; END IF;
    END $proof$;
    RESET ROLE;
    DO $facts$ BEGIN IF EXISTS(SELECT 1 FROM public.grid_owner_access_agreements WHERE company_id=${quote(f.company)})
      OR (SELECT count(*) FROM public.grid_owners WHERE company_id=${quote(f.company)})<>1 THEN RAISE EXCEPTION 'agreement_native_denial_partial_write'; END IF; END $facts$;`)).toEqual({ passed: true })
})

it('actual late audit error rolls back new owner, agreement, standard audit and command receipt', () => {
  const f = fixture()
  expect(run(f, `CREATE FUNCTION private.agreement_native_fault_${f.actor.replaceAll('-','')}() RETURNS trigger LANGUAGE plpgsql AS $fault$
      BEGIN IF NEW.actor_user_id=${quote(f.actor)}::uuid THEN RAISE EXCEPTION 'owned_agreement_audit_fault'; END IF; RETURN NEW; END $fault$;
    CREATE TRIGGER agreement_native_owned_fault BEFORE INSERT ON private.gridex_agreement_audit_v1
      FOR EACH ROW EXECUTE FUNCTION private.agreement_native_fault_${f.actor.replaceAll('-','')}();
    SET LOCAL ROLE service_role;
    DO $proof$ DECLARE c jsonb:=current_setting('gridex.agreement.proof_command')::jsonb; denied boolean:=false; BEGIN
      c:=jsonb_set(c,'{payload}',(c->'payload')||jsonb_build_object('gridOwnerId',null,'newGridOwner',jsonb_build_object('name','Must roll back')));
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(c); EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='owned_agreement_audit_fault'; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_late_audit_failed'; END IF;
    END $proof$;
    RESET ROLE;
    DO $facts$ BEGIN IF (SELECT count(*) FROM public.grid_owners WHERE company_id=${quote(f.company)})<>1
      OR EXISTS(SELECT 1 FROM public.grid_owner_access_agreements WHERE company_id=${quote(f.company)})
      OR EXISTS(SELECT 1 FROM public.audit_logs WHERE actor_user_id=${quote(f.actor)} AND entity_type='grid_owner_access_agreement')
      OR EXISTS(SELECT 1 FROM private.gridex_agreement_results_v1 WHERE actor_user_id=${quote(f.actor)})
      THEN RAISE EXCEPTION 'agreement_native_late_partial_write'; END IF; END $facts$;`)).toEqual({ passed: true })
})

it('actual durable metadata intent distinguishes attached receipts from never-attached cleanup', () => {
  const f = fixture()
  expect(run(f, `SET LOCAL ROLE service_role;
    DO $proof$ DECLARE c jsonb:=current_setting('gridex.agreement.proof_command')::jsonb; p jsonb; r jsonb; a jsonb; BEGIN
      c:=jsonb_set(c,'{payload}',(c->'payload')||jsonb_build_object('documentFile',jsonb_build_object('bucket','grid-owner-agreements','name','owned.pdf','sha256',repeat('a',64))));
      p:=public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','prepare_upload'));
      c:=c||jsonb_build_object('uploadIntentId',p->'intent'->>'id','cleanupToken',p->'intent'->>'token');
      r:=public.gridex_grid_owner_agreement_command_v1(c);
      a:=public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','abort_upload'));
      IF a->'cleanup' IS DISTINCT FROM 'null'::jsonb OR a->'committed'->'agreement'->>'id' IS DISTINCT FROM r->'agreement'->>'id' THEN RAISE EXCEPTION 'agreement_native_attached_cleanup_exposed'; END IF;
      c:=jsonb_set(c-'uploadIntentId'-'cleanupToken','{idempotencyKey}',to_jsonb((c->>'idempotencyKey')||'-orphan'));
      c:=jsonb_set(c,'{payload,gridOwnerId}',to_jsonb(${quote(f.foreignOwner)}::text));
      p:=public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','prepare_upload'));
      c:=c||jsonb_build_object('uploadIntentId',p->'intent'->>'id','cleanupToken',p->'intent'->>'token');
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(c); EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
      a:=public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','abort_upload'));
      IF a->'committed' IS DISTINCT FROM 'null'::jsonb OR a->'cleanup'->>'path' IS DISTINCT FROM p->'intent'->>'path' THEN RAISE EXCEPTION 'agreement_native_orphan_binding_failed'; END IF;
      IF public.gridex_grid_owner_agreement_command_v1(c||jsonb_build_object('operation','cleanup_complete'))->>'cleaned' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'agreement_native_cleanup_receipt_failed'; END IF;
    END $proof$;`)).toEqual({ passed: true })
})

it('actual service cannot directly write the provisioned table and unprivileged roles cannot invoke the command', () => {
  const f = fixture()
  expect(run(f, `SET LOCAL ROLE service_role;
    DO $proof$ DECLARE denied boolean:=false; BEGIN
      BEGIN UPDATE public.grid_owner_access_agreements SET status='active' WHERE company_id=${quote(f.company)}; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_service_dml_exposed'; END IF;
    END $proof$;
    RESET ROLE; SET LOCAL ROLE anon;
    DO $proof$ DECLARE denied boolean:=false; BEGIN
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(current_setting('gridex.agreement.proof_command')::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_anon_execute_exposed'; END IF;
    END $proof$;
    RESET ROLE; SET LOCAL ROLE authenticated;
    DO $proof$ DECLARE denied boolean:=false; BEGIN
      BEGIN PERFORM public.gridex_grid_owner_agreement_command_v1(current_setting('gridex.agreement.proof_command')::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION 'agreement_native_authenticated_execute_exposed'; END IF;
    END $proof$;`)).toEqual({ passed: true })
})
