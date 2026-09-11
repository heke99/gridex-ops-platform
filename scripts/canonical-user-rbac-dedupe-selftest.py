#!/usr/bin/env python3
"""Complete standalone H2 evidence plus actual57 terminal owned replay proof."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import contextlib
import io
import signal
import time
import types
import shutil
from datetime import datetime
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'supabase/migrations/20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql'
SHA256 = '98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


replay = load('dedupe_replay', 'canonical-auth-provisioning-replay.py')
legacy = replay.load_batch()
repair = replay.load_repair()
dedupe = replay.load_dedupe()
support = load('dedupe_repair_test_support', 'canonical-user-rbac-repair-selftest.py')
BoundaryError = legacy.BoundaryError


def source_bytes(paths):
    return dedupe.validate_sources(paths)[0].data


INDEX_NAMES = dedupe.INDEX_NAMES


def index_declarations():
    return dedupe.index_declarations()


class Proof:
    def __init__(self, target):
        repair.require_owned(target)
        if type(target.reference) is not tuple or len(target.reference) != 2:
            raise BoundaryError('LEGACY_REFERENCE_REQUIRED')
        self.h = target
        self.directory = target.directory.name
        self.name = target.name
        self.legacy_reference = target.reference
        self.repair_reference = repair.REFERENCES[target]
        self.base = None
        self.final = None
        self.actual = False

    def require_owned(self, database):
        repair.require_owned(self.h)
        legacy.validate_database(database)
        if (self.h.directory.name != self.directory or self.h.name != self.name or
                self.h.reference is not self.legacy_reference or
                repair.REFERENCES[self.h] is not self.repair_reference):
            raise BoundaryError('STALE_OWNED_PROOF')

    def whole_file(self, database):
        self.require_owned(database)
        self.h.verify_logging()
        return self.h.private('dedupe-whole-H2.sql', source_bytes((SOURCE,)))

    def native(self, database, label, expect='00000', before=(), after=()):
        """No --single-transaction; H2.6 is the actual durability boundary."""
        whole = self.whole_file(database)
        return self.h.run_files(database, [*before, whole, *after], label,
                                transaction=False, expect=expect)

    def admit(self, database):
        self.require_owned(database)
        if not self.actual or self.base is None or self.final is None:
            raise BoundaryError('ACTUAL56_REQUIRED')
        current = repair.catalog(self.h, database)
        if current not in (self.base, self.final):
            raise BoundaryError('CLEAN_CATALOG_REQUIRED')
        if self.h.sql(database, 'SELECT count(*) FROM public.user_roles;', 'admission_rows').strip() != '0':
            raise BoundaryError('EMPTY_USER_ROLES_REQUIRED')

    def clean(self, database, label):
        # These are newly owned, offline fixtures with no untrusted writers.
        # Admission is not a publication API and cannot authorize a live target.
        self.admit(database)
        before = support.snapshot(repair, self.h, database)
        self.native(database, label)
        after = support.snapshot(repair, self.h, database)
        assert after == (self.final, before[1]), 'H2 clean preservation mismatch'


def constructors():
    """Real source/admission constructors; recorders below make NO SQL claim."""
    assert hashlib.sha256(source_bytes((SOURCE,))).hexdigest() == SHA256
    for paths in ((), (SOURCE, SOURCE), (SOURCE.with_name('substitute.sql'),),
                  (SOURCE, SOURCE.with_name('substitute.sql'))):
        try:
            source_bytes(paths)
        except BoundaryError:
            pass
        else:
            raise AssertionError('unreviewed source sequence accepted')
    original = SOURCE.read_bytes()
    for value in (b'', original[:100], original.replace(b'commit;', b'-- commit;'),
                  original.replace(b'begin;', b''), original+b'\n'):
        with patch.object(Path, 'read_bytes', return_value=value):
            try:
                source_bytes((SOURCE,))
            except BoundaryError:
                pass
            else:
                raise AssertionError('incomplete native source accepted')
    for method, value in (('is_symlink', True), ('is_file', False)):
        with patch.object(Path, method, return_value=value):
            try:
                source_bytes((SOURCE,))
            except BoundaryError:
                pass
            else:
                raise AssertionError('nonregular source accepted')
    declaration = index_declarations()
    assert all(declaration.count(name) == 1 for name in INDEX_NAMES)
    assert 'delete ' not in declaration and 'commit;' not in declaration
    manifest_path = ROOT/'scripts/migration-history-manifest.json'
    read_text = Path.read_text
    def wrong_manifest(path, *args, **kwargs):
        text = read_text(path, *args, **kwargs)
        if path == manifest_path:
            document = json.loads(text)
            document['files'][SOURCE.name] = '0'*64
            return json.dumps(document)
        return text
    with patch.object(Path, 'read_text', wrong_manifest):
        try:
            source_bytes((SOURCE,))
        except BoundaryError:
            pass
        else:
            raise AssertionError('wrong original manifest accepted')
    assert repair.legacy is legacy and replay.load_batch() is legacy and replay.load_repair() is repair
    for target in (None, object(), 'postgresql://localhost/external', types.SimpleNamespace(active=True)):
        try:
            Proof(target)
        except BoundaryError:
            pass
        else:
            raise AssertionError('foreign target admitted')
    with tempfile.TemporaryDirectory(prefix='dedupe-constructor-') as directory:
        h = legacy.OwnedPostgres()
        h.active = True
        h.directory = types.SimpleNamespace(name=directory)
        h.reference = ({}, {})
        repair.REFERENCES[h] = repair.Reference(directory, {}, {})
        try:
            proof = Proof(h)
            proof.require_owned('gridex_auth_legacy_prefix')
            h.verify_logging = lambda: None
            observed = []
            h.run_files = lambda db, files, stage, **kw: observed.append((db, files, kw))
            proof.native('gridex_auth_legacy_prefix', 'constructor')
            assert len(observed) == 1 and observed[0][2]['transaction'] is False
            assert len(observed[0][1]) == 1 and observed[0][1][0].read_bytes() == original
            # This records transport construction only, never actual execution.
            try:
                proof.admit('gridex_auth_legacy_prefix')
            except BoundaryError as error:
                assert str(error) == 'ACTUAL56_REQUIRED'
            else:
                raise AssertionError('mocked dispatch promoted to actual56')
            for mutation in ('inactive', 'name', 'directory', 'legacy', 'repair'):
                previous = h.active, h.name, h.directory, h.reference, repair.REFERENCES[h]
                try:
                    if mutation == 'inactive': h.active = False
                    if mutation == 'name': h.name += '-stale'
                    if mutation == 'directory': h.directory = types.SimpleNamespace(name=directory+'-stale')
                    if mutation == 'legacy': h.reference = ({'stale': True}, {})
                    if mutation == 'repair': repair.REFERENCES[h] = repair.Reference(directory, {}, {})
                    try:
                        proof.whole_file('gridex_auth_legacy_prefix')
                    except BoundaryError:
                        pass
                    else:
                        raise AssertionError('stale identity reached source transport')
                finally:
                    h.active, h.name, h.directory, h.reference, repair.REFERENCES[h] = previous
            for name in ('postgres', 'gridex_auth_legacy_prefix_old', 'postgresql://localhost/owned'):
                try:
                    proof.whole_file(name)
                except BoundaryError:
                    pass
                else:
                    raise AssertionError('external database accepted')
        finally:
            repair.REFERENCES.pop(h, None)
            h.active = False
            h.directory = None
    print('PASS H2 source constructors; NO SQL execution')


U = '91000000-0000-0000-0000-000000000001'
U2 = '91000000-0000-0000-0000-000000000002'
C = '92000000-0000-0000-0000-000000000001'
C2 = '92000000-0000-0000-0000-000000000002'
R = '93000000-0000-0000-0000-000000000001'
R2 = '93000000-0000-0000-0000-000000000002'
ZERO = '00000000-0000-0000-0000-000000000000'
SENTINEL = 'DEDUPE_PRIVATE_SYNTHETIC_SENTINEL'


def row(number, role, role_id=None, company=None, user=U, created='2026-01-01T00:00:00+00:00',
        status='active', active=True):
    return dict(id='94000000-0000-0000-0000-'+str(number).zfill(12), user_id=user,
                company_id=company, role=role, role_id=role_id, created_at=created,
                status=status, is_active=active)


def survivor_oracle(rows):
    """Pairwise dominance on Python full rows, independent of SQL/window code."""
    remaining = list(rows)
    removed = []
    for field in ('role', 'role_id'):
        candidates = [r for r in remaining if r[field] is not None and
                      (r['status'] is None or r['status'] == 'active') and r['is_active'] is not False]
        def key(r):
            value = r[field].lower() if field == 'role' else r[field]
            return r['user_id'], r['company_id'] or ZERO, value
        def priority(r):
            stamp = datetime.fromisoformat(r['created_at']).timestamp() if r['created_at'] else float('-inf')
            return stamp, r['id']
        losers = [r for r in candidates if any(key(other) == key(r) and priority(other) > priority(r)
                                              for other in candidates)]
        ids = {r['id'] for r in losers}
        remaining = [r for r in remaining if r['id'] not in ids]
        removed.append(sorted(losers, key=lambda r: r['id']))
    return sorted(remaining, key=lambda r: r['id']), removed


def oracle_constructors():
    # Literal answers make reversed passes, whitespace trimming, ascending UUID,
    # NULL-first ordering and treating NULL activity as inactive fail locally.
    rows = [row(1, 'alpha', R, created='2026-01-03T00:00:00+00:00'),
            row(2, 'ALPHA', R2, created='2026-01-04T00:00:00+00:00'),
            row(3, 'beta', R, created='2026-01-02T00:00:00+00:00'), row(4, 'gamma', R2)]
    survivors, passes = survivor_oracle(rows)
    assert [r['id'] for r in survivors] == [rows[1]['id'], rows[2]['id']]
    assert [[r['id'] for r in deleted] for deleted in passes] == [[rows[0]['id']], [rows[3]['id']]]
    variants = [row(10, 'X'), row(11, 'x'), row(12, ' x'), row(13, 'x '),
                row(14, 'null_time', created=None), row(15, 'NULL_TIME'),
                row(16, 'nullable', status=None, active=None), row(17, 'NULLABLE'),
                row(18, 'NULLABLE', status='disabled'), row(19, 'NULLABLE', active=False),
                row(20, None), row(21, None), row(22, 'sentinel'), row(23, 'SENTINEL', company=ZERO),
                row(24, 'null_user', user=None), row(25, 'NULL_USER', user=None)]
    survivors, _ = survivor_oracle(variants)
    assert [int(r['id'][-12:]) for r in survivors] == [11,12,13,15,17,18,19,20,21,23,25]
    assert variants[0]['role'] == 'X', 'oracle mutated original full rows'
    print('PASS independent sequential survivor oracle constructors; NO SQL execution')


def workflow_constructors():
    workflow = (ROOT/'.github/workflows/ops-hardening.yml').read_text()
    match = re.search(r'^  user-rbac-dedupe-proof:\n(.*?)(?=^  \S|\Z)', workflow, re.M | re.S)
    assert match, 'independent H2 hosted job missing'
    job = match.group(1)
    assert 'timeout-minutes: 20' in job
    assert 'GRIDEX_LEGACY_CONTAINER_NAME: gridex-auth-legacy-dedupe-${{ github.run_id }}-${{ github.run_attempt }}' in job
    assert 'run: python3 scripts/canonical-auth-membership-group.py --partition dedupe19\n' in job
    assert 'if: always()\n        run: python3 scripts/canonical-user-rbac-dedupe-selftest.py --cleanup-owned' in job
    assert not re.search(r'\b(?:services|needs):|upload-artifact|docker logs|setup-cli', job)
    assert 'Verify command18 standalone and actual staged repair56 on private owned PostgreSQL 17' in workflow
    command = subprocess.run([sys.executable, str(ROOT/'scripts/canonical-auth-membership-group.py'), '--dry-run'],
                             capture_output=True, text=True, cwd=ROOT)
    assert command.returncode == 0 and command.stdout.splitlines()[-1] == 'python3 scripts/canonical-user-rbac-dedupe-selftest.py'
    for argv in (['--unknown'], ['--selection'], ['--selection-only', '--cleanup-owned']):
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                arguments(argv)
            except SystemExit as error:
                assert error.code == 2
            else:
                raise AssertionError('unknown/combined mode accepted')
    with patch.object(sys, 'argv', ['selftest', '--cleanup-owned']), \
         patch.object(legacy, 'cleanup_workflow_owned') as cleanup:
        main()
        cleanup.assert_called_once_with()
    print('PASS independent workflow, exact cleanup and CLI constructors; all19 with unchanged original18')


def clone(h, database, template='gridex_auth_legacy_template'):
    legacy.validate_database(database)
    legacy.validate_database(template)
    assert database != template
    h.reset(database)
    h.docker(['exec', h.name, 'dropdb', '-U', 'postgres', database])
    h.docker(['exec', h.name, 'createdb', '-U', 'postgres', '-T', template, database])


def snapshot(proof, database):
    proof.require_owned(database)
    return support.snapshot(repair, proof.h, database)


def canaries():
    # These exact columns are present in actual56; Auth INSERT does not create a
    # profile. No fixed diagnostic account, password or provider fixture exists.
    return f'''
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at)
VALUES ('{U}','dedupe-one@example.invalid','{{"fixture":"dedupe"}}','{{}}','2026-01-01'),
('{U2}','dedupe-two@example.invalid','{{}}','{{}}','2026-01-01');
INSERT INTO companies(id,name,slug,status) VALUES
('{C}','Dedupe one','dedupe-one','active'),('{C2}','Dedupe two','dedupe-two','active');
INSERT INTO user_profiles(id,email,user_status,active_company_id) VALUES
('{U}','dedupe-one@example.invalid','disabled','{C}'),('{U2}','dedupe-two@example.invalid','active','{C2}');
INSERT INTO company_memberships(company_id,user_id,membership_role,role,status,invited_email)
VALUES ('{C}','{U}','member','member','active','dedupe-one@example.invalid'),
('{C2}','{U2}','member','member','active','dedupe-two@example.invalid');
INSERT INTO roles(id,key,name,is_active,is_system,is_system_role) VALUES
('{R}','dedupe_custom_one','Dedupe custom one',false,false,false),
('{R2}','dedupe_custom_two','Dedupe custom two',true,false,false);
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
VALUES ('95000000-0000-0000-0000-000000000001','{U}','2026-01-01',NULL,'2026-02-01');
INSERT INTO platform_session_revocations(user_id,revoked_by,reason)
VALUES ('{U}','{U2}','synthetic dedupe canary');
INSERT INTO tenant_governance_events(company_id,target_user_id,actor_user_id,action)
VALUES ('{C}','{U}','{U2}','dedupe_canary');
INSERT INTO customer_sync_events(company_id,source_type,event_type,title)
VALUES ('{C2}','synthetic','dedupe_canary','Dedupe retained work');
'''


def index_details(h, database):
    return dedupe.index_details(h, database)


def actual56(proof):
    h = proof.h
    original = support.replay_originals_snapshot()
    reached = []
    execute_legacy, execute_repair = legacy.execute, repair.execute
    def legacy_once(target, database, paths, staging=None):
        assert target is h and database == replay.DATABASE and type(staging) is legacy.StagedSources
        assert reached == []
        reached.append('legacy')
        return execute_legacy(target, database, paths, staging)
    def repair_once(target, database, paths, staging=None):
        assert target is h and database == replay.DATABASE and type(staging) is legacy.StagedSources
        assert reached == ['legacy']
        assert h.catalog(database) == proof.legacy_reference[1]
        assert repair.catalog(h, database) == proof.repair_reference.base
        reached.append('repair')
        return execute_repair(target, database, paths, staging)
    with patch.object(legacy, 'execute', legacy_once), patch.object(repair, 'execute', repair_once):
        h.reset(replay.DATABASE)
        status = replay.serve_child(legacy, h,
            ['bash', str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'), '--repair-prefix-proof'], 'repair56')
    assert status == 0 and reached == ['legacy', 'repair']
    assert support.replay_originals_snapshot() == original
    assert not (Path(h.directory.name)/'replay.sock').exists()
    proof.require_owned(replay.DATABASE)
    assert repair.catalog(h, replay.DATABASE) == proof.repair_reference.final
    h.sql(replay.DATABASE, canaries(), 'canaries_actual56')
    assert h.sql(replay.DATABASE, f"SELECT count(*) FROM user_profiles WHERE id IN ('{U}','{U2}');", 'profile_canaries').strip() == '2'
    h.sql(replay.DATABASE, '''CREATE SEQUENCE public.dedupe_uncalled START WITH 17;
CREATE SEQUENCE public.dedupe_called START WITH 31;
SELECT setval('public.dedupe_uncalled',41,false);
SELECT nextval('public.dedupe_called');''', 'sequence_canaries')
    proof.base = repair.catalog(h, replay.DATABASE)
    assert all('index/public.'+name not in proof.base for name in INDEX_NAMES)
    # The actual complete replay is the cloning origin. Reference DBs never
    # substitute for whole bootstrap/first43/legacy44–52/repair53–56 execution.
    clone(h, 'gridex_auth_legacy_template', replay.DATABASE)
    clone(h, 'gridex_auth_legacy_helper', replay.DATABASE)
    before = snapshot(proof, 'gridex_auth_legacy_helper')
    h.sql('gridex_auth_legacy_helper', index_declarations(), 'independent_H2_oracle')
    proof.final = repair.catalog(h, 'gridex_auth_legacy_helper')
    assert snapshot(proof, 'gridex_auth_legacy_helper')[1] == before[1]
    assert set(proof.final)-set(proof.base) == {'index/public.'+name for name in INDEX_NAMES}
    assert {k:v for k,v in proof.final.items() if k in proof.base} == proof.base
    details = index_details(h, 'gridex_auth_legacy_helper')
    assert len(details) == 2
    for item in details:
        assert item['method'] == 'btree' and item['unique'] and item['valid'] and item['ready']
        assert item['nulls_not_distinct'] is False
        assert item['opclasses'] == ['uuid_ops', 'uuid_ops', 'text_ops' if 'text' in item['name'] else 'uuid_ops']
    proof.actual = True
    proof.clean(replay.DATABASE, 'actual56_clean_H2')
    assert index_details(h, replay.DATABASE) == details
    proof.clean(replay.DATABASE, 'actual56_repeat_H2')
    states = {name:value for name,value in snapshot(proof,replay.DATABASE)[1]
              if name in ('public.dedupe_called','public.dedupe_uncalled')}
    assert states['public.dedupe_uncalled'] == {'last_value':41,'log_cnt':0,'is_called':False}
    assert states['public.dedupe_called']['last_value'] == 31 and states['public.dedupe_called']['is_called'] is True
    print('PASS actual56 clean and repeat; exact independent indexes and full canary rows/sequences; unpublished')


def insert_rows(h, database, rows, label='role_fixture', expect='00000'):
    # Static synthetic dictionaries only; literals are quoted by the trusted
    # helper. jsonb_populate_record preserves the database types independently.
    columns = ('id','user_id','company_id','role','role_id','created_at','status','is_active')
    payload = legacy.literal(json.dumps(rows))
    sql = ('INSERT INTO public.user_roles('+','.join(columns)+') SELECT '+','.join(columns)+
           ' FROM jsonb_populate_recordset(NULL::public.user_roles,'+payload+'::jsonb);')
    return h.sql(database, sql, label, expect=expect)


def admission_negatives(proof):
    h = proof.h
    db = 'gridex_auth_legacy_dirty'
    fixtures = [
        ('wrong_index', 'CREATE INDEX '+INDEX_NAMES[0]+' ON public.user_roles(id);'),
        ('wrong_kind', 'CREATE TABLE public.'+INDEX_NAMES[0]+'(id integer);'),
        ('wrong_column', 'ALTER TABLE public.user_roles ADD COLUMN unexpected text;'),
        ('wrong_constraint', "ALTER TABLE public.user_roles ADD CONSTRAINT dedupe_wrong CHECK(role IS DISTINCT FROM 'wrong');"),
        ('wrong_trigger', '''CREATE FUNCTION public.dedupe_unexpected() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER dedupe_unexpected BEFORE INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.dedupe_unexpected();''')]
    for label, sql in fixtures:
        clone(h, db)
        h.sql(db, sql, 'fixture_'+label)
        before = snapshot(proof, db)
        with patch.object(proof, 'native', side_effect=AssertionError('source submitted before admission')):
            try:
                proof.clean(db, label)
            except BoundaryError as error:
                assert str(error) == 'CLEAN_CATALOG_REQUIRED'
            else:
                raise AssertionError('dirty catalog admitted')
        assert snapshot(proof, db) == before
        if label in ('wrong_index', 'wrong_kind'):
            # Native IF NOT EXISTS accepts even a wrong-kind same-name object.
            proof.native(db, 'native_if_not_exists_'+label)
            catalog, rows = snapshot(proof, db)
            expected = dict(before[0])
            expected['index/public.'+INDEX_NAMES[1]] = proof.final['index/public.'+INDEX_NAMES[1]]
            assert (catalog, rows) == (expected, before[1])
    for number, role_row in enumerate((row(1,'any'),row(2,None,status='disabled',active=False),
                                       row(3,None,user=U2),row(4,None,role_id=None,company=C2)),1):
        clone(h, db)
        insert_rows(h, db, [role_row])
        before = snapshot(proof, db)
        with patch.object(proof, 'native', side_effect=AssertionError('populated source submitted')):
            try:
                proof.clean(db, 'populated_'+str(number))
            except BoundaryError as error:
                assert str(error) == 'EMPTY_USER_ROLES_REQUIRED'
            else:
                raise AssertionError('populated input admitted')
        assert snapshot(proof, db) == before
    print('PASS actual56 catalog and all-row empty admission rejects before source; native IF NOT EXISTS characterized')


def dirty_rows(reduced=False):
    rows = [row(1,'alpha',R,created='2026-01-03T00:00:00+00:00'),
            row(2,'ALPHA',R2,created='2026-01-04T00:00:00+00:00'),
            row(3,'beta',R,created='2026-01-02T00:00:00+00:00'),row(4,'gamma',R2),
            row(10,'tie'),row(11,'TIE'),row(12,' tie'),row(13,'tie '),
            row(20,None),row(21,None),
            row(22,'inactive',status='disabled'),row(23,'INACTIVE',status='disabled'),
            row(24,'false',active=False),row(25,'FALSE',active=False),
            row(30,'sentinel'),row(31,'SENTINEL',company=ZERO),
            row(40,'legitimate',R,company=C),row(41,'legitimate',R,company=C2),
            row(42,'different_legitimate',R2,company=C),
            row(43,'other_user',user=U2),
            row(50,'orphan',role_id='93000000-0000-0000-0000-000000000099',
                user='91000000-0000-0000-0000-000000000099',company='92000000-0000-0000-0000-000000000099')]
    if reduced:
        rows += [row(60,'null_time',created=None),row(61,'NULL_TIME'),
                 row(62,'both_null_time',created=None),row(63,'BOTH_NULL_TIME',created=None),
                 row(64,'null_activity',status=None,active=None),row(65,'NULL_ACTIVITY'),
                 row(66,'null_user',user=None),row(67,'NULL_USER',user=None),
                 row(68,None,R,user=None),row(69,None,R,user=None),
                 row(70,'same_id_one',R,company=C2),row(71,'same_id_two',R,company=C2),
                 row(72,'null_status',status=None),row(73,'NULL_STATUS'),
                 row(74,'null_is_active',active=None),row(75,'NULL_IS_ACTIVE')]
    return rows


def reduced_fixture(proof, database):
    """Explicit historical characterization only; never actual-prefix admission."""
    proof.require_owned(database)
    proof.h.reset(database)
    proof.h.sql(database, '''CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE TABLE public.companies(id uuid PRIMARY KEY,name text);
CREATE TABLE public.roles(id uuid PRIMARY KEY,key text);
CREATE TABLE public.user_roles(id uuid PRIMARY KEY,user_id uuid,company_id uuid,
 role text,role_id uuid,status text,is_active boolean,created_at timestamptz);
''', 'reduced_historical_shape')


def dependents(h, database):
    h.sql(database, '''
CREATE TABLE public.dedupe_children(id uuid PRIMARY KEY,user_role_id uuid NOT NULL
 REFERENCES public.user_roles(id) ON DELETE CASCADE,marker text NOT NULL);
INSERT INTO public.dedupe_children SELECT id,id,'dependent synthetic row' FROM public.user_roles;
CREATE TABLE public.dedupe_row_history(id uuid PRIMARY KEY,phase integer NOT NULL,old_row jsonb NOT NULL);
CREATE TABLE public.dedupe_statement_history(phase integer PRIMARY KEY,removed jsonb NOT NULL);
CREATE FUNCTION public.dedupe_row_history_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.dedupe_row_history VALUES (OLD.id,
  (SELECT coalesce(max(phase),0)+1 FROM public.dedupe_statement_history),to_jsonb(OLD));
 RETURN OLD;
END $$;
CREATE TRIGGER dedupe_row_history AFTER DELETE ON public.user_roles
 FOR EACH ROW EXECUTE FUNCTION public.dedupe_row_history_fn();
CREATE FUNCTION public.dedupe_statement_history_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.dedupe_statement_history
 SELECT (SELECT coalesce(max(phase),0)+1 FROM public.dedupe_statement_history),
  coalesce(jsonb_agg(to_jsonb(deleted_row) ORDER BY deleted_row.id),'[]') FROM deleted_rows deleted_row;
 RETURN NULL;
END $$;
CREATE TRIGGER dedupe_statement_history AFTER DELETE ON public.user_roles
 REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
 EXECUTE FUNCTION public.dedupe_statement_history_fn();
''', 'dependent_cascade_history')


def expected_characterization(proof, before):
    original_roles = [value for name,value in before[1] if name == 'public.user_roles']
    survivors, passes = survivor_oracle(original_roles)
    removed_ids = {r['id'] for group in passes for r in group}
    rows = [(name,value) for name,value in before[1] if name != 'public.user_roles' and
            not (name == 'public.dedupe_children' and value['user_role_id'] in removed_ids)]
    rows += [('public.user_roles',value) for value in survivors]
    if 'relation/public.dedupe_row_history' in before[0]:
        rows += [('public.dedupe_row_history',dict(id=r['id'],phase=phase,old_row=r))
                 for phase,group in enumerate(passes,1) for r in group]
        rows += [('public.dedupe_statement_history',dict(phase=phase,removed=group))
                 for phase,group in enumerate(passes,1)]
    catalog = dict(before[0])
    for name in INDEX_NAMES:
        catalog['index/public.'+name] = proof.final['index/public.'+name]
    return catalog, rows, survivors, passes


def canonical_rows(rows):
    return sorted(json.dumps([name,value],sort_keys=True,separators=(',',':')) for name,value in rows)


def assert_characterization(proof, database, before):
    expected_catalog, expected_rows, survivors, passes = expected_characterization(proof,before)
    after = snapshot(proof,database)
    assert after[0] == expected_catalog, 'native catalog delta mismatch'
    assert canonical_rows(after[1]) == canonical_rows(expected_rows), 'native full-row/dependent survivor mismatch'
    return survivors, passes


def native_constraints(proof):
    h = proof.h
    db = 'gridex_auth_legacy_dirty'
    clone(h,db)
    for field in ('user_id','created_at','status','is_active'):
        item = row(1,'null_constraint')
        item[field] = None
        before = snapshot(proof,db)
        insert_rows(h,db,[item],'actual56_notnull_'+field,'23502')
        assert snapshot(proof,db) == before
    before = snapshot(proof,db)
    insert_rows(h,db,[row(1,'one',R,company=C),row(2,'two',R,company=C)],'actual56_role_id_guard','23505')
    assert snapshot(proof,db) == before
    print('PASS actual56 native NOT NULL and existing active role-id guard; no canonical guard removed')


def characterization(proof):
    h = proof.h
    for reduced in (False,True):
        db = 'gridex_auth_legacy_native' if reduced else 'gridex_auth_legacy_dirty'
        label = 'reduced_historical' if reduced else 'actual56_dirty'
        if reduced:
            reduced_fixture(proof,db)
        else:
            clone(h,db)
        insert_rows(h,db,dirty_rows(reduced))
        dependents(h,db)
        before = snapshot(proof,db)
        proof.native(db,label)
        survivors,passes = assert_characterization(proof,db,before)
        assert all(passes) and len(survivors) < len(dirty_rows(reduced))
        print('PASS lane='+label+' text_deleted='+str(len(passes[0]))+' id_deleted='+str(len(passes[1]))+
              ' survivors='+str(len(survivors))+' full_rows_and_dependents=1')
    # Window partitions group NULL users, but a unique btree index treats those
    # NULL keys as distinct. Exercise insertion AFTER H2 separately from dedupe.
    db = 'gridex_auth_legacy_native'
    reduced_fixture(proof,db)
    proof.native(db,'reduced_empty_indexes')
    nulls = [row(80,'null_unique',R,user=None),row(81,'NULL_UNIQUE',R,user=None)]
    insert_rows(h,db,nulls,'reduced_null_user_index_semantics')
    before = snapshot(proof,db)
    assert len([v for n,v in before[1] if n == 'public.user_roles']) == 2
    proof.native(db,'reduced_null_user_window_semantics')
    assert_characterization(proof,db,before)
    rows = [v for n,v in snapshot(proof,db)[1] if n == 'public.user_roles']
    assert len(rows) == 1 and rows[0]['id'] == nulls[1]['id']
    # Non-NULL user/company coalescing and predicates enforce the two guards.
    insert_rows(h,db,[row(82,'unique_text',None)],'text_unique_seed')
    insert_rows(h,db,[row(83,'UNIQUE_TEXT',None,company=ZERO)],'text_unique_violation','23505')
    insert_rows(h,db,[row(84,None,R)],'role_id_unique_seed')
    insert_rows(h,db,[row(85,'different',R)],'role_id_unique_violation','23505')
    print('PASS reduced NULL user unique-index semantics differ from window partitions; two guards enforced')


def sentinel_sql():
    return "DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"',DETAIL='"+SENTINEL+"',HINT='"+SENTINEL+"'; END $$;"


def destroy_database(proof,database):
    proof.require_owned(database)
    assert database not in ('gridex_auth_legacy_reference','gridex_auth_legacy_template','gridex_auth_legacy_replay')
    proof.h.docker(['exec',proof.h.name,'dropdb','-U','postgres','--force',database])
    absent = support.private_query(proof.h,'gridex_auth_legacy_replay',
        'SELECT count(*) FROM pg_database WHERE datname='+legacy.literal(database))
    assert absent == '0'


def failure_boundaries(proof):
    h = proof.h
    db = 'gridex_auth_legacy_atomic'
    for mode,state in (('restrict','23503'),('second_delete_hook','XX000'),('post_commit_hook','XX000')):
        clone(h,db)
        insert_rows(h,db,dirty_rows())
        dependents(h,db)
        if mode == 'restrict':
            h.sql(db,"CREATE TABLE public.dedupe_restrict(id uuid PRIMARY KEY REFERENCES public.user_roles(id) ON DELETE RESTRICT);"+
                  "INSERT INTO public.dedupe_restrict VALUES ('"+row(1,'')['id']+"');",'restrict_fixture')
        if mode == 'second_delete_hook':
            # Trusted external trigger fails the second native DELETE. The first
            # pass already deleted rows and wrote dependent history in this tx.
            h.sql(db,'''CREATE FUNCTION public.dedupe_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
IF (SELECT count(*) FROM public.dedupe_statement_history)=1 THEN
 RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='DEDUPE_PRIVATE_SYNTHETIC_SENTINEL'; END IF;
RETURN NULL; END $$;
CREATE TRIGGER dedupe_fail_second BEFORE DELETE ON public.user_roles
 FOR EACH STATEMENT EXECUTE FUNCTION public.dedupe_fail_second();''','second_delete_failure_hook')
        before = snapshot(proof,db)
        after = [h.private('dedupe-after-commit-failure.sql',sentinel_sql())] if mode == 'post_commit_hook' else []
        proof.native(db,'native_'+mode,expect=state,after=after)
        private = (Path(h.directory.name)/'client-last.out').read_bytes()
        if state == 'XX000':
            assert SENTINEL.encode() in private
        if mode == 'post_commit_hook':
            assert b'DETAIL:' in private and b'HINT:' in private
            assert_characterization(proof,db,before)
            assert snapshot(proof,db) != before, 'committed deletion falsely claimed rolled back'
        else:
            assert snapshot(proof,db) == before, 'pre-COMMIT failure failed to roll back'
        destroy_database(proof,db)
    # The historical diagnostic itself can fail after H2.6. This is an
    # explicitly reduced shape; only a fixture column is missing, not SQL edited.
    db = 'gridex_auth_legacy_native'
    reduced_fixture(proof,db)
    insert_rows(h,db,dirty_rows(True))
    h.sql(db,'ALTER TABLE auth.users DROP COLUMN email;','reduced_diagnostic_shape')
    before = snapshot(proof,db)
    proof.native(db,'native_post_commit_diagnostic',expect='42703')
    assert_characterization(proof,db,before)
    destroy_database(proof,db)
    print('PASS native pre-COMMIT restrict/second-pass rollback; post-COMMIT hook/diagnostic preserves committed deletes and indexes then destroys exact owned DB')


def spawn(proof,database,files,label):
    proof.require_owned(database)
    assert re.fullmatch('[a-z_]+',label)
    path = proof.h.private('dedupe-process-'+label+'.out',b'')
    command = proof.h.command(database,files,transaction=False)
    command[2:2] = ['-e','PGAPPNAME=dedupe_'+label]
    with open(path,'wb') as stream:
        process = subprocess.Popen(command,stdout=stream,stderr=stream,env=legacy.clean_environment())
    proof.h.processes.append(process)
    return process,path


def wait_sleep(h,database,label):
    support.observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='dedupe_"+label+"' AND wait_event='PgSleep')")


def terminate(h,database,label):
    support.private_query(h,database,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='dedupe_"+label+"'")


def concurrency_and_death(proof):
    h = proof.h
    db = 'gridex_auth_legacy_lock'
    clone(h,db)
    insert_rows(h,db,dirty_rows())
    before = snapshot(proof,db)
    # A real separate writer holds a table lock; H2 must block and time out.
    writer = h.private('dedupe-writer-lock.sql','BEGIN; LOCK TABLE public.user_roles IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(30); ROLLBACK;')
    process,path = spawn(proof,db,[writer],'writer_lock')
    try:
        wait_sleep(h,db,'writer_lock')
        timeout = h.private('dedupe-lock-timeout.sql',"SET lock_timeout='700ms';")
        proof.native(db,'native_writer_contention',expect='55P03',before=[timeout])
    finally:
        terminate(h,db,'writer_lock')
        support.result(repair,process,path,'writer_lock_end','57P01')
    assert snapshot(proof,db) == before
    # CREATE INDEX acquires ShareLock; hold that real lock while a separate
    # writer attempts RowExclusiveLock. Both sessions stay private.
    clone(h,db)
    oracle = h.private('dedupe-index-lock.sql','BEGIN; '+index_declarations()+' SELECT pg_sleep(30); ROLLBACK;')
    process,path = spawn(proof,db,[oracle],'index_lock')
    try:
        wait_sleep(h,db,'index_lock')
        h.sql(db,"SET LOCAL lock_timeout='700ms'; INSERT INTO public.user_roles(user_id,role) VALUES ('"+U+"','contender');",'native_index_writer_contention',expect='55P03')
    finally:
        terminate(h,db,'index_lock')
        support.result(repair,process,path,'index_lock_end','57P01')
    assert repair.catalog(h,db) == proof.base
    # Whole H2 completes before this trusted external sleep. Backend death
    # cannot undo its original COMMIT; observe the exact committed preimage.
    insert_rows(h,db,dirty_rows())
    dependents(h,db)
    before = snapshot(proof,db)
    pause = h.private('dedupe-after-native-commit.sql','SELECT pg_sleep(30);')
    process,path = spawn(proof,db,[proof.whole_file(db),pause],'post_commit_death')
    wait_sleep(h,db,'post_commit_death')
    assert_characterization(proof,db,before)
    terminate(h,db,'post_commit_death')
    support.result(repair,process,path,'post_commit_death','57P01')
    assert_characterization(proof,db,before)
    destroy_database(proof,db)
    print('PASS real writer/index contention 55P03 and backend death after native COMMIT; committed full rows retained privately then destroyed')


def privacy(proof):
    h = proof.h
    h.verify_logging()
    assert all(path.stat().st_mode & 0o077 == 0 for path in Path(h.directory.name).iterdir() if path.is_file())
    assert Path(h.directory.name).stat().st_mode & 0o077 == 0
    h.docker(['logs',h.name])  # Captured privately by the accepted helper; never emitted.
    assert SENTINEL.encode() not in (Path(h.directory.name)/'docker-private-last.out').read_bytes()
    assert not (Path(h.directory.name)/'replay.sock').exists()
    raw = ('ERROR: XX000: '+SENTINEL+'\nDETAIL: '+SENTINEL+'\nHINT: '+SENTINEL+
           '\nSTATEMENT: '+SENTINEL+'\nparameters: '+SENTINEL)
    receipt = legacy.safe_receipt(raw,1,'privacy')
    assert SENTINEL not in json.dumps(receipt)
    assert set(receipt) == {'stage','exit_code','sqlstate','category'}
    assert receipt['sqlstate'] == 'XX000'
    print('PASS private client/server/DETAIL/HINT/statement/parameter boundaries; allowlisted receipts only')


def controller_death_cleanup(actual=False):
    """SIGKILL skips __exit__; workflow cleanup still matches exact name+label."""
    originals=support.replay_originals_snapshot() if actual else None
    owner = os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME') or 'gridex-auth-legacy-dedupe-'+os.urandom(8).hex()
    canary = owner+'-death-canary'
    env = legacy.clean_environment()
    env['GRIDEX_LEGACY_CONTAINER_NAME'] = owner
    with patch.dict(os.environ,{'GRIDEX_LEGACY_CONTAINER_NAME':owner}):
        assert legacy.OwnedPostgres().name == owner
    created = subprocess.run(['docker','create','--name',canary,'--label',
        'gridex.auth-legacy.canary='+owner,'postgres:17'],capture_output=True,env=env)
    assert created.returncode == 0
    private_directory = None
    process = None
    # This extra lifecycle control intentionally uses a reduced standalone
    # fixture. It proves cleanup after controller death, not actual56 admission.
    child = '''import importlib.util,os,pathlib,sys,time
spec=importlib.util.spec_from_file_location('dedupe_death_child',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with m.legacy.OwnedPostgres() as h:
 db='gridex_auth_legacy_native';h.reset(db)
 h.sql(db,"CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid,email text); CREATE TABLE public.companies(id uuid,name text); CREATE TABLE public.roles(id uuid,key text); CREATE TABLE public.user_roles(id uuid PRIMARY KEY,user_id uuid,company_id uuid,role text,role_id uuid,status text,is_active boolean,created_at timestamptz);")
 m.insert_rows(h,db,[m.row(1,'death'),m.row(2,'DEATH')])
 source=h.private('dedupe-death-whole.sql',m.source_bytes((m.SOURCE,)))
 h.run_files(db,[source],'reduced_controller_commit',transaction=False)
 temporary=sys.argv[2]+'.tmp'
 with open(temporary,'w') as marker:
  os.chmod(temporary,0o600);marker.write(h.directory.name)
 os.replace(temporary,sys.argv[2])
 time.sleep(120)
'''
    if actual:
        child = '''import importlib.util,os,sys,time
spec=importlib.util.spec_from_file_location('dedupe_actual_death_child',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with m.legacy.OwnedPostgres() as h:
 m.dedupe.prepare_reference(h)
 native=h.run_files
 def committed(database,files,stage,*args,**kwargs):
  result=native(database,files,stage,*args,**kwargs)
  if stage=='dedupe_native':
   assert m.dedupe._STATES[h]=='NATIVE'
   temporary=sys.argv[2]+'.tmp'
   with open(temporary,'w') as marker:
    os.chmod(temporary,0o600);marker.write(h.directory.name)
   os.replace(temporary,sys.argv[2])
   time.sleep(120)
  return result
 h.run_files=committed
 m.replay.serve_child(m.legacy,h,['bash',str(m.ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--dedupe-prefix-proof'],'dedupe57')
'''
    try:
        with tempfile.TemporaryDirectory(prefix='dedupe-controller-') as directory:
            marker = Path(directory)/'committed'
            output = Path(directory)/'private.out'
            with open(output,'wb') as stream:
                os.chmod(output,0o600)
                process = subprocess.Popen([sys.executable,'-c',child,str(Path(__file__).resolve()),str(marker)],
                                           stdout=stream,stderr=stream,env=env)
            deadline = time.monotonic()+(180 if actual else 90)
            while not marker.exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise BoundaryError('CONTROLLER_READY_FAILED')
                time.sleep(0.1)
            private_directory = Path(marker.read_text())
            assert private_directory.parent == Path(tempfile.gettempdir())
            assert private_directory.name.startswith('gridex-auth-legacy-')
            assert private_directory.is_dir() and private_directory.stat().st_uid == os.getuid()
            check = subprocess.run(['docker','exec',owner,'psql','-X','-U','postgres','-d',replay.DATABASE if actual else 'gridex_auth_legacy_native','-qAt','-c',
                "SELECT count(*) FROM public.user_roles; SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('user_roles_active_unique_role_text_idx','user_roles_active_unique_role_id_idx');"],
                capture_output=True,env=env)
            assert check.returncode == 0 and check.stdout.splitlines() == [b'0' if actual else b'1',b'2']
            process.kill()
            assert process.wait(timeout=10) == -signal.SIGKILL
            # The committed container survives controller death, until exact
            # existing cleanup is invoked. No published connection is returned.
            present = subprocess.run(['docker','ps','-aq','--filter','name=^/'+owner+'$',
                '--filter','label=gridex.auth-legacy.owner='+owner],capture_output=True,env=env)
            assert present.returncode == 0 and present.stdout.strip()
            with patch.dict(os.environ,{'GRIDEX_LEGACY_CONTAINER_NAME':owner}):
                legacy.cleanup_workflow_owned()
            gone = subprocess.run(['docker','ps','-aq','--filter','name=^/'+owner+'$'],capture_output=True,env=env)
            kept = subprocess.run(['docker','ps','-aq','--filter','name=^/'+canary+'$',
                '--filter','label=gridex.auth-legacy.canary='+owner],capture_output=True,env=env)
            assert gone.returncode == kept.returncode == 0 and not gone.stdout.strip() and kept.stdout.strip()
    finally:
        if process is not None and process.poll() is None:
            process.kill();process.wait(timeout=10)
        with patch.dict(os.environ,{'GRIDEX_LEGACY_CONTAINER_NAME':owner}):
            legacy.cleanup_workflow_owned()
        if private_directory is not None:
            shutil.rmtree(private_directory)
        removed = subprocess.run(['docker','rm','-v',canary],capture_output=True,env=env)
        assert removed.returncode == 0
    if actual:
        deadline=time.monotonic()+15
        while True:
            try:restored=support.replay_originals_snapshot()==originals
            except OSError:restored=False
            if restored:break
            if time.monotonic()>deadline:raise BoundaryError('CONTROLLER_DEATH_RESTORATION_FAILED')
            time.sleep(.1)
    print('PASS '+('actual57' if actual else 'reduced')+' native commit plus controller SIGKILL; exact workflow-owned cleanup retains distinct canary')


def sql_main():
    def interrupted(signum,frame):
        raise BoundaryError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)
    signal.signal(signal.SIGINT,interrupted)
    started = time.monotonic()
    with legacy.OwnedPostgres() as h:
        repair.prepare_reference(h)
        proof = Proof(h)
        actual56(proof)
        canary = snapshot(proof,replay.DATABASE)
        for lane in (admission_negatives,native_constraints,characterization,failure_boundaries,concurrency_and_death,privacy):
            begin = time.monotonic()
            lane(proof)
            assert snapshot(proof,replay.DATABASE) == canary
            print('PASS dedupe lane='+lane.__name__+' milliseconds='+str(round((time.monotonic()-begin)*1000)),flush=True)
    support.cleanup_proof(repair)
    controller_death_cleanup()
    print('PASS complete standalone unpublished H2 native-COMMIT proof milliseconds='+str(round((time.monotonic()-started)*1000)))


def arguments(argv=None):
    parser = argparse.ArgumentParser(allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only', action='store_true')
    modes.add_argument('--cleanup-owned', action='store_true')
    return parser.parse_args(argv)


def integration_constructors():
    assert hasattr(replay, 'load_dedupe'), 'trusted reusable H2 loader missing'
    b = replay.load_dedupe()
    assert b.legacy is legacy and b.repair is repair
    assert b.validate_sources(b.reviewed_paths())[0].data == source_bytes((SOURCE,))
    order = json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    assert len(order) == 104 and order[56] == 'migrations/'+SOURCE.name
    assert replay.scope_flags('dedupe57') == ['--dedupe-prefix-proof']
    for flags in (['--dedupe-prefix'], ['--dedupe-prefix-proof','--repair-prefix-proof'],
                  ['--dedupe-prefix-proof','--foundation-prefix-proof'], ['--dedupe-prefix-proof','57']):
        result = subprocess.run([sys.executable, str(ROOT/'scripts/canonical-auth-provisioning-replay.py'), *flags], capture_output=True)
        assert result.returncode == 2
    for target in (None, object(), types.SimpleNamespace(active=True)):
        try: b.require_owned(target)
        except BoundaryError: pass
        else: raise AssertionError('duck typed target accepted')
    print('PASS H2 shared identity, exact104, named57 constructors; NO SQL claim')


def lifecycle_constructors():
    # These private registry fixtures exercise denial/disposal construction only.
    # They never call prepare_reference, promote accepted56, or claim SQL proof.
    b = dedupe
    with tempfile.TemporaryDirectory(prefix='dedupe-lifecycle-constructor-') as directory:
        hold=Path(directory)/'hold';hold.mkdir(mode=0o700)
        for path in (ROOT/'supabase/migrations').iterdir():
            if path.is_file(): shutil.copyfile(path,hold/path.name)
        h=legacy.OwnedPostgres();h.active=True;h.directory=types.SimpleNamespace(name=directory)
        h.reference=({},{});repair.REFERENCES[h]=repair.Reference(directory,{}, {})
        ref=b._Reference(directory,h.name,h.reference,repair.REFERENCES[h],{}, {},[])
        b._REFERENCES[h]=ref;b._STATES[h]='FRESH'
        try:
            loop=replay.FoundationLoop(legacy,h,'dedupe57')
            order=loop.order
            paths=[str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in order]
            original_open=Path.open
            def retained_only(path,*args,**kwargs):
                if path.parent==ROOT/'supabase/migrations': raise AssertionError('ROOT read after HOLD')
                return original_open(path,*args,**kwargs)
            with patch.object(Path,'open',retained_only):
                loop.validate(hold,paths)
                assert b.validate_sources(b.reviewed_paths(),legacy.StagedSources(hold))[0].data == (hold/SOURCE.name).read_bytes()
            for fake in (object(),types.SimpleNamespace(hold=hold)):
                try:b.validate_sources(b.reviewed_paths(),fake)
                except BoundaryError:pass
                else:raise AssertionError('duck staged reader accepted')
            b._REFERENCES.pop(h)
            try:
                try: b.require_owned(h)
                except BoundaryError: pass
                else: raise AssertionError('legacy/repair reference substituted for H2')
            finally: b._REFERENCES[h]=ref
            for which in ('legacy','repair','directory'):
                old=(h.reference,repair.REFERENCES[h],h.directory)
                try:
                    if which=='legacy':h.reference=({}, {})
                    if which=='repair':repair.REFERENCES[h]=repair.Reference(directory,{}, {})
                    if which=='directory':h.directory=types.SimpleNamespace(name=directory+'-wrong')
                    try:b.require_owned(h)
                    except BoundaryError:pass
                    else:raise AssertionError('replaced owned authority accepted')
                finally:h.reference,repair.REFERENCES[h],h.directory=old
            # A failed validation must terminally dispose even before first43 SQL.
            calls=[]
            with patch.object(b,'_dispose',side_effect=lambda target:calls.append(target)):
                try:loop.validate(hold,paths[::-1])
                except BoundaryError:pass
                else:raise AssertionError('reordered stage accepted')
            assert calls==[h] and b._STATES[h]=='DISPOSED', 'validation failure did not quarantine/dispose'
            for action in (lambda:loop.validate(hold,paths), lambda:loop.run(hold,paths),
                           lambda:b.require_live(h),lambda:b.fresh_target(h),
                           lambda:b.snapshot(h),lambda:b.index_details(h,replay.DATABASE),
                           lambda:b.execute(h,replay.DATABASE,b.reviewed_paths())):
                try:action()
                except BoundaryError:pass
                else:raise AssertionError('terminal target operation accepted')
            # Failed disposal leaves denial, never a falsely clean state.
            b._STATES[h]='FRESH'
            with patch.object(b,'_dispose',side_effect=BoundaryError('SYNTHETIC_DISPOSAL_FAILURE')):
                try:b.fail(h)
                except BoundaryError as error:assert str(error)=='REPLAY_TERMINAL_DISPOSAL_FAILED'
                else:raise AssertionError('failed disposal claimed success')
            assert b._STATES[h]=='TERMINAL'
            # Inspect exact constructed commands; no container/SQL process runs.
            calls=[]
            def docker(target,args,**kwargs):
                calls.append(args)
                if args[0]=='inspect':return (h.name+'\n').encode()
                if 'psql' in args:return b'0\n'
                return b''
            with patch.object(legacy.OwnedPostgres,'docker',docker):b.fail(h)
            assert b._STATES[h]=='DISPOSED'
            assert calls[1]==['exec',h.name,'dropdb','-U','postgres','--if-exists','--force',replay.DATABASE]
            assert len(calls)==3 and all('gridex_auth_legacy_reference' not in call for call in calls)
        finally:
            b._REFERENCES.pop(h,None);b._STATES.pop(h,None);repair.REFERENCES.pop(h,None)
            h.active=False;h.directory=None
    key='user_rbac_dedupe_batch';saved=sys.modules[key]
    try:
        copied=types.ModuleType(key);copied.__dict__.update(saved.__dict__)
        for fake in (types.ModuleType(key),copied):
            sys.modules[key]=fake
            try:replay.load_dedupe()
            except RuntimeError:pass
            else:raise AssertionError('forged H2 module accepted')
    finally:sys.modules[key]=saved
    print('PASS lifecycle/staged/source/reference/terminal/disposal constructors; NO SQL claim')


def run_stage_fault(mode,hold,paths,operation):
    """Mutate one staged H2 view, then restore its exact filesystem metadata."""
    hold=Path(hold);path=hold/SOURCE.name
    hold_stat=hold.stat();source_stat=path.stat();raw=path.read_bytes()
    try:
        if mode=='stage_missing':path.unlink()
        elif mode=='stage_substituted':path.write_bytes(raw+b'\n')
        return operation(paths[::-1] if mode=='stage_order' else paths)
    finally:
        path.write_bytes(raw)
        os.chmod(path,source_stat.st_mode)
        os.utime(path,ns=(source_stat.st_atime_ns,source_stat.st_mtime_ns))
        os.utime(hold,ns=(hold_stat.st_atime_ns,hold_stat.st_mtime_ns))


def expect_actual57_failure(mode,operation):
    try:operation()
    except BoundaryError:return
    except OSError:
        if mode=='transport':return
        raise
    raise AssertionError('failed replay returned success')


def fix_review_regressions():
    """Bounded real-filesystem and failure-classification review regressions."""
    raw = b'synthetic staged H2 bytes\n'
    paths = ['first', 'second', 'third']
    with tempfile.TemporaryDirectory(prefix='dedupe-fix-review-') as directory:
        hold = Path(directory)/'HOLD';hold.mkdir(mode=0o700)
        staged = hold/SOURCE.name
        staged.write_bytes(raw);os.chmod(staged,0o640)
        for index, mode in enumerate(('stage_missing','stage_order','stage_substituted')):
            stamp = 1_700_000_000_000_000_000 + index*10
            os.utime(staged,ns=(stamp,stamp+1));os.utime(hold,ns=(stamp+2,stamp+3))
            source_before=staged.stat();hold_before=hold.stat();observed=[]
            fault=BoundaryError('EXPECTED_STAGE_FAULT')
            def inspect_fault(selected):
                observed.append(selected)
                if mode=='stage_missing':assert not staged.exists()
                elif mode=='stage_substituted':assert staged.read_bytes()==raw+b'\n'
                else:assert staged.read_bytes()==raw
                raise fault
            try:run_stage_fault(mode,hold,paths,inspect_fault)
            except BoundaryError as caught:assert caught is fault
            else:raise AssertionError('staged fault did not reject replay')
            assert observed==[paths[::-1] if mode=='stage_order' else paths]
            source_after=staged.stat();hold_after=hold.stat()
            assert (source_after.st_mode,source_after.st_atime_ns,source_after.st_mtime_ns)==(
                source_before.st_mode,source_before.st_atime_ns,source_before.st_mtime_ns)
            assert (hold_after.st_mode,hold_after.st_atime_ns,hold_after.st_mtime_ns)==(
                hold_before.st_mode,hold_before.st_atime_ns,hold_before.st_mtime_ns)
            assert staged.read_bytes()==raw
    assert expect_actual57_failure('catalog',lambda:(_ for _ in ()).throw(BoundaryError('EXPECTED'))) is None
    for error in (OSError('transport'),BrokenPipeError('transport')):
        assert expect_actual57_failure('transport',lambda error=error:(_ for _ in ()).throw(error)) is None
    other_modes=('stage_missing','stage_order','stage_substituted','catalog','pop_active',
                 'pop_inactive','pop_null','pop_other','pre_commit','post_commit','final_check',
                 'row_change','sequence_change','backend','shell_failure','restore_failure','suffix')
    for mode in other_modes:
        error=OSError(mode)
        try:expect_actual57_failure(mode,lambda error=error:(_ for _ in ()).throw(error))
        except OSError as caught:assert caught is error
        else:raise AssertionError('non-transport OSError accepted')
    unexpected=TypeError('unexpected')
    try:expect_actual57_failure('transport',lambda:(_ for _ in ()).throw(unexpected))
    except TypeError as caught:assert caught is unexpected
    else:raise AssertionError('unexpected transport failure accepted')
    try:expect_actual57_failure('transport',lambda:None)
    except AssertionError as error:assert str(error)=='failed replay returned success'
    else:raise AssertionError('successful operation accepted as failure')
    print('PASS Task14 review regressions: exact staged metadata and narrow transport failure; NO SQL claim')


def actual57_case(mode):
    """Real whole shell replay; external controller faults never edit H2 SQL."""
    import threading
    import socket
    original_files=support.replay_originals_snapshot()
    seed=ROOT/'supabase/seed.sql';seed_stat=seed.stat();seed_bytes=seed.read_bytes()
    artifacts=ROOT/'artifacts/replay-input-accounting.json'
    artifact_before=artifacts.read_bytes() if artifacts.exists() else None
    with legacy.OwnedPostgres() as h:
        dedupe.prepare_reference(h)
        ref=dedupe._REFERENCES[h]
        legacy_ref=h.reference;repair_ref=repair.REFERENCES[h]
        canary_db='gridex_auth_legacy_seeded'
        h.reset(canary_db)
        h.sql(canary_db,'CREATE TABLE public.canary(value text); INSERT INTO public.canary VALUES (\'retain\');','canary')
        canary=support.snapshot(repair,h,canary_db)
        original_validate=replay.FoundationLoop.validate
        original_legacy=legacy.execute;original_repair=repair.execute
        original_native=h.run_files;original_dispose=dedupe._dispose;original_final=dedupe.assert_final
        reached=[];preimages=[];disposed=[];threads=[];failures=[]
        def validate(loop,hold,paths):
            if mode.startswith('stage_'):
                return run_stage_fault(mode,hold,paths,
                                       lambda staged:original_validate(loop,hold,staged))
            return original_validate(loop,hold,paths)
        def legacy_once(target,database,paths,staging=None):
            assert target is h and database==replay.DATABASE and type(staging) is legacy.StagedSources
            assert reached==[];reached.append('legacy')
            return original_legacy(target,database,paths,staging)
        def repair_once(target,database,paths,staging=None):
            assert reached==['legacy'];reached.append('repair')
            result=original_repair(target,database,paths,staging)
            assert repair.catalog(h,database)==ref.base
            h.sql(database,canaries(),'actual57_canaries')
            # Use a real source-created sequence without changing the admitted catalog.
            h.sql(database,"SELECT setval('auth.refresh_tokens_id_seq',41,false);"+
                  ("SELECT nextval('auth.refresh_tokens_id_seq');" if mode=='success_called' else ''),'actual57_sequence')
            if mode=='catalog':h.sql(database,'ALTER TABLE public.user_roles ADD COLUMN unexpected text;','wrong_catalog')
            populated={'pop_active':row(1,'active'), 'pop_inactive':row(2,None,status='disabled',active=False),
                       'pop_null':row(3,None,role_id=None), 'pop_other':row(4,None,user=U2,company=C2)}
            if mode in populated:insert_rows(h,database,[populated[mode]])
            preimages.append(support.snapshot(repair,h,database))
            return result
        def dispose(target):
            assert target is h and dedupe._STATES[h]=='TERMINAL'
            # Only this private test controller can inspect committed state before disposal.
            current=support.snapshot(repair,h,replay.DATABASE)
            disposed.append(current)
            if mode in ('post_commit','final_check','transport','backend','shell_failure','restore_failure','suffix'):
                assert current==(ref.final,preimages[0][1]), 'committed H2 effects not retained before disposal'
            if mode=='pre_commit':
                assert current[1]==preimages[0][1]
                assert all('index/public.'+name not in current[0] for name in INDEX_NAMES)
            if mode in ('row_change','sequence_change'):
                assert current[0]==ref.final and current[1]!=preimages[0][1]
            original_dispose(target)
            assert h.sql(canary_db,"SELECT count(*) FROM pg_database WHERE datname='gridex_auth_legacy_replay';",'disposed').strip()=='0'
        def native(database,files,stage,*args,**kwargs):
            if stage!='dedupe_native':return original_native(database,files,stage,*args,**kwargs)
            assert reached==['legacy','repair'];reached.append('H2')
            assert kwargs.get('transaction') is False and len(files)==1
            assert hashlib.sha256(files[0].read_bytes()).hexdigest()==SHA256
            if mode=='pre_commit':
                h.sql(database,"CREATE FUNCTION public.dedupe_external_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='SYNTHETIC_FAILURE'; END $$; CREATE TRIGGER dedupe_external_fail BEFORE DELETE ON public.user_roles FOR EACH STATEMENT EXECUTE FUNCTION public.dedupe_external_fail();",'external_precommit_hook')
            if mode=='post_commit':files=[*files,h.private('external-postcommit.sql',sentinel_sql())]
            if mode=='backend':
                files=[h.private('external-appname.sql',"SET application_name='dedupe_integration_death';"),*files,h.private('external-pause.sql','SELECT pg_sleep(30);')]
                def terminate():
                    try:
                        support.observed(h,database,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='dedupe_integration_death' AND wait_event='PgSleep')")
                        assert support.snapshot(repair,h,database)==(ref.final,preimages[0][1])
                        support.private_query(h,database,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='dedupe_integration_death'")
                    except BaseException as error:failures.append(type(error).__name__)
                thread=threading.Thread(target=terminate);thread.start();threads.append(thread)
            result=original_native(database,files,stage,**kwargs)
            if mode=='row_change':h.sql(database,"UPDATE auth.users SET raw_user_meta_data='{}' WHERE id='"+U+"';",'external_row_change')
            if mode=='sequence_change':h.sql(database,"SELECT nextval('auth.refresh_tokens_id_seq');",'external_sequence_change')
            return result
        def final(target):
            original_final(target)
            if mode=='final_check':raise BoundaryError('TRUSTED_FINAL_FAILURE')
        original_send=socket.socket.sendall
        def send(connection,data,*args,**kwargs):
            if mode=='transport' and dedupe._STATES.get(h)=='H2_COMPLETE':
                connection.shutdown(socket.SHUT_RDWR)
            return original_send(connection,data,*args,**kwargs)
        # The wrapper actually runs the shell, then attacks all RPC operations
        # after a rejected source call; it records only rejection booleans.
        wrapper='''import importlib.util,json,os,subprocess,sys
spec=importlib.util.spec_from_file_location('integration_client',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
result=subprocess.run(['bash',sys.argv[2],'--dedupe-prefix-proof'])
if result.returncode:
 rejected=[]
 for operation in ('context','validate_foundation','foundation','sql'):
  try:m.request({'operation':operation,'scope':'dedupe57','hold':'/not-owned','paths':[],'sql':'CREATE TABLE public.unusable_target(value text);'})
  except Exception:rejected.append(operation)
 with open(sys.argv[3],'w') as stream:json.dump(rejected,stream)
 sys.exit(result.returncode)
if sys.argv[4]=='shell_failure':sys.exit(73)
if sys.argv[4]=='suffix':
 try:m.request({'operation':'sql','scope':'dedupe57','sql':'SELECT 1;'})
 except Exception:sys.exit(74)
'''
        rejected=Path(h.directory.name)/'rejected.json'
        command=[sys.executable,'-c',wrapper,str(ROOT/'scripts/canonical-auth-provisioning-replay.py'),str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),str(rejected),mode]
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(replay.FoundationLoop,'validate',validate))
            stack.enter_context(patch.object(legacy,'execute',legacy_once))
            stack.enter_context(patch.object(repair,'execute',repair_once))
            stack.enter_context(patch.object(h,'run_files',native))
            stack.enter_context(patch.object(dedupe,'_dispose',dispose))
            stack.enter_context(patch.object(dedupe,'assert_final',final))
            stack.enter_context(patch.object(socket.socket,'sendall',send))
            if mode=='restore_failure':
                # Fail the real shell's seed restore copy, preserving its recovery copy.
                hooks=Path(h.directory.name)/'hooks';hooks.mkdir(mode=0o700)
                cp=hooks/'cp';real_cp=shutil.which('cp')
                cp.write_text('#!/usr/bin/env python3\nimport os,sys\nif sys.argv[-1]=='+repr(str(seed))+':sys.exit(77)\nos.execv('+repr(real_cp)+',['+repr(real_cp)+',*sys.argv[1:]])\n');cp.chmod(0o700)
                tmp=Path(h.directory.name)/'restore-tmp';tmp.mkdir(mode=0o700)
                stack.enter_context(patch.dict(os.environ,{'PATH':str(hooks)+os.pathsep+os.environ['PATH'],'TMPDIR':str(tmp)}))
            try:
                if mode.startswith('success'):
                    assert replay.serve_child(legacy,h,command,'dedupe57')==0
                    assert reached==['legacy','repair','H2'] and not disposed
                    assert support.snapshot(repair,h,replay.DATABASE)==(ref.final,preimages[0][1])
                    seq=[value for name,value in preimages[0][1] if name=='auth.refresh_tokens_id_seq']
                    assert len(seq)==1 and seq[0]['last_value']==41
                    assert seq[0]['is_called'] is (mode=='success_called')
                    assert dedupe._STATES[h]=='SUCCEEDED'
                else:
                    def failed_operation():
                        # The frozen historical scope now proves its suffix
                        # boundary through the real shell and a harmless denied
                        # post-foundation SQL request, never a full-scope rearm.
                        return replay.serve_child(legacy,h,command,'dedupe57')
                    expect_actual57_failure(mode,failed_operation)
                    assert dedupe._STATES[h]=='DISPOSED' and len(disposed)==1
                    if mode not in ('transport','shell_failure','restore_failure','suffix'):
                        assert json.loads(rejected.read_text())==['context','validate_foundation','foundation','sql']
                    for action in (lambda:dedupe.require_live(h),lambda:dedupe.fresh_target(h),
                                   lambda:replay.FoundationLoop(legacy,h,'dedupe57')):
                        try:action()
                        except BoundaryError:pass
                        else:raise AssertionError('failed handle reused')
            finally:
                for thread in threads:thread.join(timeout=10)
                assert not failures and all(not t.is_alive() for t in threads)
                if mode=='restore_failure':
                    copies=[p for p in tmp.iterdir() if p.is_file() and p.read_bytes()==seed_bytes]
                    assert len(copies)==1 and seed.read_bytes()==b''
                    shutil.copyfile(copies[0],seed);os.chmod(seed,seed_stat.st_mode)
                    os.utime(seed,ns=(seed_stat.st_atime_ns,seed_stat.st_mtime_ns))
        assert support.snapshot(repair,h,canary_db)==canary
        assert h.reference is legacy_ref and repair.REFERENCES[h] is repair_ref and dedupe._REFERENCES[h] is ref
        assert not (Path(h.directory.name)/'replay.sock').exists()
        assert support.replay_originals_snapshot()==original_files
        assert (artifacts.read_bytes() if artifacts.exists() else None)==artifact_before
        h.verify_logging()
    print('PASS actual57 mode='+mode+'; same owned target, exact disposal/restoration/canary and private receipts',flush=True)


def actual57_integration():
    modes=('success','stage_missing','stage_order','stage_substituted','catalog',
           'pop_active','pop_inactive','pop_null','pop_other','pre_commit','post_commit',
           'final_check','row_change','sequence_change','transport','backend','shell_failure','restore_failure','suffix','success_called')
    for mode in modes:actual57_case(mode)
    controller_death_cleanup(actual=True)
    print('PASS actual57 fresh reconstruction after every terminal failure; all19 integration authored independently of standalone lanes')



def main():
    args = arguments()
    if args.cleanup_owned:
        legacy.cleanup_workflow_owned()
        return
    integration_constructors()
    lifecycle_constructors()
    fix_review_regressions()
    constructors()
    oracle_constructors()
    workflow_constructors()
    if not args.selection_only:
        sql_main()
        actual57_integration()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        print('FAIL dedupe proof category=UNEXPECTED_RESULT type='+type(error).__name__, file=sys.stderr)
        sys.exit(1)
