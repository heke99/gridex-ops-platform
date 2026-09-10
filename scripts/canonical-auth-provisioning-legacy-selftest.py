#!/usr/bin/env python3
"""Isolated whole-source legacy proof; selection-only never claims SQL acceptance."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load_batch():
    path = ROOT / 'scripts/canonical-auth-provisioning-legacy-batch.py'
    assert path.is_file(), 'strict whole-source executor is required'
    spec = importlib.util.spec_from_file_location('legacy_batch', path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = result
    spec.loader.exec_module(result)
    return result


def constructor_checks():
    assert callable(globals().get('run_rollback_error')), 'expected-error sources require rollback on unexpected success'
    assert callable(globals().get('require_native_setup')), 'source-native failure requires a setup stage guard'
    require_native_setup('LEGACY_NATIVE_SETUP_COMPLETED_A\n','A')
    require_native_setup('LEGACY_NATIVE_SETUP_COMPLETED_H\n','H')
    require_native_setup('LEGACY_NATIVE_SETUP_COMPLETED_I\n','I')
    for source in ('A','H','I'):
        for output in ('', '23505\n', 'ERROR: 23505: fixture setup failed\n',
                       'LEGACY_NATIVE_SETUP_COMPLETED_'+('H' if source=='A' else 'A')+'\n',
                       ('LEGACY_NATIVE_SETUP_COMPLETED_'+source+'\n')*2,
                       'LEGACY_NATIVE_SETUP_COMPLETED_'+source+'_PARTIAL\n',
                       "SELECT 'LEGACY_NATIVE_SETUP_COMPLETED_"+source+"';\n",
                       'DETAIL: LEGACY_NATIVE_SETUP_COMPLETED_'+source+'\n',
                       'CONTEXT: LEGACY_NATIVE_SETUP_COMPLETED_'+source+'\n',
                       'ERROR: 23505: setup failure\nSTATEMENT: LEGACY_NATIVE_SETUP_COMPLETED_'+source+'\n'):
            try:
                require_native_setup(output,source)
            except AssertionError:
                pass
            else:
                raise AssertionError('setup failure accepted as a source-native error')
    b = load_batch()
    assert callable(getattr(b,'validate_admission',None)), 'admission must serialize before relation/catalog reads'
    admission=(b.SUPPORT/'canonical-auth-provisioning-legacy-admission.sql').read_text()
    mutex='SELECT pg_catalog.pg_advisory_xact_lock(20260910, 140053);'
    b.validate_admission(admission)
    # Missing, session-scoped, moved-after-locks, or pre-lock catalog access must
    # fail construction before any source is submitted to PostgreSQL.
    for bad in (admission.replace(mutex,''),
                admission.replace('pg_advisory_xact_lock','pg_advisory_lock'),
                admission.replace(mutex,'').replace('-- LEGACY_CATALOG_CAPTURE',mutex+'\n-- LEGACY_CATALOG_CAPTURE'),
                admission.replace(mutex,"SELECT pg_get_constraintdef(oid) FROM pg_constraint;\n"+mutex),
                admission.replace(mutex,mutex.replace('140053','140054'))):
        try:
            b.validate_admission(bad)
        except b.BoundaryError:
            pass
        else:
            raise AssertionError('unsafe admission mutex order/lifetime/key accepted')
    paths = b.reviewed_paths()
    sources = b.validate_sources(paths)
    assert len(sources) == 9 and ''.join(x.alias for x in sources) == 'ABCDEFHIQ'
    assert sum(len(x.data.splitlines()) for x in sources[:-1]) == 1644
    for source in sources:
        for changed in (source.data[:-1],source.data+b'\n-- altered input\n'):
            try:
                b.verify_bytes(changed,source.sha256)
            except b.BoundaryError:
                pass
            else:
                raise AssertionError('modified or truncated whole source accepted')
    for bad in (paths[:-1], paths[::-1], paths + paths[-1:], paths[1:] + paths[:1]):
        try:
            b.validate_sources(bad)
        except b.BoundaryError:
            pass
        else:
            raise AssertionError('partial, reordered or duplicate source group accepted')
    for bad in ('BEGIN; SELECT 1; COMMIT;', '\\connect production', 'SELECT 1;\nROLLBACK;', 'DO $$ BEGIN COMMIT; END $$;', "DO $$ BEGIN EXECUTE 'COMMIT'; END $$;"):
        try:
            b.check_support(bad)
        except b.BoundaryError:
            pass
        else:
            raise AssertionError('transaction or psql escape accepted')
    b.check_support('DO $$ BEGIN IF true THEN NULL; END IF; END $$;')
    for value in ('production', 'postgres', 'postgresql://localhost/production'):
        try:
            b.validate_database(value)
        except b.BoundaryError:
            pass
        else:
            raise AssertionError('unowned database accepted')
    for state in ('23505', 'P0001', 'XX000'):
        raw = f'ERROR:  {state}: PRIVATE_SYNTHETIC_SENTINEL\nDETAIL: PRIVATE_SYNTHETIC_SENTINEL\nCONTEXT: PRIVATE_SYNTHETIC_SENTINEL'
        receipt = b.safe_receipt(raw, 3, 'native')
        assert receipt['sqlstate'] == state and 'PRIVATE_SYNTHETIC_SENTINEL' not in str(receipt)
    assert len(b.verified_prefix()) == 43
    oracles=b.ddl_oracles(sources)
    assert oracles.count('CREATE TEMP TABLE legacy_column_oracle_')==88
    assert oracles.count('CREATE TEMP TABLE legacy_index_oracle_')==11
    assert oracles.count('CREATE TEMP TABLE legacy_check_oracle_')==6
    b.check_support(oracles)
    # Construct exactly the same private-file envelope without claiming a live
    # handle or executing SQL. The only stub is the infrastructure settings read.
    import tempfile,json,hashlib
    with tempfile.TemporaryDirectory(prefix='legacy-constructor-') as directory:
        h=b.OwnedPostgres();h.active=True;h.reference=({},None)
        h.directory=type('PrivateDirectory',(),{'name':directory})()
        h.verify_logging=lambda:None
        files=b.envelope_files(h,paths)
        whole=[p for p in files if p.name.startswith('whole-')]
        assert [p.read_bytes() for p in whole]==[x.data for x in sources]
        assert files[0].name=='envelope-context.sql' and files[1].name=='envelope-admission.sql'
        assert files[-2].name=='whole-Q.sql' and files[-1].name=='envelope-assertions.sql'
        assert h.command('gridex_auth_legacy_prefix',files).count('--single-transaction')==1
        assert h.command('gridex_auth_legacy_prefix',files).count('-f')==len(files)
        for p in files: assert p.stat().st_mode & 0o777 == 0o600
        for p in files:
            if not p.name.startswith('whole-'): b.check_support(p.read_text())
        # Exercise the real private subprocess stdout/stderr split without a DB.
        # A setup23505 may carry the marker in stderr; it must still fail the
        # stage guard. A post-marker23505 has the trusted marker in stdout.
        import contextlib,io
        real_command=h.command
        for source in ('A','H','I'):
            marker='LEGACY_NATIVE_SETUP_COMPLETED_'+source+'\n'
            source_bytes=next(s.data for s in sources if s.alias==source)
            inputs=[h.private('stage-control-setup.sql',"SELECT '"+marker.strip()+"';"),h.private('stage-control-whole.sql',source_bytes)]
            for setup_completed,exit_code in ((False,3),(True,3),(True,0)):
                stdout=marker if setup_completed else ''
                stderr=('ERROR:  23505: synthetic native failure\nDETAIL: synthetic detail\n'+marker) if exit_code else ''
                code='import sys; sys.stdout.write('+repr(stdout)+'); sys.stderr.write('+repr(stderr)+'); sys.exit('+str(exit_code)+')'
                def command(database,submitted,transaction=True):
                    assert submitted[:-1]==inputs and submitted[-1].read_bytes()==b'ROLLBACK;\n'
                    assert submitted[1].read_bytes()==source_bytes
                    assert len(inputs)==2
                    argv=real_command(database,submitted,transaction)
                    assert transaction and argv.count('--single-transaction')==1
                    assert argv[-2:]==['-f','/legacy-private/'+submitted[-1].name]
                    return [sys.executable,'-c',code]
                h.command=command
                public=io.StringIO()
                with contextlib.redirect_stdout(public):
                    try:
                        captured_stdout=run_rollback_error(h,'gridex_auth_legacy_native',inputs,'native_stage_control','23505')
                    except b.BoundaryError:
                        assert exit_code==0, 'expected failure was rejected unexpectedly'
                    else:
                        assert exit_code==3, 'unexpected source success was accepted'
                assert marker.strip() not in public.getvalue()
                if exit_code==0: continue
                if setup_completed:
                    require_native_setup(captured_stdout,source)
                else:
                    try:
                        require_native_setup(captured_stdout,source)
                    except AssertionError:
                        pass
                    else:
                        raise AssertionError('stderr setup marker accepted as source-stage evidence')
    workflow=(ROOT/'.github/workflows/ops-hardening.yml').read_text()
    assert 'auth-provisioning-legacy-skeleton:' not in workflow
    job=workflow.split('  auth-provisioning-legacy-proof:',1)[1].split('\n  verify:',1)[0]
    assert 'timeout-minutes: 20' in job and '\n    needs:' not in job
    assert 'if: always()' in job and '--cleanup-owned' in job
    assert 'upload-artifact' not in job and 'services:' not in job and 'docker logs' not in job
    import ast
    runner=ast.parse((ROOT/'scripts/canonical-auth-membership-group.py').read_text())
    commands=next(ast.literal_eval(n.value) for n in runner.body if isinstance(n,ast.Assign) and any(getattr(t,'id','')=='COMMANDS' for t in n.targets))
    assert len(commands)==17 and commands[16]==('python3','scripts/canonical-auth-provisioning-legacy-selftest.py')
    assert hashlib.sha256(json.dumps(commands[:16],separators=(',',':')).encode()).hexdigest()=='cb21bcc0056da45b1d91c1312f107e322330744f645fdb4123fa278825f6b1bb'
    replay=load_replay()
    replay_constructor_checks(b,replay)
    print('PASS legacy constructor bytes/order/context/target/logging negative controls; SQL acceptance not executed')


# All fixture identities are synthetic and confined to the owned container.
U = '71000000-0000-0000-0000-000000000001'
U2 = '71000000-0000-0000-0000-000000000002'
C = '72000000-0000-0000-0000-000000000001'
C2 = '72000000-0000-0000-0000-000000000002'
SENTINEL = 'GRIDEX_SYNTHETIC_PRIVATE_SENTINEL_20260910'


def check(condition):
    return "DO $$ BEGIN IF ("+condition+") IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF; END $$;"


def seed_parents():
    return f"""INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at)
VALUES ('{U}','legacy-one@example.invalid','{{"fixture":"synthetic"}}','{{}}','2026-01-01'),
('{U2}','legacy-two@example.invalid','{{}}','{{}}','2026-01-01');
INSERT INTO companies(id,name,slug,status) VALUES ('{C}','Legacy fixture one','legacy-fixture-one','active'),('{C2}','Legacy fixture two','legacy-fixture-two','active');"""


def clone(h,database):
    h.reset(database)
    h.docker(['exec',h.name,'dropdb','-U','postgres',database])
    h.docker(['exec',h.name,'createdb','-U','postgres','-T','gridex_auth_legacy_template',database])


def snapshot(h,database):
    # Actual full rows, not count/hash substitutes; data never enters receipts.
    sql="""CREATE TEMP TABLE legacy_test_rows(name text,row_value jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p') LOOP
EXECUTE format('INSERT INTO legacy_test_rows SELECT %L,to_jsonb(x) FROM %I.%I x',r.nspname||'.'||r.relname,r.nspname,r.relname); END LOOP; END $$;
SELECT coalesce(jsonb_agg(jsonb_build_array(name,row_value) ORDER BY name,row_value),'[]') FROM legacy_test_rows;"""
    import json
    return h.catalog(database),json.loads(h.sql(database,sql,'snapshot'))


def unchanged(h,database,before):
    assert snapshot(h,database)==before, 'rollback did not preserve complete rows/catalog'


def rollback_only_files(h,files):
    """Expected-error fixtures must also roll back when every input succeeds.

    ON_ERROR_STOP aborts on an error; this final file handles the success path
    before psql's single-transaction COMMIT. Whole-source bytes stay untouched.
    This test-only wrapper is never used by the admitted batch executor.
    """
    return [*files,h.private('expected-error-rollback.sql','ROLLBACK;\n')]


def run_rollback_error(h,database,files,label,state):
    assert state!='00000', 'rollback-error fixture requires a failing SQLSTATE'
    return h.run_files(database,rollback_only_files(h,files),label,expect=state)


def expected_batch_error(b,h,database,state,label,files=None):
    before=snapshot(h,database)
    run_rollback_error(h,database,files or b.envelope_files(h,b.reviewed_paths()),label,state)
    unchanged(h,database,before)


def actual_and_seeded(b,h):
    import json
    database='gridex_auth_legacy_prefix'
    # A second actual first43, not a reduced hand-authored table fixture.
    h.prefix(database)
    b.execute(h,database,b.reviewed_paths())
    first=snapshot(h,database)
    b.execute(h,database,b.reviewed_paths())
    assert snapshot(h,database)==first, 'whole repeat changed role rows or catalog'
    database='gridex_auth_legacy_seeded'; clone(h,database)
    h.sql(database,seed_parents()+"""
UPDATE roles SET name='Synthetic custom preserved name',description=NULL,is_active=false,is_system_role=false,scope='platform',updated_at='2026-01-02' WHERE key='company_admin';
INSERT INTO roles(key,name,description,scope,is_active,is_system_role,created_at,updated_at)
VALUES ('synthetic_custom','Synthetic arbitrary role',NULL,'platform',false,false,'2026-01-01','2026-01-02');
INSERT INTO auth_provisioning_events(user_id,company_id,email,event_type,status,details)
VALUES (NULL,NULL,'retained@example.invalid','synthetic','success','{}');
""",'seeded_setup')
    b.execute(h,database,b.reviewed_paths())
    after=snapshot(h,database)
    b.execute(h,database,b.reviewed_paths())
    assert snapshot(h,database)==after
    print('PASS actual-first43 seeded-arbitrary-role-preimages full-repeat')


def dirty_rows(b,h):
    database='gridex_auth_legacy_dirty'
    cases={
      'profile_inactive':f"INSERT INTO user_profiles(id,email,user_status) VALUES ('{U}','inactive@example.invalid','disabled');",
      'profile_unknown_null':f"ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_user_status_check; INSERT INTO user_profiles(id,email,user_status) VALUES ('{U}','unknown@example.invalid','synthetic_unknown');",
      'membership_revoked':f"INSERT INTO company_memberships(company_id,user_id,status,membership_role) VALUES ('{C}','{U}','revoked','member');",
      'invitation_expired_issued':f"INSERT INTO company_invitations(company_id,email,status,metadata,expires_at) VALUES ('{C}','expired@example.invalid','pending','{{\"temporary_password_issued_at\":\"2025-01-01\"}}','2025-01-01');",
      'invitation_sending':f"ALTER TABLE company_invitations DROP CONSTRAINT company_invitations_status_check; INSERT INTO company_invitations(company_id,email,status) VALUES ('{C}','sending@example.invalid','sending'),('{C}','uncertain@example.invalid','delivery_uncertain');",
      # The earlier callback source's required action survives the later CREATE IF NOT EXISTS.
      'event_completed':f"ALTER TABLE auth_email_events DROP CONSTRAINT auth_email_events_status_check; INSERT INTO auth_email_events(user_id,company_id,email,action,event_type,status) VALUES ('{U}','{C}','event@example.invalid','invite_sent','invite_sent','completed');",
      'event_unknown':"ALTER TABLE auth_email_events DROP CONSTRAINT IF EXISTS auth_email_events_event_type_check; ALTER TABLE auth_email_events DROP CONSTRAINT IF EXISTS auth_email_events_status_check; INSERT INTO auth_email_events(email,action,event_type,status) VALUES ('unknown@example.invalid','invite_sent','synthetic_unknown','synthetic_unknown');",
      'role_orphan_alias':f"INSERT INTO user_roles(user_id,company_id,role,status,is_active) VALUES ('{U}','{C}','admin','active',true);",
      'role_multitenant_tie':"INSERT INTO roles(key,name) VALUES ('operations_agent','Synthetic operations role');"+f"INSERT INTO user_roles(user_id,company_id,role_id,created_at) SELECT '{U}',c.id,r.id,'2026-01-01' FROM companies c CROSS JOIN roles r WHERE c.id IN ('{C}','{C2}') AND r.key IN ('company_admin','operations_agent');"+check('(SELECT count(*)=4 AND count(DISTINCT company_id)=2 AND count(DISTINCT role_id)=2 FROM user_roles)'),
      'flexible_action':f"INSERT INTO user_profiles(id,email,last_auth_email_action) VALUES ('{U}','action@example.invalid','vendor:custom.action');",
      'role_null_activity':f"ALTER TABLE user_roles ALTER COLUMN status DROP NOT NULL; ALTER TABLE user_roles ALTER COLUMN is_active DROP NOT NULL; INSERT INTO user_roles(user_id,company_id,status,is_active) VALUES ('{U}',NULL,NULL,NULL);",
      'membership_null_orphan':"ALTER TABLE company_memberships ALTER COLUMN company_id DROP NOT NULL; ALTER TABLE company_memberships ALTER COLUMN user_id DROP NOT NULL; INSERT INTO company_memberships(company_id,user_id,status) VALUES (NULL,NULL,'active');",
    }
    # Catalog relaxations above are explicit reduced dirty-data setups. They are
    # rejected by the same five-empty-target check before any original runs.
    for label,setup in cases.items():
        clone(h,database); h.sql(database,seed_parents()+setup,label+'_setup')
        expected_batch_error(b,h,database,'55000',label)
    clone(h,database)
    mixed=cases['profile_inactive']+cases['membership_revoked']+cases['invitation_expired_issued']+cases['role_orphan_alias']
    h.sql(database,seed_parents()+mixed,'mixed_setup')
    expected_batch_error(b,h,database,'55000','mixed')
    clone(h,database)
    h.sql(database,"INSERT INTO roles(key,name) VALUES(NULL,'company_admin');",'ambiguous_setup')
    expected_batch_error(b,h,database,'55000','role_alias_ambiguity')
    print('PASS dirty-five-targets aliases ties mixed states rejected before A')


def dirty_catalog(b,h):
    database='gridex_auth_legacy_dirty'
    cases={
      'missing_table':('DROP TABLE auth_email_events CASCADE;','42P01'),
      'missing_column':('ALTER TABLE company_memberships DROP COLUMN invited_email CASCADE;','42703'),
      'bad_type':('ALTER TABLE company_memberships ALTER COLUMN status_reason TYPE varchar(200);','42804'),
      'wrong_index':('DROP INDEX company_invitations_company_status_idx; CREATE INDEX company_invitations_company_status_idx ON company_invitations(status,company_id);','42804'),
      'wrong_check':("ALTER TABLE company_memberships DROP CONSTRAINT company_memberships_status_check; ALTER TABLE company_memberships ADD CONSTRAINT company_memberships_status_check CHECK(status IS NOT NULL);",'42804'),
      'wrong_fk':('ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_active_company_id_fkey; ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_active_company_id_fkey FOREIGN KEY(active_company_id) REFERENCES companies(id) ON DELETE CASCADE;','42804'),
      'extra_rule':('CREATE RULE legacy_unexpected_rule AS ON UPDATE TO roles DO ALSO SELECT 1;','P0004'),
      'extra_trigger':("CREATE FUNCTION public.legacy_unexpected_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '"+SENTINEL+"'; RETURN NEW; END $$; CREATE TRIGGER legacy_unexpected BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION public.legacy_unexpected_trigger();",'P0004'),
      'role_timestamp_trigger':("CREATE FUNCTION public.legacy_timestamp_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END $$; CREATE TRIGGER legacy_timestamp BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION public.legacy_timestamp_trigger();",'P0004'),
      'client_grant':('GRANT SELECT ON auth_provisioning_events TO authenticated;','42804'),
      'column_grant':('GRANT SELECT(email) ON auth_provisioning_events TO anon;','42804'),
    }
    for label,(setup,state) in cases.items():
        clone(h,database); h.sql(database,setup,label+'_setup')
        expected_batch_error(b,h,database,state,label)
    print('PASS dirty-catalog trigger-rule definitions FK index CHECK type ACL rejection')


def require_native_setup(stdout,source):
    """Accept only the exact trusted psql stdout receipt after completed setup.

    Callers pass run_files' stdout return, never its private stderr/error file.
    SQLSTATE validation remains in run_files; it cannot replace this stage proof.
    """
    assert source in ('A','H','I'), 'unexpected native-source stage'
    markers=[line for line in stdout.splitlines() if line.startswith('LEGACY_NATIVE_SETUP_COMPLETED_')]
    assert markers==['LEGACY_NATIVE_SETUP_COMPLETED_'+source], 'source-native setup stage not completed'


def native_cases(b,h):
    database='gridex_auth_legacy_native'; clone(h,database)
    h.sql(database,seed_parents(),'native_parents')
    cases={
      'native_fk':(f"INSERT INTO user_profiles(id,active_company_id) VALUES ('{U}','72999999-0000-0000-0000-000000000099');",'23503'),
      'native_unique_key':("INSERT INTO roles(key,name) SELECT key,name FROM roles WHERE key='company_admin';",'23505'),
      'native_notnull':('INSERT INTO roles(key,name) VALUES (NULL,NULL);','23502'),
      'native_check':(f"INSERT INTO company_invitations(company_id,email,status) VALUES ('{C}','native@example.invalid','synthetic_invalid');",'23514'),
    }
    for label,(sql,state) in cases.items():
        before=snapshot(h,database)
        h.sql(database,sql,label,expect=state)
        unchanged(h,database,before)
    # Native whole-source pair-index failure, under rollback; not admission.
    source=b.validate_sources(b.reviewed_paths())[0]
    before=snapshot(h,database)
    setup=f"""-- Explicitly reduced rollback fixture: remove all three first43 pair guards.
ALTER TABLE company_memberships DROP CONSTRAINT company_memberships_company_id_user_id_key;
DROP INDEX ux_company_memberships_company_user;
DROP INDEX company_memberships_company_user_uidx;
INSERT INTO company_memberships(company_id,user_id) VALUES ('{C}','{U}'),('{C}','{U}');
"""+check('(SELECT count(*)=2 FROM company_memberships)')+"\nSELECT 'LEGACY_NATIVE_SETUP_COMPLETED_A';"
    files=[h.private('native-pair-setup.sql',setup),h.private('native-pair-whole.sql',source.data)]
    stdout=run_rollback_error(h,database,files,'native_full_A_pair','23505')
    require_native_setup(stdout,'A')
    unchanged(h,database,before)
    clone(h,database); h.sql(database,seed_parents(), 'triple_parents')
    before=snapshot(h,database)
    setup=f"INSERT INTO user_roles(user_id,company_id,role_id) SELECT '{U}','{C}',id FROM roles WHERE key='company_admin'; INSERT INTO user_roles(user_id,company_id,role_id) SELECT user_id,company_id,role_id FROM user_roles;"
    setup+=check('(SELECT count(*)=2 FROM user_roles)')+"\nSELECT 'LEGACY_NATIVE_SETUP_COMPLETED_H';"
    source=b.validate_sources(b.reviewed_paths())[6]
    stdout=run_rollback_error(h,database,[h.private('native-triple-setup.sql',setup),h.private('native-triple-whole.sql',source.data)],'native_full_H_triple','23505')
    require_native_setup(stdout,'H')
    unchanged(h,database,before)
    print('PASS native SQLSTATE FK unique notnull CHECK full-A-pair full-H-triple rollback')


def reduced_characterization(b,h):
    # A/B/C losses reuse executed AUTH_INVITATION_CHAIN_REVIEW/INVITATION_REPLAY_EFFECTS.
    sources={s.alias:s for s in b.validate_sources(b.reviewed_paths())}
    database='gridex_auth_legacy_native'
    for alias in ('D','E','F','H'):
        clone(h,database)
        setup="UPDATE roles SET name='Synthetic custom preserved',is_active=false,description=NULL WHERE key='company_admin';"
        expectation=("(SELECT name='company_admin' FROM roles WHERE key='company_admin')" if alias in ('D','F') else "(SELECT name='Synthetic custom preserved' FROM roles WHERE key='company_admin')")
        if alias=='F': expectation+=" AND (SELECT is_active FROM roles WHERE key='company_admin')"
        files=[h.private('char-setup.sql',setup),h.private('char-whole.sql',sources[alias].data),
               h.private('char-assert.sql',check(expectation)+'\nROLLBACK;')]
        before=snapshot(h,database)
        h.run_files(database,files,'reduced_'+alias)
        unchanged(h,database,before)
    for alias in ('E','I'):
        clone(h,database)
        setup=seed_parents()+f"INSERT INTO company_memberships(company_id,user_id,membership_role,role_key,status) VALUES ('{C}','{U}','member',NULL,'active');"
        h.sql(database,setup,'default_admin_candidate')
        expected_batch_error(b,h,database,'55000','reject_'+alias+'_candidate')
        before=snapshot(h,database)
        files=[h.private('char-whole.sql',sources[alias].data),h.private('char-assert.sql',check("EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.key='company_admin')")+'\nROLLBACK;')]
        h.run_files(database,files,'reduced_'+alias+'_default_admin'); unchanged(h,database,before)
    clone(h,database)
    # operations_agent is absent from the literal first43; seed it explicitly.
    # Pin both ordering timestamps so this is a real tie for both H and I.
    eligible=check("""(SELECT count(*)=2 AND count(DISTINCT (ur.company_id,ur.user_id))=1
AND min(ur.created_at)=max(ur.created_at) AND min(ur.updated_at)=max(ur.updated_at)
AND array_agg(coalesce(r.key,r.name) ORDER BY coalesce(r.key,r.name))=ARRAY['company_admin','operations_agent']
FROM user_roles ur LEFT JOIN roles r ON r.id=ur.role_id
WHERE ur.company_id IS NOT NULL AND ur.user_id IS NOT NULL
AND coalesce(ur.status,'active')='active' AND coalesce(ur.is_active,true)=true
AND NOT EXISTS(SELECT 1 FROM company_memberships cm WHERE cm.company_id=ur.company_id AND cm.user_id=ur.user_id))
AND (SELECT count(*)=0 FROM company_memberships)""")
    h.sql(database,seed_parents()+"INSERT INTO roles(key,name) VALUES ('operations_agent','Synthetic operations role');"+f"INSERT INTO user_roles(user_id,company_id,role_id,created_at,updated_at) SELECT '{U}','{C}',id,'2026-01-01','2026-01-01' FROM roles WHERE key IN ('company_admin','operations_agent');"+eligible,'tie_candidates')
    expected_batch_error(b,h,database,'55000','reject_H_I_tie')
    before=snapshot(h,database)
    # I's plain INSERT, unlike H DISTINCT ON, sees both role candidates against
    # the same empty membership snapshot and hits pair uniqueness.
    files=[h.private('char-I-stage.sql',eligible+"\nSELECT 'LEGACY_NATIVE_SETUP_COMPLETED_I';"),h.private('char-I-whole.sql',sources['I'].data)]
    stdout=run_rollback_error(h,database,files,'reduced_I_pair','23505')
    require_native_setup(stdout,'I')
    unchanged(h,database,before)
    h.run_files(database,[h.private('char-H-whole.sql',sources['H'].data),h.private('char-H-assert.sql',check("(SELECT count(*)=1 FROM company_memberships) AND (SELECT role_key IN ('company_admin','operations_agent') FROM company_memberships)")+'\nROLLBACK;')],'reduced_H_tie')
    unchanged(h,database,before)
    clone(h,database)
    setup=seed_parents()+f"ALTER TABLE user_roles ALTER COLUMN status DROP NOT NULL; ALTER TABLE user_roles ALTER COLUMN is_active DROP NOT NULL; INSERT INTO user_roles(user_id,status,is_active) VALUES ('{U}',NULL,NULL);"
    h.sql(database,setup,'null_activity_candidate');expected_batch_error(b,h,database,'55000','reject_null_activity')
    before=snapshot(h,database)
    h.run_files(database,[h.private('char-null-I.sql',sources['I'].data),h.private('char-null-assert.sql',check('(SELECT status=\'active\' AND is_active FROM user_roles)')+'\nROLLBACK;')],'reduced_I_null_activation')
    unchanged(h,database,before)
    print('PASS reduced D E F H I full-byte overwrite default-admin tie NULL characterization rolled back')


def unexpected_success_rollback(b,h):
    """Exercise the footer in PostgreSQL when a whole source really succeeds."""
    import contextlib,io,json
    database='gridex_auth_legacy_native'; clone(h,database)
    # The same valid default-admin preimage already characterized above. Setup
    # is outside the exception handler, and the committed preimage is independent.
    setup=seed_parents()+f"INSERT INTO company_memberships(company_id,user_id,membership_role,role_key,status) VALUES ('{C}','{U}','member',NULL,'active');"
    h.sql(database,setup+check('(SELECT count(*)=0 FROM user_roles)'),'rollback_success_setup')
    before=snapshot(h,database)
    source=next(s for s in b.validate_sources(b.reviewed_paths()) if s.alias=='I')
    # Prove a real row effect before the footer: removing that footer must make
    # the later independent committed-row comparison fail.
    changed=check(f"""(SELECT count(*)=1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
WHERE ur.user_id='{U}' AND ur.company_id='{C}' AND r.key='company_admin'
AND ur.status='active' AND ur.is_active)""")
    files=[h.private('success-control-whole-I.sql',source.data),h.private('success-control-effect.sql',changed)]
    public=io.StringIO()
    with contextlib.redirect_stdout(public):
        try:
            run_rollback_error(h,database,files,'unexpected_success_rollback','23505')
        except b.BoundaryError as error:
            if str(error)!='UNEXPECTED_SQL_RESULT': raise
        else:
            raise AssertionError('unexpected source success was accepted')
    # The same BoundaryError can also signal a different SQL error. Require the
    # actual successful subprocess receipt, never merely the exception class.
    receipt=json.loads(public.getvalue())
    assert receipt['stage']=='unexpected_success_rollback'
    assert receipt['sqlstate']=='00000' and receipt['exit_code']==0 and receipt['category']=='OK'
    print(json.dumps(receipt,sort_keys=True),flush=True)
    unchanged(h,database,before)
    print('PASS whole-I unexpected success rejected after footer restores committed rows/catalog')


def private_query(h,database,sql):
    return h.docker(['exec',h.name,'psql','-X','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1','-c',sql]).decode().strip()


def spawn(h,database,files,label):
    import subprocess
    path=h.private('process-'+label+'.out',b'')
    stream=open(path,'wb')
    command=h.command(database,files)
    # Fixed synthetic app name supports observable wait/termination assertions.
    command[2:2]=['-e','PGAPPNAME=legacy_'+label]
    process=subprocess.Popen(command,stdout=stream,stderr=stream,env=load_batch().clean_environment())
    stream.close(); h.processes.append(process)
    return process,path


def wait_observed(h,database,condition,seconds=8):
    import time
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if private_query(h,database,'SELECT ('+condition+')::int')=='1': return
        time.sleep(0.05)
    raise AssertionError('real concurrent condition not observed within bound')


def process_result(b,process,path,label,state='00000',timeout=90):
    import json
    process.wait(timeout=timeout)
    receipt=b.safe_receipt(path.read_text(),process.returncode,label)
    print(json.dumps(receipt,sort_keys=True),flush=True)
    assert receipt['sqlstate']==state and (state=='00000')==(process.returncode==0)


def atomic_cases(b,h):
    database='gridex_auth_legacy_atomic'
    for stage in ('A','C','F','Q'):
        clone(h,database)
        files=b.envelope_files(h,b.reviewed_paths())
        needle='whole-Q.sql' if stage=='Q' else 'stage-'+stage+'.sql'
        index=next(i for i,p in enumerate(files) if p.name==needle)+1
        files.insert(index,h.private('injected-'+stage+'.sql',"DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"'; END $$;"))
        expected_batch_error(b,h,database,'XX000','rollback_after_'+stage,files)
    clone(h,database)
    files=b.envelope_files(h,b.reviewed_paths())
    index=next(i for i,p in enumerate(files) if p.name=='whole-Q.sql')
    files.insert(index,h.private('injected-inside-Q.sql',"CREATE FUNCTION pg_temp.legacy_q_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"'; END $$; CREATE TRIGGER legacy_q_failure BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION pg_temp.legacy_q_failure();"))
    expected_batch_error(b,h,database,'XX000','rollback_inside_Q',files)
    clone(h,database)
    expected_batch_error(b,h,database,'P0002','Q_alone',[h.private('standalone-Q.sql',b.validate_sources(b.reviewed_paths())[-1].data)])
    for label in ('wrong_stage','stale_preflight'):
        files=b.envelope_files(h,b.reviewed_paths())
        index=next(i for i,p in enumerate(files) if p.name=='whole-Q.sql')
        sql="UPDATE pg_temp.legacy_context SET "+("stage='F';" if label=='wrong_stage' else 'txid=txid_current()-1;')
        files.insert(index,h.private('injected-context.sql',sql))
        expected_batch_error(b,h,database,'P0002',label,files)
    # Real backend death after F, while its transaction is still open.
    clone(h,database); before=snapshot(h,database)
    files=b.envelope_files(h,b.reviewed_paths()); i=next(i for i,p in enumerate(files) if p.name=='stage-F.sql')+1
    files.insert(i,h.private('death-wait.sql','SELECT pg_sleep(30);'))
    process,path=spawn(h,database,rollback_only_files(h,files),'connection_death')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_connection_death' AND wait_event='PgSleep')")
    private_query(h,database,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='legacy_connection_death'")
    process_result(b,process,path,'connection_death','57P01')
    unchanged(h,database,before)
    print('PASS after-A-C-F-Q inside-Q standalone-context backend-death atomic rollback')


def concurrency(b,h):
    database='gridex_auth_legacy_lock'; clone(h,database)
    before=snapshot(h,database)
    holder,path=spawn(h,database,[h.private('lock-holder.sql','LOCK TABLE public.company_memberships IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(30);')],'lock_holder')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_lock_holder' AND wait_event='PgSleep')")
    contender,cpath=spawn(h,database,rollback_only_files(h,b.envelope_files(h,b.reviewed_paths())),'lock_contender')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_lock_contender' AND wait_event_type='Lock')")
    process_result(b,contender,cpath,'lock_timeout','55P03')
    private_query(h,database,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='legacy_lock_holder'")
    process_result(b,holder,path,'lock_holder','57P01')
    unchanged(h,database,before)
    # Fresh READ COMMITTED admission must see a row committed while it waits.
    clone(h,database); h.sql(database,seed_parents(),'stale_parents')
    holder,path=spawn(h,database,[h.private('stale-holder.sql',f"LOCK TABLE public.company_memberships IN ACCESS EXCLUSIVE MODE; INSERT INTO company_memberships(company_id,user_id) VALUES ('{C}','{U}'); SELECT pg_sleep(2);")],'stale_holder')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_stale_holder' AND wait_event='PgSleep')")
    contender,cpath=spawn(h,database,rollback_only_files(h,b.envelope_files(h,b.reviewed_paths())),'stale_contender')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_stale_contender' AND wait_event_type='Lock')")
    process_result(b,holder,path,'stale_holder'); process_result(b,contender,cpath,'stale_contender','55000')
    h.sql(database,check('(SELECT count(*)=1 FROM company_memberships)'),'fresh_row_retained')
    # Two complete contenders serialize. The second's preimage sees the first's
    # committed seed IDs, so it cannot insert duplicate role keys.
    clone(h,database)
    files=b.envelope_files(h,b.reviewed_paths()); files.insert(2,h.private('serialize-delay.sql','SELECT pg_sleep(2);'))
    first,path=spawn(h,database,files,'serialize_first')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_serialize_first' AND wait_event='PgSleep')")
    second,spath=spawn(h,database,b.envelope_files(h,b.reviewed_paths()),'serialize_second')
    # Observe the exact transaction mutex dependency, not an arbitrary Lock
    # wait. The waiting contender must own no target relation lock that could
    # block first's later FK lock upgrades or catalog deparsing.
    wait_observed(h,database,"""EXISTS (
SELECT 1 FROM pg_stat_activity first JOIN pg_stat_activity second
 ON first.application_name='legacy_serialize_first' AND second.application_name='legacy_serialize_second'
JOIN pg_locks held ON held.pid=first.pid
JOIN pg_locks waiting ON waiting.pid=second.pid
WHERE second.wait_event_type='Lock' AND second.wait_event='advisory'
 AND held.locktype='advisory' AND held.granted AND held.mode='ExclusiveLock'
 AND waiting.locktype='advisory' AND NOT waiting.granted AND waiting.mode='ExclusiveLock'
 AND held.database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND waiting.database=held.database AND held.classid=20260910 AND held.objid=140053 AND held.objsubid=2
 AND waiting.classid=held.classid AND waiting.objid=held.objid AND waiting.objsubid=held.objsubid
 AND first.pid=ANY(pg_blocking_pids(second.pid))
 AND NOT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE l.pid=second.pid AND l.granted
 AND l.locktype='relation' AND n.nspname IN ('public','auth','storage')))""")
    process_result(b,first,path,'serialize_first'); process_result(b,second,spath,'serialize_second')
    for output in (path,spath):
        assert b.re.findall(r'^LEGACY_STAGE_([A-Z]+)$',output.read_text(),b.re.M)==list('ABCDEFHI')+['COMPLETED']
    print('PASS contenders observed transaction mutex wait without target relation locks; both whole batches completed')
    state=snapshot(h,database); b.execute(h,database,b.reviewed_paths()); unchanged(h,database,state)
    # Actual trigger DDL contention. The holder's catalog change rolls back;
    # admission cannot skip the wait and sees only the restored trusted shape.
    clone(h,database)
    sql="CREATE FUNCTION pg_temp.legacy_wait_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER legacy_wait BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION pg_temp.legacy_wait_trigger(); SELECT pg_sleep(2); ROLLBACK;"
    holder,path=spawn(h,database,[h.private('catalog-holder.sql',sql)],'catalog_holder')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_catalog_holder' AND wait_event='PgSleep')")
    contender,cpath=spawn(h,database,b.envelope_files(h,b.reviewed_paths()),'catalog_contender')
    wait_observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='legacy_catalog_contender' AND wait_event_type='Lock')")
    process_result(b,holder,path,'catalog_holder'); process_result(b,contender,cpath,'catalog_contender')
    print('PASS observed lock55P03 fresh-after-wait contender serialization trigger-DDL wait')


def notification_case(b,h,rollback):
    import subprocess,time
    database='gridex_auth_legacy_atomic'; clone(h,database)
    output=h.private('listener.out',b''); stream=open(output,'wb')
    process=subprocess.Popen(h.command(database,transaction=False),stdin=subprocess.PIPE,stdout=stream,stderr=stream,env=b.clean_environment())
    stream.close(); h.processes.append(process)
    process.stdin.write(b"LISTEN pgrst;\n\\echo LISTENER_READY\n");process.stdin.flush()
    deadline=time.monotonic()+5
    while 'LISTENER_READY' not in output.read_text():
        assert time.monotonic()<deadline
        time.sleep(.05)
    files=b.envelope_files(h,b.reviewed_paths())
    if rollback:
        files.insert(-1,h.private('notification-error.sql',"DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"'; END $$;"))
    if rollback:
        run_rollback_error(h,database,files,'notification_rollback','XX000')
    else:
        h.run_files(database,files,'notification_commit')
    process.stdin.write(b"SELECT 1;\n\\q\n");process.stdin.flush();process.wait(timeout=10)
    assert process.returncode==0
    raw=output.read_text()
    assert raw.count('Asynchronous notification "pgrst"')==(0 if rollback else 1)
    assert SENTINEL not in raw


def logging_cases(b,h):
    import contextlib,io,json
    database='gridex_auth_legacy_native'; clone(h,database)
    public=io.StringIO()
    with contextlib.redirect_stdout(public):
        for state in ('23505','XX000'):
            sql=f"DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='{state}',MESSAGE='{SENTINEL}',DETAIL='{SENTINEL}',HINT='{SENTINEL}'; END $$;"
            h.sql(database,sql,'sentinel_'+state,expect=state)
        # Parameter/statement context, plus server-side SQL DETAIL values.
        h.sql(database,f"CREATE TEMP TABLE sentinel_parameter(value text UNIQUE); INSERT INTO sentinel_parameter VALUES ('{SENTINEL}'); PREPARE sentinel_statement(text) AS INSERT INTO sentinel_parameter VALUES ($1); EXECUTE sentinel_statement('{SENTINEL}');",'sentinel_parameter',expect='23505')
    assert SENTINEL not in public.getvalue()
    for line in public.getvalue().splitlines():
        receipt=json.loads(line); assert set(receipt)<= {'stage','exit_code','sqlstate','category','milliseconds'}
    print(public.getvalue(),end='')
    h.docker(['logs',h.name])
    docker_logs=(Path(h.directory.name)/'docker-private-last.out').read_bytes()
    assert SENTINEL.encode() not in docker_logs, 'collector isolation failed'
    # Private log scanning proves the synthetic primary/error path was exercised.
    logs=h.docker(['exec',h.name,'sh','-c','cat /var/lib/postgresql/data/pg_log_private/*'])
    assert SENTINEL.encode() in logs, 'private server sentinel path not exercised'
    modes=h.docker(['exec',h.name,'sh','-c','stat -c %a /var/lib/postgresql/data/pg_log_private/*']).splitlines()
    assert modes and set(modes)=={b'600'}
    notification_case(b,h,True); notification_case(b,h,False)
    print('PASS private primary DETAIL CONTEXT statement parameter collector streams notification commit-only')


def downstream_helper(b,h):
    import hashlib,importlib.util,json
    database='gridex_auth_legacy_helper'; clone(h,database)
    b.execute(h,database,b.reviewed_paths())
    spec=importlib.util.spec_from_file_location('legacy_downstream_rbac',ROOT/'scripts/canonical-rbac-prefix-selftest.py')
    rbac=importlib.util.module_from_spec(spec);spec.loader.exec_module(rbac)
    helper=(ROOT/'supabase'/rbac.FINAL).read_bytes()
    assert hashlib.sha256(helper).hexdigest()==json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files'][Path(rbac.FINAL).name]
    setup=rbac.catalog_prerequisites()+rbac.prefix_baseline()+"""
INSERT INTO auth.users(id) VALUES ('10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000005'),('10000000-0000-0000-0000-000000000007');
INSERT INTO roles(key,name) VALUES('platform_admin','Synthetic platform role') ON CONFLICT(key) DO NOTHING;
INSERT INTO user_roles(user_id,role_id,status,is_active) VALUES
('10000000-0000-0000-0000-000000000002',(SELECT id FROM roles WHERE key='company_admin'),'active',false),
('10000000-0000-0000-0000-000000000005',(SELECT id FROM roles WHERE key='company_admin'),'disabled',true),
('10000000-0000-0000-0000-000000000007',(SELECT id FROM roles WHERE key='platform_admin'),'active',true);
CREATE TEMP TABLE memberships_after_first AS SELECT * FROM company_memberships;
CREATE TEMP TABLE user_roles_after_first AS SELECT * FROM user_roles;
CREATE TEMP TABLE role_permissions_after_first AS SELECT * FROM role_permissions;
CREATE TEMP TABLE roles_before AS SELECT * FROM roles;
CREATE TEMP TABLE permissions_before AS SELECT * FROM permissions;
"""
    files=[h.private('helper-setup.sql',setup),h.private('whole-downstream-helper.sql',helper),
           h.private('downstream-checks.sql',rbac.final_checks()+rbac.governance_trigger_checks()+rbac.journal_checks())]
    h.run_files(database,files,'additional_downstream_helper',transaction=False)
    print('PASS additional downstream helper existing final-RBAC governance journal checks; separate from43')


def optional_session_compatibility(b,h):
    # The compatible bootstrap already owns auth.sessions, including its
    # nullable timestamps and ON DELETE CASCADE FK. Only this journal is an
    # optional synthetic addition; neither is a claim about provider state.
    schema=check("to_regclass('public.company_user_audit_journal') IS NULL")+"""
CREATE TABLE public.company_user_audit_journal(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),user_id uuid REFERENCES auth.users(id),event text NOT NULL,metadata jsonb);"""
    original=h.reference
    assert original[0]['relation/auth.sessions']['kind']=='r'
    session_columns={k.rsplit('/',1)[1]:(v['type'],v['notnull']) for k,v in original[0].items() if k.startswith('column/auth.sessions/')}
    assert session_columns=={'id':('uuid',True),'user_id':('uuid',True),
        'created_at':('timestamp with time zone',False),'updated_at':('timestamp with time zone',False),
        'not_after':('timestamp with time zone',False)}
    assert 'relation/public.company_user_audit_journal' not in original[0]
    retained=('auth.sessions','public.company_user_audit_journal','public.platform_session_revocations',
              'public.tenant_governance_events','public.customer_sync_events')
    def retained_state(state):
        catalog,rows=state
        # Include relation, columns, constraints, policies, triggers/rules and
        # the source-named indexes. Snapshot values remain private in memory.
        catalog={k:v for k,v in catalog.items() if any(k.split('/')[1].startswith(name) for name in retained)}
        return catalog,[row for row in rows if row[0] in retained]
    try:
        reference='gridex_auth_legacy_helper'; clone(h,reference)
        # Full equality includes existing session FK/nullability/defaults/ACLs
        # and precedes any optional augmentation in both disposable clones.
        assert h.catalog(reference)==original[0], 'optional reference differs from trusted bootstrap+first43'
        h.sql(reference,schema,'optional_reference_shape')
        h.reference=(h.catalog(reference),None)
        b.execute(h,reference,b.reviewed_paths())
        h.reference=(h.reference[0],h.catalog(reference))
        database='gridex_auth_legacy_seeded';clone(h,database)
        assert h.catalog(database)==original[0], 'optional target differs from trusted bootstrap+first43'
        h.sql(database,schema+seed_parents()+f"""
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES ('73000000-0000-0000-0000-000000000001','{U}','2026-01-01',NULL,'2026-02-01');
INSERT INTO company_user_audit_journal(id,company_id,user_id,event,metadata) VALUES ('74000000-0000-0000-0000-000000000001','{C}','{U}','retained_fixture','{{}}');
INSERT INTO platform_session_revocations(user_id,revoked_by,reason) VALUES ('{U}','{U2}','retained synthetic revocation');
INSERT INTO tenant_governance_events(company_id,target_user_id,actor_user_id,action) VALUES ('{C}','{U}','{U2}','retained_fixture');
INSERT INTO customer_sync_events(company_id,source_type,event_type,title) VALUES ('{C2}','synthetic','retained_fixture','Retained synthetic work');
""",'optional_session_seed')
        before=retained_state(snapshot(h,database))
        b.execute(h,database,b.reviewed_paths());after=snapshot(h,database)
        assert retained_state(after)==before, 'initial batch changed retained session or history rows/catalog'
        # Complete post-batch snapshot equality also preserves the retained
        # preimage on repeat, without a second redundant snapshot query.
        b.execute(h,database,b.reviewed_paths());unchanged(h,database,after)
    finally:
        h.reference=original
    print('PASS bootstrap Auth-session and optional journal exact retained rows/catalog across batch and repeat')


def privilege_variants(b,h):
    database='gridex_auth_legacy_dirty'
    # Baseline actual roles, effective denials and service count are asserted
    # with role switching after each whole committed boundary.
    clone(h,database);b.execute(h,database,b.reviewed_paths())
    for role in ('anon','authenticated','authenticator'):
        for relation in ('auth_provisioning_events','gridex_user_auth_integrity_v'):
            h.sql(database,f'SET LOCAL ROLE {role}; SELECT * FROM public.{relation};','deny_'+role,expect='42501')
    h.sql(database,"SET LOCAL ROLE service_role; SELECT count(*) FROM auth_provisioning_events;",'service_count')
    # Inherited grant is a real PostgreSQL inheritance route. Global role
    # changes are rolled back together with the hostile table grant.
    before=snapshot(h,database)
    files=b.envelope_files(h,b.reviewed_paths())
    setup="CREATE ROLE legacy_inherited NOLOGIN; GRANT legacy_inherited TO authenticated WITH INHERIT TRUE; GRANT SELECT ON auth_provisioning_events TO legacy_inherited;"
    # Setup and envelope must share one transaction. The envelope's isolation
    # command is first, then the hostile fixture, then fresh locked admission.
    context=files[0].read_text();context=context.replace('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;','SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n'+setup)
    files[0]=h.private('inherited-context.sql',context)
    run_rollback_error(h,database,files,'inherited_grant_rejected','42804')
    unchanged(h,database,before)
    print('PASS client roles service-count inherited-grant denial')


def cleanup_test(b):
    import contextlib,io,subprocess
    # A stopped canary proves exact-name ownership cleanup does not sweep all
    # PostgreSQL containers. It has no database/source data and is owned here.
    import os
    owner=os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME') or ('gridex-auth-legacy-'+__import__('secrets').token_hex(8))
    canary=owner+'-canary'
    result=subprocess.run(['docker','create','--name',canary,'--label','gridex.auth-legacy.canary='+owner,'postgres:17'],capture_output=True)
    assert result.returncode==0, 'cleanup canary creation failed'
    capture=io.StringIO();name=None

    try:
        with contextlib.redirect_stdout(capture):
            try:
                with b.OwnedPostgres() as owned:
                    name=owned.name
                    raise b.BoundaryError('SYNTHETIC_FAILURE')
            except b.BoundaryError as error:
                assert str(error)=='SYNTHETIC_FAILURE'
        assert SENTINEL not in capture.getvalue()
        removed=subprocess.run(['docker','ps','-aq','--filter','name=^/'+name+'$'],capture_output=True)
        retained=subprocess.run(['docker','ps','-aq','--filter','name=^/'+canary+'$','--filter','label=gridex.auth-legacy.canary='+owner],capture_output=True)
        assert removed.returncode==retained.returncode==0 and not removed.stdout.strip() and retained.stdout.strip()
    finally:
        result=subprocess.run(['docker','rm','-v',canary],capture_output=True)
        assert result.returncode==0, 'canary cleanup failed'
    print('PASS failure cleanup exact-owned-resource removal retains unrelated canary')


def load_replay():
    spec=importlib.util.spec_from_file_location('legacy_actual_replay',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def actual_replay_loop(b,h):
    replay=load_replay()
    h.reset(replay.DATABASE)
    result=replay.serve_child(b,h,['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--foundation-prefix-proof'],True)
    assert result==0, 'actual staged clean-shell foundation proof failed'
    assert h.catalog(replay.DATABASE)==h.reference[1], 'actual replay DB differs from independent whole reference'
    # Q must remain unusable through an ordinary per-file invocation, even in
    # this actual replay DB after a successfully committed whole boundary.
    before=snapshot(h,replay.DATABASE)
    h.run_files(replay.DATABASE,[h.private('replay-outside-Q.sql',b.reviewed_paths()[-1].read_bytes())],'actual_replay_outside_Q',expect='P0002')
    unchanged(h,replay.DATABASE,before)
    # Re-enter the identical shell staging/loop in a fresh actual replay DB.
    # Only this test injects a private failure after Q, before final assertions;
    # the production transport has no injection parameter or alternate executor.
    h.reset(replay.DATABASE)
    original_execute=b.execute
    preimages=[];rollbacks=[]
    def injected(target,database,paths,staging=None):
        assert target is h and database==replay.DATABASE and type(staging) is b.StagedSources
        preimages.append(snapshot(h,database))
        files=b.envelope_files(h,paths,staging)
        files.insert(-1,h.private('actual-replay-injected.sql',"SELECT 'ACTUAL_REPLAY_Q_REACHED' FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage='Q'; DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"'; END $$;"))
        output=run_rollback_error(h,database,files,'actual_replay_rollback_after_Q','XX000')
        assert output.splitlines().count('ACTUAL_REPLAY_Q_REACHED')==1
        assert __import__('re').findall(r'^LEGACY_STAGE_([A-Z]+)$',output,__import__('re').M)==list('ABCDEFHI')
        rollbacks.append('after_Q_XX000')
        raise b.BoundaryError('SYNTHETIC_REPLAY_FAILURE')
    try:
        b.execute=injected
        result=replay.serve_child(b,h,['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--foundation-prefix-proof'],True)
        assert result!=0 and len(preimages)==1 and rollbacks==['after_Q_XX000']
        unchanged(h,replay.DATABASE,preimages[0])
        assert h.catalog(replay.DATABASE)==h.reference[0]
    finally:
        b.execute=original_execute
    h.docker(['logs',h.name])
    assert SENTINEL.encode() not in (Path(h.directory.name)/'docker-private-last.out').read_bytes()
    print('PASS actual clean-shell HOLD staging first43 -> A44..I51/Q52 once, outside-Q rejection and injected post-Q native rollback in actual owned replay DB; NO ledger provenance; NOT full replay')


def replay_constructor_checks(b,replay):
    import tempfile,shutil,os,json,subprocess
    result=subprocess.run(['python3','scripts/gridex-replay-input-accounting.py','--require-full-effects'],cwd=ROOT,capture_output=True,text=True)
    accounting=json.loads(result.stdout)
    assert result.returncode==1 and accounting['totalMigrations']==595 and not accounting['errors']
    assert accounting['counts']=={'FULL_FILE_SELECTED':533,'SUBSTITUTED':23,'UNCLASSIFIED':35,'EXPLICITLY_EXCLUDED':4}
    by_path={item['path']:item for item in accounting['migrations']}
    for ordinal,logical in enumerate(replay.selected_group(b),44):
        assert by_path[logical]['classification']=='FULL_FILE_SELECTED'
        assert by_path[logical]['execution']==[{'ordinal':ordinal,'stage':'foundation'}], 'whole source duplicated in timestamps'

    with tempfile.TemporaryDirectory(prefix='legacy-stage-') as directory:
        hold=Path(directory)/'hold';hold.mkdir(mode=0o700)
        for path in (ROOT/'supabase/migrations').iterdir():
            if path.is_file(): shutil.copyfile(path,hold/path.name)
        h=b.OwnedPostgres();h.active=True;h.reference=({},None)
        h.directory=type('PrivateDirectory',(),{'name':directory})()
        h.verify_logging=lambda:None
        loop=replay.FoundationLoop(b,h,True)
        paths=[str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in loop.order]
        # Retained bytes must work even when no original migration is readable.
        from unittest.mock import patch
        original_open=Path.open
        def retained_only(path,*args,**kwargs):
            if path.parent==ROOT/'supabase/migrations':
                raise AssertionError('staged executor tried to open original ROOT migration')
            return original_open(path,*args,**kwargs)
        with patch.object(Path,'open',retained_only):
            stage,data=loop.validate(hold,paths)
            b.envelope_files(h,b.reviewed_paths(),stage)
        assert data[43:52]==[s.data for s in b.validate_sources(b.reviewed_paths())]
        files=b.envelope_files(h,b.reviewed_paths(),stage)
        assert [p.read_bytes() for p in files if p.name.startswith('whole-')]==data[43:52]
        for bad in (paths[:-1],paths[::-1],paths+paths[-1:],paths[:43]+paths[44:52]+paths[43:44]+paths[52:]):
            try: loop.validate(hold,bad)
            except b.BoundaryError: pass
            else: raise AssertionError('wrong staged foundation accepted')
        a=hold/b.SOURCE_SPECS[0][1];original=a.read_bytes()
        for mutation in ('missing','changed','symlink'):
            a.unlink()
            if mutation=='changed': a.write_bytes(original+b'\n-- drift\n')
            if mutation=='symlink': a.symlink_to(b.reviewed_paths()[0])
            try: loop.validate(hold,paths)
            except b.BoundaryError: pass
            else: raise AssertionError('untrusted staged bytes accepted')
            a.unlink(missing_ok=True);a.write_bytes(original)
        # Real-loop dispatch and source-count contract without SQL claims.
        observed=[]
        h.run_files=lambda database,files,stage,transaction=True: observed.append((database,stage,transaction))
        original_execute=b.execute
        try:
            def execute(target,database,logical,staging=None):
                assert target is h and database==replay.DATABASE and type(staging) is b.StagedSources
                observed.append((database,'whole_batch',True));return {'sources':9}
            b.execute=execute
            import contextlib,io
            with contextlib.redirect_stdout(io.StringIO()): loop.run(hold,paths)
            assert len(observed)==44 and all(d==replay.DATABASE for d,_,_ in observed)
            assert [x[1] for x in observed[:-1]]==['replay_foundation_'+str(i) for i in range(1,44)]
            assert observed[-1][1:]==('whole_batch',True)
            try: loop.run(hold,paths)
            except b.BoundaryError: pass
            else: raise AssertionError('duplicate foundation accepted')
        finally: b.execute=original_execute
    for url in ('postgresql://localhost/postgres','production','postgres'):
        try: replay.psql_payload([url,'-X'])
        except RuntimeError: pass
        else: raise AssertionError('URL accepted as ownership')
    print('PASS actual replay constructor staged identities/order/hash/missing/context/execution-count controls; SQL pending')


def sql_main():
    import signal,time
    b=load_batch()
    def interrupted(signum,frame):
        raise b.BoundaryError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)
    signal.signal(signal.SIGINT,interrupted)
    started=time.monotonic()
    with b.OwnedPostgres() as h:
        b.prepare_reference(h)
        for lane in (actual_and_seeded,dirty_rows,dirty_catalog,native_cases,reduced_characterization,
                     unexpected_success_rollback,atomic_cases,concurrency,downstream_helper,optional_session_compatibility,
                     privilege_variants,logging_cases,actual_replay_loop):
            begin=time.monotonic();lane(b,h)
            print('PASS lane='+lane.__name__+' milliseconds='+str(round((time.monotonic()-begin)*1000)),flush=True)
    cleanup_test(b)
    print('PASS complete command17 legacy and actual staged replay SQL proof milliseconds='+str(round((time.monotonic()-started)*1000)))


if __name__ == '__main__':
    try:
        if '--cleanup-owned' in sys.argv:
            load_batch().cleanup_workflow_owned()
        else:
            constructor_checks()
            if '--selection-only' not in sys.argv:
                sql_main()
    except BaseException as error:
        # No raw exception text, SQL or stack locals may escape the private lane.
        if isinstance(error,(KeyboardInterrupt,SystemExit)):
            raise
        print('FAIL legacy proof category=UNEXPECTED_RESULT type='+type(error).__name__,file=sys.stderr)
        sys.exit(1)
