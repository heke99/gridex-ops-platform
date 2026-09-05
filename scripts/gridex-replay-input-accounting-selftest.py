#!/usr/bin/env python3
"""Run the real replay selector on isolated SQL/manifest fixtures, without a DB."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / 'scripts/gridex-replay-input-accounting.py'


class InputAccountingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'supabase/migrations').mkdir(parents=True)
        shutil.copytree(ROOT / 'supabase/bootstrap', self.root / 'supabase/bootstrap')
        shutil.copyfile(ROOT / 'scripts/gridex-aud-003-clean-replay.sh',
                        self.root / 'scripts/gridex-aud-003-clean-replay.sh')
        self.pins = {}
        self.add_sql('migrations/legacy.sql')
        self.add_sql('migrations/20260101000000_first.sql')
        self.add_sql('migrations/excluded.sql')
        self.plan = {'foundation': ['migrations/legacy.sql'], 'derivedBootstrap': {}}
        self.additions = {'foundation': [], 'derivedBootstrap': {}, 'interleaved': []}
        self.excluded = [{'path': 'migrations/excluded.sql',
                          'sha256': self.pins['excluded.sql'],
                          'status': 'merged_repository_artifact_not_deployed',
                          'reason': 'Fixture-only exclusion', 'evidence': ['fixture review']}]

    def add_sql(self, rel, body='select 1;\n'):
        path = self.root / 'supabase' / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if rel.startswith('migrations/'):
            self.pins[path.name] = digest
        return digest

    def substitute(self, source, preserve=False):
        rel = 'bootstrap/derived.sql'
        digest = self.add_sql(rel)
        self.plan['foundation'].append(rel)
        self.plan['derivedBootstrap'][rel] = {
            'source': source, 'artifactSha256': digest, 'preserveSourceReplay': preserve}

    def run_checker(self, *args):
        manifests = {
            'migration-history-manifest.json': {'files': self.pins},
            'gridex-aud-003-legacy-foundation.json': self.plan,
            'gridex-aud-003-legacy-foundation.additions.json': self.additions,
            'gridex-aud-003-foundation-order.json': {'foundation': self.plan['foundation']},
            'gridex-aud-003-noncanonical-artifacts.json': {'artifacts': self.excluded},
        }
        for name, data in manifests.items():
            (self.root / 'scripts' / name).write_text(json.dumps(data))
        result = subprocess.run([sys.executable, str(CHECKER), '--root', str(self.root), *args],
                                text=True, capture_output=True)
        self.assertTrue(result.stdout.strip(), result.stderr)
        return result.returncode, json.loads(result.stdout)

    def add_reviewed_diagnostic(self, name):
        rel = 'migrations/' + name
        body = (ROOT / 'supabase' / rel).read_text()
        self.excluded.append({'path': rel, 'sha256': self.add_sql(rel, body),
            'status': 'historical_read_only_diagnostic',
            'reason': 'Exact reviewed diagnostic, no persistent schema or data effects',
            'evidence': ['repo:quality/audits/LEGACY_REPLAY_CLASSIFICATION_2026-09-05.md']})
        return rel

    def test_reviewed_diagnostics_are_excluded_without_execution_claim(self):
        for name in ('20260525_debug_batch_2j_verify_no_old_afshin_id.sql',
                     '20260525_verify_company_user_provisioning_flow.sql'):
            self.add_reviewed_diagnostic(name)
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 0, report)
        self.assertEqual(report['counts']['EXPLICITLY_EXCLUDED'], 3)
        self.assertFalse(report['sqlExecutionVerified'])
        self.assertFalse(report['ledgerProvenanceVerified'])

    def test_diagnostic_sql_change_rejected_even_with_refreshed_manifest_hashes(self):
        rel = self.add_reviewed_diagnostic('20260525_verify_company_user_provisioning_flow.sql')
        original = (self.root / 'supabase' / rel).read_text()
        for sql in ('CREATE TABLE forbidden(id int);', 'DELETE FROM public.roles;',
                    'WITH changed AS (DELETE FROM public.roles RETURNING *) SELECT * FROM changed;',
                    'SELECT public.unreviewed_function();', 'SELECT 1 INTO forbidden;',
                    'SELECT 1;'):
            with self.subTest(sql=sql):
                self.excluded[-1]['sha256'] = self.add_sql(rel, original + '\n' + sql)
                code, report = self.run_checker()
                self.assertEqual(code, 2, report)
                self.assertIn('reviewed diagnostic', ' '.join(report['errors']))

    def test_unreviewed_diagnostic_path_rejected(self):
        self.excluded[0]['status'] = 'historical_read_only_diagnostic'
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('reviewed diagnostic', ' '.join(report['errors']))

    def test_unknown_exclusion_status_rejected(self):
        self.excluded[0]['status'] = 'diagnostic_probably_safe'
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('classification', ' '.join(report['errors']))

    def test_exhaustive_selection_has_no_execution_or_ledger_claim(self):
        code, report = self.run_checker()
        self.assertEqual(code, 0)
        self.assertEqual(report['counts'], {'FULL_FILE_SELECTED': 2, 'SUBSTITUTED': 0,
                                           'EXPLICITLY_EXCLUDED': 1, 'UNCLASSIFIED': 0})
        self.assertEqual(report['evidenceScope'], 'INPUT_SELECTION_ONLY')
        self.assertFalse(report['ledgerProvenanceVerified'])

    def test_new_legacy_file_is_not_silently_exempt(self):
        self.add_sql('migrations/forgotten legacy.sql')
        code, report = self.run_checker()
        self.assertEqual(code, 1)
        self.assertEqual(report['counts']['UNCLASSIFIED'], 1)
        self.assertEqual(report['status'], 'UNCLASSIFIED_INPUTS')

    def test_timestamp_substitution_is_unresolved_and_strict_gate_fails(self):
        self.substitute('migrations/20260101000000_first.sql')
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 1)
        self.assertEqual(report['counts']['SUBSTITUTED'], 1)
        self.assertEqual(report['status'], 'PARTIAL_EFFECTS_UNRESOLVED')

    def test_legacy_derived_source_is_partial_not_full(self):
        self.add_sql('migrations/20250101_legacy_source.sql')
        self.substitute('migrations/20250101_legacy_source.sql')
        code, report = self.run_checker()
        self.assertEqual(code, 0)
        self.assertEqual(report['counts']['SUBSTITUTED'], 1)
        self.assertEqual(report['status'], 'PARTIAL_EFFECTS_UNRESOLVED')

    def test_preserved_timestamp_source_is_fully_selected(self):
        self.substitute('migrations/20260101000000_first.sql', preserve=True)
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 0)
        self.assertEqual(report['counts']['SUBSTITUTED'], 0)

    def test_additions_preserve_source_override_matches_real_selector(self):
        self.substitute('migrations/20260101000000_first.sql')
        self.additions['derivedBootstrap']['bootstrap/derived.sql'] = {
            **self.plan['derivedBootstrap']['bootstrap/derived.sql'], 'preserveSourceReplay': True}
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 0)
        self.assertEqual(report['counts']['SUBSTITUTED'], 0)

    def test_legacy_checksum_drift_fails_even_if_unclassified(self):
        self.add_sql('migrations/forgotten.sql')
        (self.root / 'supabase/migrations/forgotten.sql').write_text('select 2;')
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('checksum', ' '.join(report['errors']))

    def test_exclusion_cannot_overlap_direct_legacy_foundation(self):
        self.plan['foundation'].append('migrations/excluded.sql')
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('overlap', ' '.join(report['errors']))

    def test_exclusion_cannot_overlap_legacy_substitution(self):
        self.substitute('migrations/excluded.sql')
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('overlap', ' '.join(report['errors']))

    def test_duplicate_exclusions_fail(self):
        self.excluded.append(dict(self.excluded[0]))
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('duplicate', ' '.join(report['errors']))

    def test_nested_sql_is_accounted_and_not_basename_selected(self):
        self.add_sql('migrations/nested/20260101000000_first.sql')
        code, report = self.run_checker()
        self.assertEqual(code, 1)
        self.assertEqual(report['counts']['UNCLASSIFIED'], 1)

    def test_selector_format_change_fails_closed(self):
        (self.root / 'scripts/gridex-aud-003-clean-replay.sh').write_text('# missing selector\n')
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('selector', ' '.join(report['errors']))

    def test_unapproved_timestamp_collision_fails(self):
        self.add_sql('migrations/20260101000000_other.sql')
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('collision', ' '.join(report['errors']))

    def test_derived_artifact_checksum_drift_fails(self):
        self.substitute('migrations/20260101000000_first.sql')
        (self.root / 'supabase/bootstrap/derived.sql').write_text('select 2;')
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('checksum', ' '.join(report['errors']))

    def test_conflicting_history_checksum_overrides_fail(self):
        (self.root / 'scripts/migration-history-manifest.additions.json').write_text(
            json.dumps({'files': {'legacy.sql': '0' * 64}}))
        code, report = self.run_checker()
        self.assertEqual(code, 2)
        self.assertIn('conflicting', ' '.join(report['errors']))

    def test_interleaved_substitution_uses_actual_order(self):
        self.add_sql('migrations/20260103000000_last.sql')
        source = 'migrations/20260102000000_replaced.sql'
        self.add_sql(source)
        rel = 'bootstrap/between.sql'
        digest = self.add_sql(rel)
        self.additions['derivedBootstrap'][rel] = {'source': source, 'artifactSha256': digest}
        self.additions['interleaved'].append({'path': rel,
            'afterLedgerVersion': '20260101000000', 'beforeLedgerVersion': '20260103000000'})
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 1)
        row = next(row for row in report['migrations'] if row['path'] == source)
        self.assertEqual(row['classification'], 'SUBSTITUTED')
        self.assertEqual(row['derivedArtifacts'][0]['ordinal'], 2)
        self.assertEqual(row['derivedArtifacts'][0]['stage'], 'timestamp')

    def test_read_only_inventory_does_not_mutate_repository_inputs(self):
        self.run_checker()  # Materialize fixture manifests before the comparison.
        before = {p.relative_to(self.root): p.read_bytes()
                  for p in self.root.rglob('*') if p.is_file()}
        self.run_checker()
        after = {p.relative_to(self.root): p.read_bytes()
                 for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
