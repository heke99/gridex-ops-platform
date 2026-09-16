#!/usr/bin/env python3
"""Local guards for immutable source admission and qualified SQL failures."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location(
    'fk_controls', Path(__file__).with_name('canonical-existing-column-fk-selftest.py'))
controls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)


class ExistingColumnFkControls(unittest.TestCase):
    def test_source_selection_rejects_modified_historical_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name, digest, table = controls.SOURCES[0]
            (root / name).write_text('alter table public.customer_documents add column contract_id uuid;')
            with self.assertRaisesRegex(ValueError, 'IMMUTABLE_FK_SOURCE_CHANGED'):
                controls.source_statement(name, digest, table, root)

    def test_expected_failure_rejects_unrelated_or_multiple_errors(self):
        for stderr in ('ERROR:  23505: duplicate\n',
                       'ERROR:  23503: expected\nERROR:  23503: other\n',
                       'ERROR:  23503: EXISTING_COLUMN_FK_ORPHANS\nFATAL:  08006: lost connection\n',
                       'ERROR:  23503: different preflight\n'):
            with self.assertRaisesRegex(ValueError, 'UNQUALIFIED_SQL_FAILURE'):
                controls.check_result(SimpleNamespace(returncode=3, stderr=stderr, stdout=''),
                                      '23503', 'EXISTING_COLUMN_FK_ORPHANS')

    def test_candidate_selection_rejects_modified_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidate.sql'
            path.write_text(controls.read_candidate() + '\nselect 1;\n')
            with self.assertRaisesRegex(ValueError, 'FK_CANDIDATE_CHANGED'):
                controls.read_candidate(path)

    def test_expected_rejection_cannot_pass_on_sql_success(self):
        with self.assertRaisesRegex(ValueError, 'EXPECTED_SQL_REJECTION'):
            controls.check_result(SimpleNamespace(returncode=0, stderr='', stdout=''), '23503')

    def test_exact_preflight_error_is_recognized(self):
        controls.check_result(SimpleNamespace(returncode=3, stdout='', stderr=
            'psql:<stdin>:9: ERROR:  23503: EXISTING_COLUMN_FK_ORPHANS\nCONTEXT:  fixture\n'),
            '23503', 'EXISTING_COLUMN_FK_ORPHANS')


if __name__ == '__main__':
    unittest.main(verbosity=2)
