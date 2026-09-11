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
    def test_final_catalog_accepts_only_new_source_index_hot_safety(self):
        self.assertTrue(hasattr(batch.catalog, 'final_equal'))
        self.assertTrue(hasattr(batch, 'new_index_keys'))
        sources = batch.validate_sources(batch.reviewed_paths())
        for base, actual, expected, verdict in final_catalog_cases():
            saved = encoded((base, actual, expected))
            selected = batch.new_index_keys(sources, base)
            self.assertIs(batch.catalog.final_equal(base, actual, expected, selected), verdict)
            self.assertEqual(encoded((base, actual, expected)), saved)
        with self.assertRaises(batch.BoundaryError):
            batch.new_index_keys(tuple(reversed(sources)), {})

    def test_independent_catalog_accepts_only_source_qualified_build_timestamps(self):
        self.assertTrue(hasattr(batch.catalog, 'independent_equal'), 'bounded independent comparison required')
        actual, expected, actual_bounds, expected_bounds = timestamp_catalogs()
        before = encoded((actual, expected))
        self.assertNotEqual(actual[0], expected[0])
        self.assertTrue(batch.catalog.independent_equal(actual, expected, actual_bounds,
                                                       expected_bounds, legacy.verified_prefix()))
        self.assertEqual(encoded((actual, expected)), before)
        # A clone still shares its origin's cached value; raw comparison must
        # detect a one-microsecond change even inside the construction window.
        clone = copy.deepcopy(actual)
        clone[0]['alignment_attribute/public.audit_logs/updated_at']['missing_value'] = ['2026-09-11T12:00:03.000001+00:00']
        from unittest.mock import Mock
        for snapshots, label in (([clone], 'ALIGNMENT_IMMUTABLE_ORIGIN_CHANGED'),
                                 ([actual, clone], 'ALIGNMENT_ACTUAL63_CLONE_REQUIRED')):
            proof = Mock(spec=AlignmentProof)
            proof.origin, proof.reservations, proof.name, proof.h = actual, {}, 'owned-test', Mock()
            proof.snapshot.side_effect = snapshots
            with self.assertRaisesRegex(batch.BoundaryError, label):
                AlignmentProof.clone(proof, TARGET, 'timestamp-drift')

    def test_independent_catalog_rejects_timestamp_or_metadata_corruption(self):
        self.assertTrue(hasattr(batch.catalog, 'independent_equal'), 'bounded independent comparison required')
        prefix = legacy.verified_prefix()
        key = 'alignment_attribute/public.audit_logs/updated_at'
        mutations = (
            ('missing_value', None), ('missing_value', []), ('missing_value', [None]),
            ('missing_value', ['infinity']), ('missing_value', ['private-value']),
            ('missing_value', ['2026-09-11T12:00:03']),
            ('missing_value', ['2020-01-01T00:00:00+00:00']),
            ('missing_value', ['2026-09-11T12:00:05+00:00']),
            ('missing_value', ['2026-09-11T12:00:03+00:00'] * 2),
            ('missing_value', [['2026-09-11T12:00:03+00:00']]),
            ('missing', False), ('type', 'text'), ('dimensions', 1),
            ('ordinal', 999), ('unknown_field', 'private-value'))
        for field, value in mutations:
            for side in (0, 1):
                with self.subTest(field=field, value=value, side=side):
                    actual, expected, ab, eb = timestamp_catalogs()
                    (actual, expected)[side][0][key][field] = value
                    self.assertFalse(batch.catalog.independent_equal(actual, expected, ab, eb, prefix))
        for field, value in (('default', 'clock_timestamp()'), ('type', 'text'),
                             ('notnull', True), ('generated', 's'), ('unknown_field', None)):
            actual, expected, ab, eb = timestamp_catalogs()
            for snapshot in (actual, expected):
                snapshot[0]['column/public.audit_logs/updated_at'][field] = value
            self.assertFalse(batch.catalog.independent_equal(actual, expected, ab, eb, prefix))

    def test_independent_catalog_requires_empty_ordinary_tables_and_exact_other_fields(self):
        self.assertTrue(hasattr(batch.catalog, 'independent_equal'), 'bounded independent comparison required')
        prefix = legacy.verified_prefix()
        for side in (0, 1):
            actual, expected, ab, eb = timestamp_catalogs()
            (actual, expected)[side][1].append(['public.audit_logs', {'id': 'existing-row'}])
            self.assertFalse(batch.catalog.independent_equal(actual, expected, ab, eb, prefix))
        for mutation in ('view', 'missing', 'extra', 'unqualified', 'unknown'):
            actual, expected, ab, eb = timestamp_catalogs()
            if mutation == 'view':
                for snapshot in (actual, expected):
                    snapshot[0]['relation/public.audit_logs']['kind'] = 'v'
            elif mutation == 'missing':
                del actual[0]['alignment_attribute/public.audit_logs/updated_at']
            elif mutation == 'extra':
                actual[0]['dependency/private-object'] = 'a'
            elif mutation == 'unqualified':
                for snapshot, value in ((actual, '2026-09-11T12:00:03+00:00'),
                                        (expected, '2026-09-11T12:00:01+00:00')):
                    snapshot[0]['alignment_attribute/public.other/updated_at'] = dict(
                        snapshot[0]['alignment_attribute/public.audit_logs/updated_at'], missing_value=[value])
            else:
                actual[0]['relation/public.audit_logs']['private-field'] = 'private-value'
            self.assertFalse(batch.catalog.independent_equal(actual, expected, ab, eb, prefix))

    def test_independent_catalog_requires_source_pins_and_separate_valid_build_bounds(self):
        self.assertTrue(hasattr(batch.catalog, 'independent_equal'), 'bounded independent comparison required')
        actual, expected, ab, eb = timestamp_catalogs()
        prefix = legacy.verified_prefix()
        for bad in (prefix[1:], tuple(reversed(prefix)),
                    tuple((path, data + '\n') if i == 1 else (path, data)
                          for i, (path, data) in enumerate(prefix))):
            self.assertFalse(batch.catalog.independent_equal(actual, expected, ab, eb, bad))
        for bounds in ((), (ab[1], ab[0]), (ab[0].replace(tzinfo=None), ab[1]), eb):
            self.assertFalse(batch.catalog.independent_equal(actual, expected, bounds, eb, prefix))

    def test_catalog_mismatch_receipt_has_only_fixed_fields_and_counts(self):
        self.assertTrue(hasattr(batch.catalog, 'mismatch_summary'), 'closed catalog mismatch summary required')
        actual = {'alignment_attribute/private-object/private-column':
                  {'ordinal': 3, 'missing_value': ['private-value'], 'private-field': 'private-default'},
                  'private-kind/private-identity': {'private-field': 'private-value'}}
        expected = {'alignment_attribute/private-object/private-column':
                    {'ordinal': 4, 'missing_value': ['different-private-value'], 'private-field': 'different'},
                    'private-kind/private-identity': {'private-field': 'different'}}
        self.assertEqual(batch.catalog.mismatch_summary(actual, expected), {'objects': 2, 'groups': [
            {'kind': 'alignment_attribute', 'change': 'changed', 'field': 'missing_value', 'count': 1},
            {'kind': 'alignment_attribute', 'change': 'changed', 'field': 'ordinal', 'count': 1},
            {'kind': 'alignment_attribute', 'change': 'changed', 'field': 'other', 'count': 1},
            {'kind': 'other', 'change': 'changed', 'field': 'other', 'count': 1}]})

    def test_catalog_mismatch_receipt_counts_missing_and_scalar_without_mutation(self):
        self.assertTrue(hasattr(batch.catalog, 'mismatch_summary'), 'closed catalog mismatch summary required')
        actual = {'index/private-extra': {'definition': 'private SQL'}, 'dependency/private-key': 'a'}
        expected = {'function/private-missing': {'definition': 'private SQL'}, 'dependency/private-key': 'n'}
        before = copy.deepcopy((actual, expected))
        self.assertEqual(batch.catalog.mismatch_summary(actual, expected), {'objects': 3, 'groups': [
            {'kind': 'dependency', 'change': 'changed', 'field': 'value', 'count': 1},
            {'kind': 'function', 'change': 'missing_actual', 'field': 'object', 'count': 1},
            {'kind': 'index', 'change': 'extra_actual', 'field': 'object', 'count': 1}]})
        self.assertEqual((actual, expected), before)
        self.assertEqual(batch.catalog.mismatch_summary(actual, actual), {'objects': 0, 'groups': []})

    def test_failure_receipt_discards_untrusted_stage_type_and_message(self):
        self.assertTrue('failure_receipt' in globals(), 'closed diagnostic constructor required')
        class PrivateError(RuntimeError):
            def __str__(self):
                raise AssertionError('private exception string must never be read')
        actual = failure_receipt('private/path/identity', PrivateError('private SQL payload'))
        self.assertEqual(actual, dict(stage='internal', type='OTHER', category='PRIVATE_PROOF_FAILED'))
        self.assertEqual(failure_receipt('release_binding', batch.BoundaryError('ALIGNMENT_FROZEN_RELEASE_IDENTITY')),
                         dict(stage='release_binding', type='BOUNDARY', category='BOUNDARY_REJECTED'))
        self.assertEqual(failure_receipt('release_binding', batch.BoundaryError('unknown private label'))['category'],
                         'BOUNDARY_REJECTED')

    def test_query_failure_categories_are_closed(self):
        self.assertTrue('query_failure_category' in globals(), 'closed query categories required')
        self.assertEqual(query_failure_category('42703'), 'QUERY_UNDEFINED_COLUMN')
        self.assertEqual(query_failure_category('42601'), 'QUERY_SYNTAX')
        for value in ('private SQLSTATE text', 'XX000', '', None, ['42703']):
            self.assertEqual(query_failure_category(value), 'PRIVATE_QUERY_FAILED')

    def test_query_diagnostics_preserve_exact_success_predicate(self):
        from unittest.mock import Mock
        reader = Mock(spec=AlignmentProof)
        for code, state in ((0, '00000'), (1, '00000'), (0, '42703'), (1, 'private state')):
            reader.run.return_value = core.Result('private rows', 'private SQL', code, state, None, None)
            if code == 0 and state == '00000':
                self.assertEqual(AlignmentProof.query(reader, 'private database', 'private input'), 'private rows')
            else:
                with self.assertRaises(NativeQueryError) as caught:
                    AlignmentProof.query(reader, 'private database', 'private input')
                receipt = failure_receipt('helper_catalog', caught.exception)
                self.assertEqual(receipt['category'], query_failure_category(state))
                self.assertNotIn('private', json.dumps(receipt))

    def test_first_stage_failure_survives_cleanup_exception(self):
        global _NATIVE_FAILURE
        previous = _NATIVE_FAILURE
        _NATIVE_FAILURE = None
        try:
            with self.assertRaises(OSError):
                with diagnostic_stage('owned_lifecycle'):
                    try:
                        with diagnostic_stage('helper_catalog'):
                            raise NativeQueryError('42703')
                    finally:
                        raise OSError('private cleanup detail')
            self.assertEqual(_NATIVE_FAILURE, dict(stage='helper_catalog', type='QUERY', category='QUERY_UNDEFINED_COLUMN'))
        finally:
            _NATIVE_FAILURE = previous

    def test_timestamp_failures_identify_oracle_or_mutation_and_preserve_cleanup(self):
        from unittest.mock import Mock
        global _NATIVE_FAILURE
        previous = _NATIVE_FAILURE
        try:
            for failed_database, stage in ((ORACLE, 'source_oracle_ddl'),
                                           (ATOMIC, 'timestamp_mutation')):
                for cleanup_fails in (False, True):
                    with self.subTest(stage=stage, cleanup_fails=cleanup_fails):
                        _NATIVE_FAILURE = None
                        error, cleanup_error = NativeQueryError('42804'), OSError('private cleanup detail')
                        error.args = ('private query detail',)
                        cleanup = []
                        proof = Mock(spec=AlignmentProof)
                        proof.sources = batch.validate_sources(batch.reviewed_paths())
                        proof.fresh_generation.side_effect = lambda database, case: database
                        proof.snapshot.return_value = timestamp_catalogs()[0]
                        proof.expected.side_effect = lambda before: AlignmentProof.expected(proof, before)
                        def query(database, sql):
                            if database == failed_database:
                                raise error
                            self.assertEqual(database, ORACLE)
                            return ''
                        def dispose(database):
                            cleanup.append(database)
                            if cleanup_fails and database == failed_database:
                                raise cleanup_error
                        proof.query.side_effect = query
                        proof.destroy.side_effect = proof.dispose.side_effect = dispose
                        with self.assertRaises(OSError if cleanup_fails else NativeQueryError) as caught:
                            with diagnostic_stage('native_cases'):
                                native_timestamp_controls(proof)
                        self.assertIs(caught.exception, cleanup_error if cleanup_fails else error)
                        self.assertEqual(cleanup, [ORACLE, ATOMIC])
                        self.assertEqual(_NATIVE_FAILURE,
                            dict(stage=stage, type='QUERY', category='QUERY_DATATYPE'))
        finally:
            _NATIVE_FAILURE = previous

    def test_timestamp_control_requires_single_drift_rejection_and_preservation(self):
        from unittest.mock import Mock
        for fault in (None, 'no_drift', 'extra_drift', 'accepted', 'wrong_state', 'not_preserved'):
            with self.subTest(fault=fault):
                admitted = timestamp_catalogs()[0]
                changed = copy.deepcopy(admitted)
                key = 'alignment_attribute/public.audit_logs/updated_at'
                changed[0][key]['missing_value'] = ['2026-09-11T12:00:03.000001+00:00']
                if fault == 'no_drift':
                    changed = copy.deepcopy(admitted)
                elif fault == 'extra_drift':
                    changed[0][key]['missing'] = False
                proof = Mock(spec=AlignmentProof)
                proof.fresh_generation.return_value = ATOMIC
                proof.snapshot.side_effect = [admitted, changed,
                    admitted if fault == 'not_preserved' else changed]
                proof.expected.return_value = admitted[0]
                proof.query.return_value = 't\n'
                proof.envelope.return_value = core.Result('', '', 0 if fault == 'accepted' else 1,
                    '00000' if fault == 'accepted' else ('P0004' if fault == 'wrong_state' else '42804'), None, None)
                if fault is None:
                    native_timestamp_controls(proof)
                else:
                    with self.assertRaises(batch.BoundaryError):
                        native_timestamp_controls(proof)
                proof.dispose.assert_called_once_with(ATOMIC)

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

    def test_diagnostic_source_returns_complete_pinned_view(self):
        data = batch.repair.read_source(ROOT/'supabase/migrations'/batch.VIEW_SOURCE).decode()
        start = data.index('create or replace view public.gridex_debug_step1_2_schema_alignment_v as\n')
        # The complete source tail is independently authoritative, including the
        # to_regclass calls and NOT IN expression outside required_tables.
        try:
            declaration = batch.diagnostic_source()
        except batch.BoundaryError:
            self.fail('Pinned diagnostic view was rejected before native binding')
        self.assertEqual(declaration, data[start:].strip())

    def test_diagnostic_source_rejects_changed_required_tables_or_declaration(self):
        from unittest.mock import patch
        data = batch.repair.read_source(ROOT/'supabase/migrations'/batch.VIEW_SOURCE)
        view = b'create or replace view public.gridex_debug_step1_2_schema_alignment_v as\n'
        mutations = (
            (b"('customers')", b"('unexpected_customers')"),
            (b"    ('company_memberships'),\n", b''),
            (b"('user_roles')", b"('companies')"),
            (b"('companies'),\n    ('company_memberships')", b"('company_memberships'),\n    ('companies')"),
            (b"('companies')", b"('companies'), ('extra_table')"),
            (b"('companies')", b"('companies'::text)"),
            (b"('companies')", b"('comp anies')"),
            (b'with required_tables(table_name)', b'with other_tables(table_name)'),
            (view, view.replace(b'_alignment_v', b'_other_v')),
            (b'order by table_name;', b''))
        for old, new in mutations:
            with self.subTest(old=old, new=new):
                changed = data.replace(old, new)
                self.assertNotEqual(changed, data)
                # Exercise declaration validation beneath the separately tested
                # immutable file boundary, without writing historical source.
                with patch.object(batch.repair, 'read_source', return_value=changed):
                    with self.assertRaises(batch.BoundaryError):
                        batch.diagnostic_source()

    def test_diagnostic_source_rejects_changed_bytes_at_real_hash_boundary(self):
        from unittest.mock import patch
        source_path = ROOT/'supabase/migrations'/batch.VIEW_SOURCE
        original = Path.read_bytes
        def changed(path):
            data = original(path)
            return data + b'-- changed source\n' if path == source_path else data
        # Keep repair.read_source, manifests and checksum verification real.
        with patch.object(Path, 'read_bytes', changed):
            with self.assertRaises(batch.repair.BoundaryError):
                batch.diagnostic_source()

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
from datetime import datetime, timedelta, timezone
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


def final_catalog_cases():
    """The same positive/negative matrix runs against Python and native SQL."""
    name = 'public.ediel_tgt_test_data_suite_role_case_uidx'
    key = 'alignment_index/' + name
    base = {'relation/public.ediel_tgt_test_data': {'kind': 'r'}}
    value = dict.fromkeys(batch.catalog.MISMATCH_FIELDS['alignment_index'])
    value.update(table='ediel_tgt_test_data', live=True, check_xmin=False)
    index = dict.fromkeys(batch.catalog.MISMATCH_FIELDS['index'])
    index.update(valid=True, ready=True, definition='source-defined-index')
    expected = {**base, key: value, 'index/' + name: index}
    actual = copy.deepcopy(expected)
    actual[key]['check_xmin'] = True
    cases = [(base, actual, expected, True), (base, expected, expected, True),
             (base, expected, actual, False)]
    for prefix in ('index/', 'alignment_index/'):
        existing = {**base, prefix + name: expected[prefix + name]}
        cases.append((existing, actual, expected, False))
    for field, value in (('live', False), ('table', 'other'), ('keys', 'different'),
                         ('predicate', 'different'), ('private_field', 'unknown')):
        changed = copy.deepcopy(actual); changed[key][field] = value
        cases.append((base, changed, expected, False))
    for side in ('actual', 'expected'):
        for flag in (None, 0, 1, 'true', 'false', [], {}):
            a, e = copy.deepcopy(actual), copy.deepcopy(expected)
            (a if side == 'actual' else e)[key]['check_xmin'] = flag
            cases.append((base, a, e, False))
        a, e = copy.deepcopy(actual), copy.deepcopy(expected)
        del (a if side == 'actual' else e)[key]['check_xmin']
        cases.append((base, a, e, False))
    for flag in ('valid', 'ready'):
        a, e = copy.deepcopy(actual), copy.deepcopy(expected)
        a['index/' + name][flag] = e['index/' + name][flag] = False
        cases.append((base, a, e, False))
    a, e = copy.deepcopy(actual), copy.deepcopy(expected)
    a[key]['live'] = e[key]['live'] = False
    cases.append((base, a, e, False))
    a, e = copy.deepcopy(actual), copy.deepcopy(expected)
    for shape in (a, e):
        shape['alignment_index/public.unknown'] = shape.pop(key)
        shape['index/public.unknown'] = shape.pop('index/' + name)
    cases.append((base, a, e, False))
    for side in ('actual', 'expected'):
        a, e = copy.deepcopy(actual), copy.deepcopy(expected)
        (a if side == 'actual' else e)['column/public.other/value'] = {'type': 'text'}
        cases.append((base, a, e, False))
    return cases


def timestamp_catalogs():
    """Independent literal fixtures for the twelve source-defined additions."""
    tables = ('supplier_switch_events', 'outbound_dispatch_events', 'metering_values',
              'ediel_message_events', 'ediel_message_validation_issues', 'ediel_aperak_error_details',
              'audit_logs', 'customer_portal_events', 'customer_invoice_lines',
              'customer_invoice_documents', 'customer_import_batches', 'customer_import_rows')
    actual = {}
    for table in tables:
        name = 'public.' + table
        actual['relation/' + name] = dict(kind='r', owner='postgres', acl=None, rls=True,
                                         force=False, options=None, definition=None)
        actual['column/' + name + '/updated_at'] = dict(type='timestamp with time zone',
            notnull=table.startswith('customer_import_'), default='now()', identity='',
            generated='', collation='-', acl=None)
        actual['alignment_attribute/' + name + '/updated_at'] = dict(ordinal=12,
            type='timestamp with time zone', dimensions=0, storage='p', compression='',
            local=True, inheritance=0, missing=True,
            missing_value=['2026-09-11T12:00:03+00:00'], options=None)
    expected = copy.deepcopy(actual)
    for key, value in expected.items():
        if key.startswith('alignment_attribute/'):
            value['missing_value'] = ['2026-09-11T12:00:01+00:00']
    ab = tuple(datetime.fromisoformat('2026-09-11T12:00:0' + str(i) + '+00:00') for i in (2, 4))
    eb = tuple(datetime.fromisoformat('2026-09-11T12:00:0' + str(i) + '+00:00') for i in (0, 2))
    return (actual, []), (expected, []), ab, eb


DIAGNOSTIC_STAGES = frozenset(('entry', 'owner_requirement', 'source_snapshot',
    'owned_lifecycle', 'accepted_inputs', 'reference_prepare', 'canary_setup',
    'actual63_child', 'alignment_reference', 'release_binding', 'helper_prerequisites',
    'helper_catalog', 'origin_snapshot', 'reference_decode', 'catalog_equality',
    'source_state_equality', 'canary_snapshot', 'graph_admission', 'diagnostic_binding',
    'next_catalog_receipt', 'native_cases', 'source_oracle_ddl', 'timestamp_mutation',
    'timestamp_control', 'catalog_controls', 'behavior_cases', 'final_privacy', 'controller_deaths'))
QUERY_CATEGORIES = {'42601': 'QUERY_SYNTAX', '42703': 'QUERY_UNDEFINED_COLUMN',
    '42P01': 'QUERY_UNDEFINED_RELATION', '42704': 'QUERY_UNDEFINED_OBJECT',
    '42804': 'QUERY_DATATYPE', '42883': 'QUERY_UNDEFINED_FUNCTION',
    '42501': 'QUERY_PRIVILEGE', '55P03': 'QUERY_LOCK', 'P0004': 'QUERY_ASSERTION'}
DIAGNOSTIC_STAGES |= frozenset((
    'case_baseline',
    'case_populated',
    'case_a_payload_and_null_order',
    'case_boundary_privileges',
    'case_standalone_c_backfills',
    'case_tgt_loss',
    'case_rpc_cases',
    'case_count_edge_rows',
    'case_role_overrides',
    'case_guard_sources',
    'case_incoming_fk_and_trigger',
    'case_audit_and_constraint_probes',
    'case_standalone_boundary',
    'case_faults',
    'case_catalog_rejections',
    'case_contention',
))
CASE_GUARDS = frozenset((
    'ALIGNMENT_ALL_NINETEEN_TARGETS',
    'ALIGNMENT_AUDIT_NATIVE_SOURCE_REQUIRED',
    'ALIGNMENT_A_EXISTING_PAYLOAD_ORACLE',
    'ALIGNMENT_A_NULL_ORDER_FIXTURE_REQUIRED',
    'ALIGNMENT_BASE_UNIQUE_PRESERVED',
    'ALIGNMENT_CATALOG_DRIFT_REJECTED',
    'ALIGNMENT_COLUMN_GRANT_DENIAL',
    'ALIGNMENT_CONTROLLER_CANARY_PRESERVED',
    'ALIGNMENT_CONTROLLER_COLLECTOR_PRIVACY',
    'ALIGNMENT_CONTROLLER_DEATH_FULL_ROLLBACK',
    'ALIGNMENT_CONTROLLER_EXACT_CLEANUP',
    'ALIGNMENT_CONTROLLER_SIGKILL_REQUIRED',
    'ALIGNMENT_CONTROLLER_SOURCE_RESTORATION',
    'ALIGNMENT_COUNTS_SOURCE_ORACLE',
    'ALIGNMENT_COUNT_DUPLICATE_LABELS',
    'ALIGNMENT_COUNT_NULL_UNKNOWN_TIE_ORACLE',
    'ALIGNMENT_DEATH_BACKEND_RELEASE',
    'ALIGNMENT_DEATH_OBSERVATION_FAILED',
    'ALIGNMENT_DEATH_OWNER_LABEL',
    'ALIGNMENT_DEATH_PRIVATE_CHECKPOINT',
    'ALIGNMENT_DORMANT_DOUBLE_COUNT_CHARACTERIZED',
    'ALIGNMENT_EDIEL_DEFAULT_NULL_STANDARD',
    'ALIGNMENT_EDIEL_INBOUND_COUNT',
    'ALIGNMENT_EDIEL_SINGLE_SOURCE_ORACLE',
    'ALIGNMENT_EDIEL_TIE_GROUP_ORDER',
    'ALIGNMENT_EFFECTIVE_EXECUTE_DENIAL',
    'ALIGNMENT_EFFECTIVE_VIEW_DENIAL',
    'ALIGNMENT_EMPTY_COUNT_SOURCE_ORACLE',
    'ALIGNMENT_EXACT_DEATH_DIRECTORY',
    'ALIGNMENT_EXACT_REPEAT_REQUIRED',
    'ALIGNMENT_EXPECTED_CATALOG_REQUIRED',
    'ALIGNMENT_EXPECTED_FAULT_STATE',
    'ALIGNMENT_GLOBAL_LOSS_ACCEPTED',
    'ALIGNMENT_GUARD_INDEX_ORACLE',
    'ALIGNMENT_GUARD_NATIVE_RESULT',
    'ALIGNMENT_GUARD_SETUP_SOURCE_DEPENDENCY',
    'ALIGNMENT_INCOMING_FK_FULL_ROWS',
    'ALIGNMENT_LOSS_ADMISSION_REQUIRED',
    'ALIGNMENT_NATIVE_COMPLETION_REQUIRED',
    'ALIGNMENT_NATIVE_EXECUTE_DENIAL',
    'ALIGNMENT_NATIVE_FAULT_REQUIRED',
    'ALIGNMENT_NATIVE_INCOMING_FK_ACTION',
    'ALIGNMENT_NATIVE_INCOMING_FK_RESTRICTION',
    'ALIGNMENT_NATIVE_LOCK_HOLDER',
    'ALIGNMENT_NATIVE_LOCK_TIMEOUT',
    'ALIGNMENT_NATIVE_OUTGOING_CONSTRAINT',
    'ALIGNMENT_NONTRANSACTIONAL_SEQUENCE_OBSERVED',
    'ALIGNMENT_NULL_GROUP_VS_UNIQUE_REQUIRED',
    'ALIGNMENT_OVERRIDE_SOURCE_ORACLE',
    'ALIGNMENT_RESERVED_ALL_AMBIGUITY_ACCEPTED',
    'ALIGNMENT_ROLE_SOURCE_ORACLE',
    'ALIGNMENT_SEQUENCE_CATALOG_ROLLBACK',
    'ALIGNMENT_SEQUENCE_DISCREPANCY_REQUIRED',
    'ALIGNMENT_SEQUENCE_TRANSACTIONAL_ROWS_ROLLBACK',
    'ALIGNMENT_STANDALONE_REJECTED',
    'ALIGNMENT_TABLE_RETURN_REQUIRED',
    'ALIGNMENT_TERMINAL_REUSE_ACCEPTED',
    'ALIGNMENT_TRANSACTION_ROLLBACK_REQUIRED',
    'ALIGNMENT_TRIGGER_COMPLETE_SIDE_WRITES',
    'ALIGNMENT_UNKNOWN_TRIGGER_ACCEPTED',
    'ALIGNMENT_WHOLE_C_CATALOG_ORACLE',
    'ALIGNMENT_WHOLE_C_FULL_BACKFILL_ORACLE',
    'ALIGNMENT_WHOLE_C_NATIVE_REQUIRED',
))
SQL_ASSERTIONS = frozenset((
    'ALIGNMENT_FULL_ROWS_MISMATCH', 'ALIGNMENT_STAGE_MISMATCH',
    'ALIGNMENT_OWNER_REQUIRED', 'ALIGNMENT_CATALOG_MISMATCH',
    'ALIGNMENT_COMPLETION_REQUIRED', 'ALIGNMENT_FINAL_CATALOG_MISMATCH',
    'ALIGNMENT_SOURCE_DROP_IDENTITY_REQUIRED', 'ALIGNMENT_EXISTING_IDENTITY_CHANGED',
    'ALIGNMENT_CONTEXT_REQUIRED', 'ALIGNMENT_PREREQUISITE_SHAPE', 'A6_LOSS_REJECTED',
))
_NATIVE_FAILURE = None


def query_failure_category(state):
    return QUERY_CATEGORIES.get(state, 'PRIVATE_QUERY_FAILED') if type(state) is str else 'PRIVATE_QUERY_FAILED'


class NativeQueryError(batch.BoundaryError):
    def __init__(self, state):
        super().__init__()
        self.category = query_failure_category(state)


class NativeResultError(batch.BoundaryError):
    """Finite diagnostic only; no Result, SQL or stderr retained by the error."""
    def __init__(self, result):
        super().__init__()
        self.category = query_failure_category(result.state)
        self.input = self.assertion = 'UNCLASSIFIED'
        self.catalog = None
        # Only a primary error at byte zero is authoritative. Never scan NOTICE,
        # CONTEXT or multiline quoted payload for something resembling a header.
        match = re.match(r'psql:(<stdin>|/legacy-private/alignment-(whole-[PABCW]|stage-[PABC]|assertions)\.sql):[0-9]+: ERROR:[ \t]+([A-Z0-9]{5}):[ \t]*([^\r\n]*)', result.stderr)
        if match:
            self.input = match[2] or 'prelude'
            if match[3] == result.state and match[4] in SQL_ASSERTIONS:
                self.assertion = match[4]
        if self.assertion == 'ALIGNMENT_FINAL_CATALOG_MISMATCH':
            lines = result.stdout.splitlines()
            marker = 'ALIGNMENT_PRIVATE_FINAL_CATALOGS'
            if lines.count(marker) == 1:
                try:
                    snapshots = json.loads(lines[lines.index(marker) + 1])
                    if type(snapshots) is list and len(snapshots) == 2 and all(type(s) is dict for s in snapshots):
                        self.catalog = batch.catalog.mismatch_summary(*snapshots)
                except (ValueError, IndexError, TypeError):
                    pass


def failure_receipt(stage, error):
    """Finite literals only; unknown exception content is never disclosed."""
    stage = stage if type(stage) is str and stage in DIAGNOSTIC_STAGES else 'internal'
    kind = {batch.BoundaryError: 'BOUNDARY', NativeQueryError: 'QUERY',
            NativeResultError: 'NATIVE_RESULT',
            AssertionError: 'ASSERTION', ValueError: 'VALUE', KeyError: 'KEY',
            TypeError: 'TYPE', AttributeError: 'ATTRIBUTE', json.JSONDecodeError: 'JSON',
            OSError: 'PROCESS', subprocess.TimeoutExpired: 'TIMEOUT'}.get(type(error), 'OTHER')
    category = 'BOUNDARY_REJECTED' if kind == 'BOUNDARY' else 'PRIVATE_PROOF_FAILED'
    if type(error) in (NativeQueryError, NativeResultError):
        candidate = error.category
        category = candidate if type(candidate) is str and candidate in QUERY_CATEGORIES.values() else 'PRIVATE_QUERY_FAILED'
    receipt = dict(stage=stage, type=kind, category=category)
    if type(error) is batch.BoundaryError and len(error.args) == 1:
        guard = error.args[0]
        if type(guard) is str and guard in CASE_GUARDS:
            receipt['guard'] = guard
    if type(error) is NativeResultError:
        receipt.update(input=error.input, assertion=error.assertion)
        if error.catalog is not None:
            receipt['catalog'] = error.catalog
    return receipt


@contextlib.contextmanager
def diagnostic_stage(stage):
    global _NATIVE_FAILURE
    try:
        yield
    except BaseException as error:
        # Capture the first failing operation before context cleanup can replace
        # its exception. Retain only the closed receipt, never private objects.
        if _NATIVE_FAILURE is None:
            _NATIVE_FAILURE = failure_receipt(stage, error)
        raise


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
    def __init__(self, h, actual_bounds=None, helper_bounds=None):
        repair.require_owned(h)
        dedupe.require_owned(h)
        self.h, self.name, self.directory = h, h.name, h.directory.name
        self.references = h.reference, repair.REFERENCES[h], dedupe._REFERENCES[h]
        self.fixed_reference = fixed._REFERENCES.get(h)
        self.fixed_release = fixed._RELEASES.get(h)
        self.reservations, self.terminal = {}, set()
        self.sources = batch.validate_sources(batch.reviewed_paths())
        self.accepted_inputs = self.fixed_reference.inputs if type(self.fixed_reference) is fixed.Reference else None
        with diagnostic_stage('release_binding'):
            self.owned(batch.replay.DATABASE)
        # The helper was built independently from selected prefix and source-only
        # R2/E2/S2/H2 declarations. Add exactly the fixed prerequisite source delta,
        # without rerunning fixed identities or using restoration X as an oracle.
        with diagnostic_stage('helper_prerequisites'):
            self.query(REFERENCE, "ALTER TABLE public.companies ADD COLUMN industry text NOT NULL DEFAULT 'electricity_supplier'; ALTER TABLE public.company_memberships ADD COLUMN suspended_at timestamptz;")
        with diagnostic_stage('helper_catalog'):
            independently_constructed = self.snapshot(REFERENCE)
        with diagnostic_stage('origin_snapshot'):
            self.origin = self.snapshot(batch.replay.DATABASE)
        with diagnostic_stage('reference_decode'):
            expected = fixed.decoded(self.fixed_release.s1)
        with diagnostic_stage('catalog_equality'):
            equal = batch.catalog.independent_equal(self.origin, independently_constructed,
                actual_bounds, helper_bounds, legacy.verified_prefix())
            if not equal:
                print(json.dumps({'stage': 'alignment_catalog_mismatch',
                                  'summary': batch.catalog.mismatch_summary(self.origin[0], independently_constructed[0])},
                                 sort_keys=True), flush=True)
            check(equal, 'ALIGNMENT_INDEPENDENT_ACTUAL63_CATALOG')
        with diagnostic_stage('source_state_equality'):
            check({k: v for k, v in self.origin[0].items() if not k.startswith('alignment_')} == expected[0]
                  and rows_equal(self.origin[1], expected[1]), 'ALIGNMENT_SOURCE_BACKED_ACTUAL63_REQUIRED')
        self.reference = encoded((independently_constructed[0], expected[1]))
        with diagnostic_stage('canary_snapshot'):
            self.canary = self.snapshot(CANARY)
        with diagnostic_stage('graph_admission'):
            self.graph(self.origin[0])
        with diagnostic_stage('diagnostic_binding'):
            self.bind_diagnostic()

    def query(self, database, sql):
        # Same inherited memory transport and exact success predicate. A failed
        # Result already carries a sanitized state; map it to a finite category.
        result = self.run(database, sql)
        if not (result.code == 0 and result.state == '00000'):
            raise NativeQueryError(result.state)
        return result.stdout

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
            with diagnostic_stage('source_oracle_ddl'):
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
            process.stdin.write(b"SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET log_min_messages=panic; SET client_min_messages=error; SELECT 'FIXED_PRIVATE_READY' WHERE current_setting('log_min_messages')='panic' AND current_setting('client_min_messages')='error' AND current_setting('log_min_error_statement')='panic' AND current_setting('log_parameter_max_length_on_error')='0';\n")
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


def native_timestamp_controls(proof):
    """The unchanged SQL admission guard rejects cached-value clone drift."""
    database = proof.fresh_generation(ATOMIC, 'cached-timestamp-drift')
    try:
        admitted = proof.snapshot(database)
        expected = proof.expected(admitted)
        with diagnostic_stage('timestamp_mutation'):
            cached = admitted[0]['alignment_attribute/public.audit_logs/updated_at']['missing_value'][0]
            replacement = datetime.fromisoformat(cached) + timedelta(microseconds=1)
            # PostgreSQL must build the catalog's anyarray value. A concrete
            # timestamptz[] expression cannot satisfy the UPDATE row type.
            changed = proof.query(database, '''CREATE TEMP TABLE alignment_timestamp_donor(id integer) ON COMMIT DROP;
ALTER TABLE pg_temp.alignment_timestamp_donor ADD COLUMN value timestamptz DEFAULT ''' + batch.literal(replacement.isoformat()) + '''::timestamptz;
UPDATE pg_catalog.pg_attribute target SET attmissingval=donor.attmissingval
FROM pg_catalog.pg_attribute donor
WHERE target.attrelid='public.audit_logs'::regclass AND target.attname='updated_at' AND target.atthasmissing
AND donor.attrelid='pg_temp.alignment_timestamp_donor'::regclass AND donor.attname='value' AND donor.atthasmissing
RETURNING target.atthasmissing;
DROP TABLE pg_temp.alignment_timestamp_donor;''')
        check(changed.strip() == 't', 'ALIGNMENT_NATIVE_TIMESTAMP_MUTATION_REQUIRED')
        before = proof.snapshot(database)
        check(batch.catalog.mismatch_summary(before[0], admitted[0]) == {'objects': 1, 'groups': [
            {'kind': 'alignment_attribute', 'change': 'changed', 'field': 'missing_value', 'count': 1}]},
            'ALIGNMENT_RAW_TIMESTAMP_DRIFT_REQUIRED')
        result = proof.envelope(database, admitted, expected)
        check(result.code != 0 and result.state == '42804', 'ALIGNMENT_RAW_TIMESTAMP_DRIFT_REJECTED')
        check(encoded(proof.snapshot(database)) == encoded(before), 'ALIGNMENT_TIMESTAMP_REJECTION_PRESERVED')
    finally:
        proof.dispose(database)


def native_final_catalog_controls(proof):
    cases = final_catalog_cases()
    expressions = [batch.catalog.final_equal_sql(batch.json_sql(base), batch.json_sql(actual),
        batch.json_sql(expected), batch.json_sql(batch.new_index_keys(proof.sources, base)))
        for base, actual, expected, _ in cases]
    values = json.loads(proof.query(batch.replay.DATABASE,
        'SELECT jsonb_build_array(' + ','.join(expressions) + ');'))
    check(values == [verdict for _, _, _, verdict in cases], 'ALIGNMENT_FINAL_CATALOG_COMPARISON_REQUIRED')


def native(death_stage=None):
    global _NATIVE_FAILURE
    _NATIVE_FAILURE = None
    with diagnostic_stage('owner_requirement'):
        require_owner()
    with diagnostic_stage('source_snapshot'):
        original = batch.replay.originals_snapshot()
    with diagnostic_stage('owned_lifecycle'), legacy.OwnedPostgres() as h:
        with diagnostic_stage('accepted_inputs'), core.AcceptedInputs(h):
            with diagnostic_stage('reference_prepare'):
                helper_lower = datetime.now(timezone.utc)
                dedupe.prepare_reference(h, 'fixed-target')
                helper_bounds = (helper_lower, datetime.now(timezone.utc))
            with diagnostic_stage('canary_setup'):
                h.reset(CANARY)
                h.sql(CANARY, 'CREATE TABLE public.alignment_canary(id integer PRIMARY KEY, value text); INSERT INTO public.alignment_canary VALUES(1,\'preserved\');', 'alignment_canary')
            command = ['bash', str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'), '--fixed-target-prefix-proof']
            with diagnostic_stage('actual63_child'):
                actual_lower = datetime.now(timezone.utc)
                check(batch.replay.serve_child(legacy, h, command, 'fixed-target') == 0, 'ALIGNMENT_ACTUAL63_CHILD_REQUIRED')
                actual_bounds = (actual_lower, datetime.now(timezone.utc))
        with diagnostic_stage('alignment_reference'):
            proof = AlignmentProof(h, actual_bounds, helper_bounds)
        with diagnostic_stage('next_catalog_receipt'):
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
        with diagnostic_stage('native_cases'):
            with diagnostic_stage('catalog_controls'):
                native_final_catalog_controls(proof)
            with diagnostic_stage('timestamp_control'):
                native_timestamp_controls(proof)
            with diagnostic_stage('behavior_cases'):
                cases.run(sys.modules[__name__], proof)
        with diagnostic_stage('final_privacy'):
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
        with diagnostic_stage('controller_deaths'):
            cases.controller_deaths(sys.modules[__name__])


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException as error:
        # Closed diagnostic: no raw SQL, args/text, paths, identities or results.
        receipt = _NATIVE_FAILURE or failure_receipt('entry', error)
        print('FAIL customer alignment ' + json.dumps(receipt, sort_keys=True), file=sys.stderr)
        raise SystemExit(1)
