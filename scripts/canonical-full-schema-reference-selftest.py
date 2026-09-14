#!/usr/bin/env python3
"""Negative controls for full-schema comparison and source admission; no SQL."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('full_reference', ROOT/'scripts/canonical-full-schema-reference.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def document():
    return {'schemas':['public'], **{key:[] for key in m.KEYS}}


class ReferenceTests(unittest.TestCase):
    def test_identical_projection_is_not_a_release_or_ledger_claim(self):
        result = m.compare(document(), document())
        self.assertTrue(result['publicSnapshotEqual'])
        for field in ('schemaAccepted','ledgerProvenanceVerified','generatedTypesVerified','productionModified'):
            self.assertIs(result[field], False)

    def test_all_existing_parity_sections_are_mandatory(self):
        for section in m.KEYS:
            bad = document(); del bad[section]
            with self.assertRaisesRegex(ValueError, 'COMPLETE_SCHEMA_DOCUMENT_REQUIRED'):
                m.compare(document(), bad)
        bad = document(); bad['schemas'] = []
        with self.assertRaisesRegex(ValueError, 'COMPLETE_SCHEMA_DOCUMENT_REQUIRED'):
            m.compare(document(), bad)

    def test_rls_and_forced_rls_cannot_disappear(self):
        before = document()
        before['relations'] = [{'nspname':'public','relname':'customers','relkind':'r',
                                'relrowsecurity':True,'relforcerowsecurity':False,
                                'reloptions':[],'view_definition':None,'partition_key':None}]
        for field in ('relrowsecurity','relforcerowsecurity'):
            after = copy.deepcopy(before); after['relations'][0][field] = not before['relations'][0][field]
            result = m.compare(before, after)
            self.assertFalse(result['publicSnapshotEqual'])
            self.assertEqual(result['sections']['relations']['changed'][0]['fields'], [field])
        after = document()
        self.assertEqual(len(m.compare(before, after)['sections']['relations']['removed']), 1)

    def test_policy_semantics_and_roles_are_checked_but_not_disclosed(self):
        before = document()
        before['policies'] = [{'nspname':'public','relname':'customers','polname':'tenant',
            'command':'r','permissive':True,'roles':['authenticated'],
            'using_expression':"tenant_id = 'private-test-literal'",'check_expression':''}]
        for field, value in [('using_expression','true'),('check_expression','true'),
                             ('roles',['PUBLIC']),('permissive',False),('command','*')]:
            after = copy.deepcopy(before); after['policies'][0][field] = value
            result = m.compare(before, after)
            self.assertFalse(result['publicSnapshotEqual'])
            self.assertIn(field, result['sections']['policies']['changed'][0]['fields'])
            self.assertNotIn('private-test-literal', json.dumps(result))

    def test_index_semantics_and_grants_cannot_be_silently_accepted(self):
        before = document()
        before['indexes'] = [{'nspname':'public','relname':'customers','indexname':'tenant_idx',
                               'definition':'CREATE INDEX private-test-definition','indisunique':True,'indisprimary':False}]
        after = copy.deepcopy(before); after['indexes'][0]['indisunique'] = False
        result = m.compare(before, after)
        self.assertFalse(result['publicSnapshotEqual'])
        self.assertNotIn('private-test-definition', json.dumps(result))
        after['relation_grants'] = [{'nspname':'public','relname':'customers',
                                    'grantee':'anon','privilege_type':'SELECT','is_grantable':False}]
        self.assertEqual(len(m.compare(before, after)['sections']['relation_grants']['added']), 1)

    def test_duplicate_and_incomplete_rows_fail_closed(self):
        bad = document(); bad['schema_grants'] = [{'nspname':'public','grantee':'anon',
                                                   'privilege_type':'USAGE','is_grantable':False}]*2
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_CATALOG_IDENTITY'):
            m.compare(document(), bad)
        bad = document(); bad['columns'] = [{'nspname':'public'}]
        with self.assertRaisesRegex(ValueError, 'COMPLETE_SCHEMA_DOCUMENT_REQUIRED'):
            m.compare(document(), bad)

    def test_untrusted_identity_controls_cannot_enter_the_report(self):
        for identity in ('bad\nprivate-value', 'bad\x00value', 'x'*1025, None):
            with self.assertRaisesRegex(ValueError, 'CATALOG_IDENTITY_REQUIRED'):
                m.key({'name':identity}, ('name',))

    def test_reference_comes_from_the_exact_committed_dump(self):
        data = m.pinned()
        self.assertEqual(m.sha(data['supabase/schema.sql']), m.PINS['supabase/schema.sql'])
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'ROOT', Path(directory)):
            root = Path(directory); (root/'supabase').mkdir()
            source = root/'supabase/schema.sql'; source.write_bytes(b'SELECT 1;')
            with self.assertRaisesRegex(ValueError, 'REFERENCE_INPUT_HASH_MISMATCH'):
                m.pinned()
            source.unlink(); source.symlink_to(ROOT/'supabase/schema.sql')
            with self.assertRaisesRegex(ValueError, 'REFERENCE_INPUT_REQUIRED'):
                m.pinned()


if __name__ == '__main__':
    unittest.main(verbosity=2)
