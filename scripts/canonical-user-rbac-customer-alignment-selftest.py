#!/usr/bin/env python3
"""Standalone actual63 customer-alignment characterization; never selection."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    path = ROOT/'scripts'/filename
    assert path.is_file(), 'CUSTOMER_ALIGNMENT_IMPLEMENTATION_REQUIRED'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Constructors(unittest.TestCase):
    def test_boundary_privilege_probe_rejects_commit_before_reader(self):
        try:
            with self.assertRaises(batch.BoundaryError):
                AlignmentProof.envelope(None, None, None, None,
                                        rollback=False, fault='boundary_privileges')
        except AttributeError:
            self.fail('commit-capable privilege probe reached owner/reader setup')

    def test_source_input_order_and_hashes_reject_mismatch(self):
        b = load('alignment_batch_test', 'canonical-user-rbac-customer-alignment-batch.py')
        sources = b.validate_sources(b.reviewed_paths())
        self.assertEqual(tuple(s.key for s in sources), ('P', 'A', 'B', 'C', 'W'))
        with self.assertRaises(b.BoundaryError):
            b.validate_sources(tuple(reversed(b.reviewed_paths())))
        self.assertEqual(sum(s.key in ('A', 'B', 'C') for s in sources), 3)
        self.assertEqual(len(b.index_declarations(sources)), 57)
        self.assertEqual(len(b.model.DML_TABLES), 19)

    def test_json_payload_equality_and_empty_standard_match_sql(self):
        m = load('alignment_model_edges', 'canonical-user-rbac-customer-alignment-oracles.py')
        for parsed in ([], False, 0, ''):
            row = dict(id='1', test_suite='s', role_code='r', test_case_code='c',
                       payload={'kept': 1}, parsed_payload=parsed)
            self.assertEqual(m.apply_a([row])[0]['parsed_payload'], parsed)
        row = dict(id='1', message_family='F', message_code='C', message_standard='',
                   direction='both', is_active=True, valid_from=None, valid_to=None, created_at=None)
        self.assertEqual(m.rule_groups([row], 'f', 'c', standard='', date=None), [[row]])
        self.assertEqual(m.rule_groups([row], 'f', 'c', standard=None, date=None), [])

    def test_changed_source_bytes_and_invalid_stages_are_rejected(self):
        from unittest.mock import patch
        sources = batch.validate_sources(batch.reviewed_paths())
        original = batch.repair.read_source
        def changed(path, *args):
            data = original(path, *args)
            return data + b'-- unexpected\n' if path == sources[1].path else data
        with patch.object(batch.repair, 'read_source', side_effect=changed):
            with self.assertRaises(batch.BoundaryError):
                batch.validate_sources(batch.reviewed_paths())
        for previous, stage in (('P', 'C'), ('C', 'C'), ('W', 'A')):
            with self.assertRaises(batch.BoundaryError):
                batch.stage_sql(previous, stage)

    def test_guarded_meter_index_alternatives_are_independent(self):
        sources = batch.validate_sources(batch.reviewed_paths())
        items = [item for item in batch.index_declarations(sources) if item[1].startswith('metering_values_customer_company_')]
        base = {'relation/public.metering_values': {'kind': 'r'},
                'column/public.metering_values/customer_id': {},
                'column/public.metering_values/company_id': {},
                'column/public.metering_values/created_at': {}}
        self.assertEqual([i[1] for i in items if batch.index_selected(i, base)], ['metering_values_customer_company_created_idx'])
        base['column/public.metering_values/read_at'] = {}
        self.assertEqual([i[1] for i in items if batch.index_selected(i, base)], ['metering_values_customer_company_read_idx'])
        del base['column/public.metering_values/company_id']
        self.assertEqual([i for i in items if batch.index_selected(i, base)], [])

    def test_owner_and_same_shaped_release_forgery_fail_before_any_reader(self):
        from unittest.mock import patch
        import tempfile
        with self.assertRaises(batch.BoundaryError):
            AlignmentProof(object())
        h = legacy.OwnedPostgres()
        with self.assertRaises(batch.BoundaryError):
            AlignmentProof(h)
        with tempfile.TemporaryDirectory(prefix='alignment-constructor-') as directory:
            h.directory = type('ConstructorDirectory', (), {'name': directory})()
            h.active = True
            h.reference = ({}, {})
            rref = repair.Reference(directory, {}, {})
            dref = dedupe._Reference(directory, h.name, h.reference, rref, {}, {}, [], True, 'fixed-target')
            inputs = core.AcceptedInputs(h)
            inputs.closed = True
            fref = fixed.Reference(h.name, directory, dref, b'{}', None, inputs, ())
            released = fixed.Reservation(fref, b'{}', b'{}', 'constructor')
            repair.REFERENCES[h] = rref
            dedupe._REFERENCES[h] = dref
            dedupe._STATES[h] = 'SUCCEEDED'
            fixed._REFERENCES[h] = fref
            fixed._RUNS[h] = released
            fixed._RELEASES[h] = copy.copy(released)
            try:
                with patch.object(AlignmentProof, 'query', side_effect=AssertionError('UNEXPECTED_NATIVE_READER')):
                    with self.assertRaises(batch.BoundaryError):
                        AlignmentProof(h)
            finally:
                for mapping in (repair.REFERENCES, dedupe._REFERENCES, dedupe._STATES,
                                fixed._REFERENCES, fixed._RUNS, fixed._RELEASES):
                    mapping.pop(h, None)
                h.active = False

    def test_full_row_oracle_preserves_unknown_fields_and_rejects_extra_parent(self):
        row = dict(id='1', company_id=None, customer_id='p', preserved={'payload': [1, 2]})
        state = {'customer_sites': [row], 'customers': [dict(id='p', company_id='A')]}
        result = batch.model.backfills(state, 'B', 'now')
        self.assertEqual(result['customer_sites'][0], dict(row, company_id='A'))
        self.assertIsNone(state['customer_sites'][0]['company_id'])
        state['customers'].append(dict(id='p', company_id='B'))
        with self.assertRaisesRegex(ValueError, 'NONUNIQUE_PARENT_REJECTED'):
            batch.model.backfills(state, 'B', 'now')

    def test_global_null_role_loser_is_rejected_for_lossless_admission(self):
        m = load('alignment_model_test', 'canonical-user-rbac-customer-alignment-oracles.py')
        rows = [dict(id=str(i), test_suite='s', role_code=None, test_case_code='c',
                     company_id=str(i), is_active=i == 1, updated_at=None,
                     created_at='2020-01-01T00:00:00+00:00', payload={'old': i},
                     parsed_payload={}) for i in (1, 2)]
        self.assertEqual(m.a_losers(rows), [rows[0]])
        with self.assertRaisesRegex(ValueError, 'A6_LOSS_REJECTED'):
            m.admit_a(rows)
        result = m.apply_a(rows)
        self.assertEqual([r['id'] for r in result], ['2'])
        self.assertEqual(result[0]['parsed_payload'], {'old': 2})
        self.assertEqual(rows[1]['parsed_payload'], {})

    def test_b_preservation_and_c_metering_overwrite_are_distinct(self):
        m = load('alignment_model_test', 'canonical-user-rbac-customer-alignment-oracles.py')
        state = {'customer_sites': [dict(id='site', customer_id='parent', company_id=None)],
                 'metering_points': [dict(id='point', site_id='site', customer_id='child',
                                          company_id=None, updated_at=None)]}
        b = m.backfills(state, 'B', 'now')
        self.assertEqual(b['metering_points'][0]['customer_id'], 'child')
        c = m.backfills(b, 'C', 'now')
        self.assertEqual(c['metering_points'][0]['customer_id'], 'parent')
        self.assertEqual(c['metering_points'][0]['updated_at'], 'now')
        self.assertIsNone(c['metering_points'][0]['company_id'])

    def test_counts_preserve_explicit_total_duplicate_none_and_unknown(self):
        m = load('alignment_model_test', 'canonical-user-rbac-customer-alignment-oracles.py')
        self.assertEqual(m.aggregate_counts([('all', 5), ('none', 1), ('none', 1),
                                            ('active', 2), ('unknown', 1)]),
                         {'all': 5, 'none': 2, 'active': 2})
        for rows in ([('all', 1), ('all', 1)], [('none', 1)], [('all', 2), ('none', 1)],
                     [('all', True), ('none', 1)], [('all', 2**53), ('none', 2**53)]):
            with self.assertRaises(ValueError):
                m.aggregate_counts(rows)


# Native-only classes follow constructors. No batch/runtime module imports them.
import argparse
import contextlib
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
import os
import re
import select
import subprocess
import signal
import time
import uuid

batch = load('alignment_batch_native', 'canonical-user-rbac-customer-alignment-batch.py')
core = load('alignment_private_reader', 'canonical-user-rbac-fixed-target-selftest.py')
fixed = batch.replay.load_fixed()
legacy, repair, dedupe = batch.legacy, batch.repair, batch.replay.load_dedupe()
check = batch.check
REFERENCE = 'gridex_auth_legacy_helper'
TARGET = 'gridex_auth_legacy_native'
ORACLE = 'gridex_auth_legacy_dirty'
ATOMIC = 'gridex_auth_legacy_atomic'
LOCK = 'gridex_auth_legacy_lock'
CANARY = core.CANARY


@dataclass(frozen=True, repr=False)
class Reservation:
    database: str
    generation: str
    case: str
    before: bytes


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def rows_equal(a, b):
    return sorted(map(encoded, a)) == sorted(map(encoded, b))


def boundary_privilege_probe():
    """Post-C test-only grants; whole W must remove them before role disposal."""
    before = '''CREATE ROLE alignment_boundary_inherited NOLOGIN;
GRANT alignment_boundary_inherited TO authenticated WITH INHERIT TRUE;
REVOKE ALL ON FUNCTION public.gridex_get_user_roles(uuid) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_get_user_roles(uuid) TO alignment_boundary_inherited;
REVOKE ALL ON TABLE public.gridex_debug_batch2_rbac_v FROM PUBLIC,authenticated,service_role;
GRANT SELECT(company_id) ON public.gridex_debug_batch2_rbac_v TO alignment_boundary_inherited;
GRANT SELECT(company_name) ON public.gridex_debug_batch2_rbac_v TO service_role;
DO $$ BEGIN
 IF NOT pg_has_role('authenticated','alignment_boundary_inherited','USAGE')
 OR NOT has_function_privilege('authenticated','public.gridex_get_user_roles(uuid)','EXECUTE')
 OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.oid='public.gridex_get_user_roles(uuid)'::regprocedure AND a.privilege_type='EXECUTE'
  AND a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname='authenticated')))
 OR NOT has_column_privilege('authenticated','public.gridex_debug_batch2_rbac_v','company_id','SELECT')
 OR NOT has_column_privilege('service_role','public.gridex_debug_batch2_rbac_v','company_name','SELECT')
 OR has_table_privilege('authenticated','public.gridex_debug_batch2_rbac_v','SELECT')
 OR has_table_privilege('service_role','public.gridex_debug_batch2_rbac_v','SELECT') THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_PRIVILEGE_PROBE_PATH_REQUIRED'; END IF;
END $$;'''
    after = '''DO $$ DECLARE actor text; BEGIN
 IF NOT pg_has_role('authenticated','alignment_boundary_inherited','USAGE') THEN
 RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_PROBE_MEMBERSHIP_PRESERVED'; END IF;
 FOREACH actor IN ARRAY ARRAY['authenticated','service_role','alignment_boundary_inherited'] LOOP
  IF has_function_privilege(actor,'public.gridex_get_user_roles(uuid)','EXECUTE')
  OR has_table_privilege(actor,'public.gridex_debug_batch2_rbac_v','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR has_any_column_privilege(actor,'public.gridex_debug_batch2_rbac_v','SELECT,INSERT,UPDATE,REFERENCES') THEN
   RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='ALIGNMENT_W_EFFECTIVE_PRIVILEGE_REQUIRED'; END IF;
 END LOOP;
END $$;
REVOKE alignment_boundary_inherited FROM authenticated;
DROP ROLE alignment_boundary_inherited;'''
    return before, after


class AlignmentProof(core.Proof):
    """Exact owned actual63 reference and isolated terminal control databases.

    Reuses accepted memory query transport, never rearms the published original
    or substitutes a reduced prefix. Every native source run has a fresh clone.
    """
    def __init__(self, h):
        repair.require_owned(h)
        dedupe.require_owned(h)
        self.h, self.name, self.directory = h, h.name, h.directory.name
        self.references = h.reference, repair.REFERENCES[h], dedupe._REFERENCES[h]
        self.fixed_reference = fixed._REFERENCES.get(h)
        self.fixed_release = fixed._RELEASES.get(h)
        self.reservations, self.terminal = {}, set()
        self.sources = batch.validate_sources(batch.reviewed_paths())
        self.accepted_inputs = self.fixed_reference.inputs if type(self.fixed_reference) is fixed.Reference else None
        self.owned(batch.replay.DATABASE)
        # The helper was built independently from selected prefix and source-only
        # R2/E2/S2/H2 declarations. Add exactly the fixed prerequisite source delta,
        # without rerunning fixed identities or using restoration X as an oracle.
        self.query(REFERENCE, "ALTER TABLE public.companies ADD COLUMN industry text NOT NULL DEFAULT 'electricity_supplier'; ALTER TABLE public.company_memberships ADD COLUMN suspended_at timestamptz;")
        independently_constructed = self.snapshot(REFERENCE)[0]
        self.origin = self.snapshot(batch.replay.DATABASE)
        expected = fixed.decoded(self.fixed_release.s1)
        check(self.origin[0] == independently_constructed, 'ALIGNMENT_INDEPENDENT_ACTUAL63_CATALOG')
        check({k: v for k, v in self.origin[0].items() if not k.startswith('alignment_')} == expected[0]
              and rows_equal(self.origin[1], expected[1]), 'ALIGNMENT_SOURCE_BACKED_ACTUAL63_REQUIRED')
        self.reference = encoded((independently_constructed, expected[1]))
        self.canary = self.snapshot(CANARY)
        self.graph(self.origin[0])
        self.bind_diagnostic()

    def owned(self, database):
        repair.require_owned(self.h)
        dedupe.require_owned(self.h)
        legacy.validate_database(database)
        check(type(self.h) is legacy.OwnedPostgres and self.h.name == self.name
              and self.h.directory.name == self.directory and self.h._created_name == self.name,
              'ALIGNMENT_EXACT_OWNER_REQUIRED')
        check(dedupe._STATES.get(self.h) == 'SUCCEEDED'
              and self.references[2].scope == 'fixed-target'
              and all(a is b for a, b in zip(self.references,
                    (self.h.reference, repair.REFERENCES.get(self.h), dedupe._REFERENCES.get(self.h)))),
              'ALIGNMENT_UNCHANGED_RELEASE_REQUIRED')
        check(type(self.fixed_reference) is fixed.Reference
              and fixed._REFERENCES.get(self.h) is self.fixed_reference
              and self.fixed_reference.dedupe is self.references[2]
              and type(self.fixed_release) is fixed.Reservation
              and self.fixed_release.reference is self.fixed_reference
              and fixed._RUNS.get(self.h) is self.fixed_release
              and fixed._RELEASES.get(self.h) is self.fixed_release
              and type(self.accepted_inputs) is core.AcceptedInputs
              and self.accepted_inputs is self.fixed_reference.inputs
              and self.accepted_inputs.closed and not self.accepted_inputs.active,
              'ALIGNMENT_FROZEN_RELEASE_IDENTITY')
        check(database not in self.terminal, 'ALIGNMENT_TERMINAL_TARGET')

    def snapshot(self, database):
        sql = "SELECT 'ALIGNMENT_CATALOG';\n" + batch.catalog.sql(repair)
        sql += "\nSELECT 'ALIGNMENT_ROWS';\n" + batch.rows_sql()
        sql += "\nSELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows; DROP TABLE alignment_rows;"
        lines = self.query(database, sql).splitlines()
        check(lines.count('ALIGNMENT_CATALOG') == lines.count('ALIGNMENT_ROWS') == 1, 'ALIGNMENT_SNAPSHOT_REQUIRED')
        return json.loads(lines[lines.index('ALIGNMENT_CATALOG') + 1]), json.loads(lines[lines.index('ALIGNMENT_ROWS') + 1])

    def bind_diagnostic(self):
        source = batch.diagnostic_source()
        check("('customer_import_batches')" in source, 'ALIGNMENT_SELECTED_VIEW_REQUIRED')
        # Independent canonical parser normalization, on its own reference DB.
        before = self.snapshot(REFERENCE)[0]
        self.query(REFERENCE, source)
        check(self.snapshot(REFERENCE)[0] == before, 'ALIGNMENT_SELECTED_VIEW_BODY_MISMATCH')
        owner = self.origin[0]['relation/' + batch.DIAGNOSTIC]['owner']
        check(owner == 'postgres', 'ALIGNMENT_DIAGNOSTIC_OWNER_REQUIRED')

    def graph(self, shape):
        write = {'public.' + table for table in batch.model.DML_TABLES}
        source = repair.read_source(batch.ROOT/'supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql').decode()
        body = re.search(r'create or replace function public\.gridex_assert_company_operational_for_write\(\).*?as \$\$(.*?)\$\$;', source, re.S)
        check(body is not None, 'ALIGNMENT_TRIGGER_SOURCE_REQUIRED')
        for key, value in shape.items():
            if key.startswith('event_trigger/'):
                check(value['enabled'] == 'D', 'ALIGNMENT_EVENT_TRIGGER_REJECTED')
            if key.startswith('trigger/') and key.split('/')[1] in write:
                definition = value['definition']
                check(value['enabled'] == 'O' and 'BEFORE INSERT OR UPDATE OF company_id' in definition
                      and 'gridex_assert_company_operational_for_write()' in definition,
                      'ALIGNMENT_UNKNOWN_WRITE_TRIGGER')
                functions = [v for k, v in shape.items() if k.startswith('function/public.gridex_assert_company_operational_for_write(')]
                check(len(functions) == 1 and body[1] in functions[0]['definition'], 'ALIGNMENT_TRIGGER_BODY_MISMATCH')
            if key.startswith('rule/') and key.split('/')[1] in write:
                raise batch.BoundaryError('ALIGNMENT_UNKNOWN_WRITE_RULE')
            if key.startswith('relation/') and key.split('/')[1] in write:
                check(value['kind'] == 'r', 'ALIGNMENT_ORDINARY_TARGET_REQUIRED')
        # Entire actual independently bound catalog covers all FK parents, checks,
        # domains, incoming actions, dependency identities and effective role graph.
        # A controlled fixture may add only explicitly modeled test probes.

    def clone(self, database, case):
        check(database in (TARGET, ORACLE, ATOMIC, LOCK), 'ALIGNMENT_CONTROL_DATABASE_REQUIRED')
        self.owned(database)
        check(database not in self.reservations, 'ALIGNMENT_FRESH_RESERVATION_REQUIRED')
        check(encoded(self.snapshot(batch.replay.DATABASE)) == encoded(self.origin), 'ALIGNMENT_IMMUTABLE_ORIGIN_CHANGED')
        self.h.docker(['exec', self.name, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database])
        self.h.docker(['exec', self.name, 'createdb', '-U', 'postgres', '-T', batch.replay.DATABASE, database])
        self.identity(database)
        before = self.snapshot(database)
        check(encoded(before) == encoded(self.origin), 'ALIGNMENT_ACTUAL63_CLONE_REQUIRED')
        self.reservations[database] = Reservation(database, uuid.uuid4().hex, case, encoded(before))
        return database

    def destroy(self, database):
        check(database in self.reservations, 'ALIGNMENT_RESERVATION_REQUIRED')
        terminal = database in self.terminal
        self.terminal.discard(database)
        try:
            super().destroy(database)
        finally:
            if terminal:
                self.terminal.add(database)

    def dispose(self, database):
        # Every fault/sequence discrepancy consumes the reservation. A fresh
        # generation clones the untouched prefix; never reset a sequence.
        self.terminal.add(database)
        self.destroy(database)

    def fresh_generation(self, database, case):
        check(database not in self.reservations, 'ALIGNMENT_DISPOSAL_REQUIRED')
        self.terminal.discard(database)
        return self.clone(database, case)

    def expected(self, before, setup=''):
        self.fresh_generation(ORACLE, 'independent-source-oracle')
        try:
            if setup:
                self.query(ORACLE, setup)
            reference_before = self.snapshot(ORACLE)
            check(reference_before[0] == before[0], 'ALIGNMENT_INDEPENDENT_FIXTURE_CATALOG')
            # Independent source declaration path contains no historical DML or W.
            self.query(ORACLE, batch.expected_ddl(self.sources, before[0]))
            result = self.snapshot(ORACLE)[0]
            return copy.deepcopy(result)
        finally:
            self.destroy(ORACLE)

    def run_inputs(self, database, prelude, files, timeout=120):
        self.owned(database)
        check(database in self.reservations, 'ALIGNMENT_PRIVATE_RESERVATION_REQUIRED')
        self.h.verify_logging()
        command = self.h.command(database, transaction=True) + ['-f', '-']
        for path in files:
            check(type(path) is type(Path(self.directory)) and path.parent == Path(self.directory)
                  and path.is_file() and not path.is_symlink() and path.stat().st_uid == os.getuid(),
                  'ALIGNMENT_EXACT_PRIVATE_INPUT')
            command += ['-f', '/legacy-private/' + path.name]
        process = None
        lower = datetime.now(timezone.utc)
        payload = bytearray(prelude.encode())
        try:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=legacy.clean_environment())
            self.h.processes.append(process)
            process.stdin.write(b"SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET log_min_messages=panic; SELECT 'FIXED_PRIVATE_READY' WHERE current_setting('log_min_messages')='panic' AND current_setting('log_min_error_statement')='panic' AND current_setting('log_parameter_max_length_on_error')='0';\n")
            process.stdin.flush()
            ready, _, _ = select.select([process.stdout], [], [], 10)
            check(bool(ready) and process.stdout.readline() == b'FIXED_PRIVATE_READY\n', 'PRIVATE_SESSION_REQUIRED')
            if getattr(self, 'death_stage', None):
                process.stdin.write(bytes(payload)); process.stdin.close()
                deadline = time.monotonic() + 90
                observed = False
                while time.monotonic() < deadline:
                    ready, _, _ = select.select([process.stdout], [], [], 1)
                    if ready and process.stdout.readline() == b'ALIGNMENT_CONTROLLER_READY\n':
                        observed = True; break
                check(observed, 'ALIGNMENT_CONTROLLER_CHECKPOINT_REQUIRED')
                core.private_inputs.privacy(core, self)
                print(json.dumps({'alignment_death_ready': self.death_stage,
                                  'directory': self.directory, 'privacy': True}), flush=True)
                os.kill(os.getpid(), signal.SIGKILL)
            stdout, stderr = process.communicate(bytes(payload), timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise batch.BoundaryError('ALIGNMENT_MEMORY_PROCESS_FAILED') from None
        finally:
            payload.clear()
            if process is not None and process.poll() is None:
                process.kill(); process.communicate()
        state = legacy.safe_receipt(stderr.decode(errors='replace'), process.returncode, 'alignment')['sqlstate']
        return core.Result(stdout.decode(), stderr.decode(errors='replace'), process.returncode,
                           state, lower, datetime.now(timezone.utc))

    def envelope(self, database, before, expected, rollback=False, fault=None):
        check(fault != 'boundary_privileges' or rollback is True,
              'ALIGNMENT_PRIVILEGE_PROBE_ROLLBACK_REQUIRED')
        check(database in self.reservations, 'ALIGNMENT_PRIVATE_RESERVATION_REQUIRED')
        if not rollback:
            self.graph(before[0])
        current = batch.validate_sources(batch.reviewed_paths())
        check(current == self.sources, 'ALIGNMENT_SOURCE_BYTES_CHANGED')
        paths = []
        for index, source in enumerate(self.sources):
            path = self.h.private('alignment-whole-' + source.key + '.sql', source.data)
            check(path.read_bytes() == source.data, 'ALIGNMENT_WHOLE_FILE_REQUIRED')
            paths.append(path)
            if source.key != 'W':
                previous = ('ADMITTED', 'P', 'A', 'B')[index]
                sql = batch.stage_sql(previous, source.key)
                if fault == 'controller_' + source.key:
                    self.death_stage = source.key
                    sql += "\nSELECT 'ALIGNMENT_CONTROLLER_READY'; SELECT pg_sleep(180);"
                if fault == source.key:
                    sql += '\nSELECT 1/0;'
                if fault == source.key + '_death':
                    sql += '\nSELECT pg_terminate_backend(pg_backend_pid());'
                if source.key == 'C' and fault in ('context', 'hash', 'owner'):
                    sql += {'context': "UPDATE alignment_context SET txid=0;",
                            'hash': "UPDATE alignment_context SET hashes[2]=repeat('0',64);",
                            'owner': "ALTER TABLE alignment_context OWNER TO authenticated;"}[fault]
                if source.key == 'C' and fault == 'boundary_privileges':
                    sql += '\n' + boundary_privilege_probe()[0]
                paths.append(self.h.private('alignment-stage-' + source.key + '.sql', sql))
        suffix = batch.identity_assertions() + batch.assertions(rollback)
        if fault == 'boundary_privileges':
            suffix = boundary_privilege_probe()[1] + '\n' + suffix
        elif fault == 'W':
            suffix = 'SELECT 1/0;\n' + suffix
        elif fault == 'W_death':
            suffix = 'SELECT pg_terminate_backend(pg_backend_pid());\n' + suffix
        elif fault == 'repeat_W':
            paths.append(paths[-1])
        paths.append(self.h.private('alignment-assertions.sql', suffix))
        prelude = batch.prelude(self.sources, before, expected, self.reservations[database].generation, rollback)
        prelude += 'CREATE TEMP TABLE alignment_identity_reference(value jsonb) ON COMMIT DROP; INSERT INTO alignment_identity_reference VALUES (' + batch.json_sql(json.loads(self.query(database, batch.identities_sql()))) + ');'
        return self.run_inputs(database, prelude, paths)


def require_owner():
    check(re.fullmatch(r'gridex-auth-legacy-continuation-[0-9]+-[0-9]+',
                      os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME', '')) is not None,
          'ALIGNMENT_EXACT_WORKFLOW_OWNER')


def native(death_stage=None):
    require_owner()
    original = batch.replay.originals_snapshot()
    with legacy.OwnedPostgres() as h:
        with core.AcceptedInputs(h):
            dedupe.prepare_reference(h, 'fixed-target')
            h.reset(CANARY)
            h.sql(CANARY, 'CREATE TABLE public.alignment_canary(id integer PRIMARY KEY, value text); INSERT INTO public.alignment_canary VALUES(1,\'preserved\');', 'alignment_canary')
            command = ['bash', str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'), '--fixed-target-prefix-proof']
            check(batch.replay.serve_child(legacy, h, command, 'fixed-target') == 0, 'ALIGNMENT_ACTUAL63_CHILD_REQUIRED')
        proof = AlignmentProof(h)
        labels = ('customer_profiles', 'customer_delivery_points', 'contract_agreements', 'document_ai_extractions')
        sql = "SELECT jsonb_object_agg(label,coalesce(c.relkind::text,'missing')) FROM (VALUES " + ','.join('(' + batch.literal(name) + ')' for name in labels) + ") names(label) LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||label);"
        evidence = json.loads(proof.query(batch.replay.DATABASE, sql))
        check(type(evidence) is dict and set(evidence) == set(labels) and all(value in ('r','p','v','m','f','S','i','I','c','t','missing') for value in evidence.values()), 'ALIGNMENT_BOUNDED_NEXT_CATALOG_SHAPE')
        print(json.dumps({'stage': 'alignment_actual63_catalog_evidence', 'relations': evidence}, sort_keys=True), flush=True)
        cases = load('alignment_native_cases', 'canonical-user-rbac-customer-alignment-cases.py')
        if death_stage:
            database = proof.fresh_generation(ATOMIC, 'controller-death-' + death_stage)
            before = proof.snapshot(database)
            proof.envelope(database, before, proof.expected(before), fault='controller_' + death_stage)
            raise batch.BoundaryError('ALIGNMENT_CONTROLLER_DEATH_NOT_OBSERVED')
        cases.run(sys.modules[__name__], proof)
        core.private_inputs.privacy(core, proof)
        check(not proof.reservations, 'ALIGNMENT_ALL_CONTROLS_DISPOSED')
        check(encoded(proof.snapshot(batch.replay.DATABASE)) == encoded(proof.origin), 'ALIGNMENT_FINAL_ORIGIN_CHANGED')
        check(batch.replay.originals_snapshot() == original, 'ALIGNMENT_SOURCE_RESTORATION_REQUIRED')
    print('PASS whole customer alignment actual63; sources/private boundary/oracles/faults/cleanup', flush=True)


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only', action='store_true')
    modes.add_argument('--cleanup-owned', action='store_true')
    modes.add_argument('--death-worker', choices=('A', 'C'))
    args = parser.parse_args()
    if args.death_worker:
        native(args.death_worker); return
    if args.cleanup_owned:
        require_owner(); legacy.cleanup_workflow_owned(); return
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Constructors)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    if not args.selection_only:
        native()
        cases = load('alignment_death_cases', 'canonical-user-rbac-customer-alignment-cases.py')
        cases.controller_deaths(sys.modules[__name__])


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException:
        # Closed diagnostic: never raw SQL, exception text, paths or identifiers.
        print('FAIL customer alignment category=PRIVATE_PROOF_FAILED', file=sys.stderr)
        raise SystemExit(1)
