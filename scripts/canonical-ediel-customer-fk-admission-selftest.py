#!/usr/bin/env python3
"""Static admission of the exact CLI-created migration, not a database claim."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load():
    path = ROOT/'scripts/canonical-ediel-customer-fk-qualification.py'
    spec = importlib.util.spec_from_file_location('ediel_forward_contract', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ForwardAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.module = load()

    def test_real_migration_is_the_exact_previously_native_qualified_program(self):
        m = self.module
        raw = m.read_candidate().encode()
        self.assertEqual(m.CANDIDATE, ROOT/'supabase/migrations'/m.FORWARD_NAME)
        self.assertEqual(raw, (ROOT/'scripts/sql/forward-candidates/ediel-intent-customer-company-fk.sql').read_bytes())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), m.CANDIDATE_SHA)
        additions = json.loads((ROOT/'scripts/migration-history-manifest.runtime.additions.json').read_text())
        self.assertEqual(additions['files'][m.FORWARD_NAME], m.CANDIDATE_SHA)
        self.assertNotEqual(m.FORWARD_NAME, m.ORIGINAL)
        m.original(m.ORIGINAL)
        m.original(m.CLASSIFICATION)

    def test_changed_bytes_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'migration.sql'
            path.write_bytes(self.module.CANDIDATE.read_bytes()+b'\n-- altered\n')
            with patch.object(self.module, 'CANDIDATE', path):
                with self.assertRaisesRegex(ValueError, 'FK_CANDIDATE_HASH_MISMATCH'):
                    self.module.read_candidate()

    def test_missing_file_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(self.module, 'CANDIDATE', Path(directory)/'missing.sql'):
                with self.assertRaisesRegex(ValueError, 'FK_CANDIDATE_REQUIRED'):
                    self.module.read_candidate()

    def test_symlink_rejected_even_for_the_exact_program(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'linked.sql'
            path.symlink_to(self.module.CANDIDATE)
            with patch.object(self.module, 'CANDIDATE', path):
                with self.assertRaisesRegex(ValueError, 'FK_CANDIDATE_REQUIRED'):
                    self.module.read_candidate()

    def test_catalog_acceptance_rejects_unrelated_security_change(self):
        m = self.module
        before = {'relation/public.ediel_message_intents': {'rls': True}}
        expected = {**before, m.KEY: m.EXPECTED}
        m.equal_catalog(before, expected)
        changed = {**expected, 'relation/public.ediel_message_intents': {'rls': False}}
        with self.assertRaisesRegex(ValueError, 'FK_UNRELATED_CATALOG_CHANGE'):
            m.equal_catalog(before, changed)

    def test_catalog_acceptance_rejects_old_or_missing_key(self):
        m = self.module
        with self.assertRaisesRegex(ValueError, 'FK_UNRELATED_CATALOG_CHANGE'):
            m.equal_catalog({}, {})
        old = {**m.EXPECTED, 'definition': m.EXPECTED['definition'].replace(' (customer_id)', '')}
        with self.assertRaisesRegex(ValueError, 'FK_UNRELATED_CATALOG_CHANGE'):
            m.equal_catalog({}, {m.KEY: old})


if __name__ == '__main__':
    unittest.main(verbosity=2)
