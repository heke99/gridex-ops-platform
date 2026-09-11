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


OPERATIONAL_REPAIR_FIXTURE = {'path': 'migrations/02_db2b_apply_superadmin_and_membership.sql',
 'sha256': '64671e13a4390e0d464a24198cd6ad27a38908c9816e3c597dc5119afc95dbc4',
 'status': 'historical_operational_data_repair',
 'finding': 'OPERATIONAL-REPAIR-2026-09-06',
 'reason': 'Reviewed fixed-target administrator and company membership repair with operational '
           'backfill/audit records only. No generic role seeds or schema definitions. Exclusion '
           'makes no deployment-history claim and does not authorize execution. Trigger source '
           'dependencies bind the reviewed audit normalization, administrator audit, and '
           'last-admin guard bodies; those schema-bearing sources remain independently accounted.',
 'evidence': ['repo:quality/audits/OPERATIONAL_REPAIR_CLASSIFICATION_2026-09-06.md'],
 'reviewedDependencies': [{'path': 'migrations/20260611150000_launch_readiness_security_routes_stats.sql',
                           'sha256': '3fa71292b07e4534dab13c1f2ef28574a0635fad17db736201f4eed23f6dd053'},
                          {'path': 'migrations/20260727040000_contract_security_energy_direction_api_completion.sql',
                           'sha256': 'c608cb8ca01792971c7dd3974b63138f8ec5d016b643eeff2f7d49f721a9867e'},
                          {'path': 'migrations/20260802170000_canonical_security_convergence.sql',
                           'sha256': 'e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a'}]}


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

    def add_reviewed_operational_repair(self):
        entry = OPERATIONAL_REPAIR_FIXTURE.copy()
        entry['reviewedDependencies'] = [dict(item) for item in entry['reviewedDependencies']]
        for item in [entry, *entry['reviewedDependencies']]:
            self.add_sql(item['path'], (ROOT / 'supabase' / item['path']).read_text())
        self.excluded.append(entry)
        return entry

    def test_reviewed_operational_repair_excluded_dependencies_independently_selected(self):
        self.add_reviewed_operational_repair()
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 0, report)
        self.assertEqual(report['counts']['EXPLICITLY_EXCLUDED'], 2)
        self.assertFalse(report['sqlExecutionVerified'])
        self.assertFalse(report['ledgerProvenanceVerified'])

    def test_operational_disposition_does_not_close_other_legacy_inputs(self):
        self.add_reviewed_operational_repair()
        self.add_sql('migrations/01_unresolved_schema.sql', 'CREATE TABLE synthetic_fixture(id int);')
        code, report = self.run_checker('--require-full-effects')
        self.assertEqual(code, 1, report)
        self.assertEqual(report['counts']['UNCLASSIFIED'], 1)
        self.assertEqual(report['counts']['EXPLICITLY_EXCLUDED'], 2)

    def test_operational_repair_changed_sql_rejected_with_refreshed_json(self):
        entry = self.add_reviewed_operational_repair()
        for sql in ('CREATE TABLE synthetic_fixture(id int);', 'INSERT INTO public.roles DEFAULT VALUES;',
                    'SELECT public.synthetic_helper();', 'SELECT 1;'):
            with self.subTest(sql=sql):
                entry['sha256'] = self.add_sql(entry['path'], sql)
                code, report = self.run_checker()
                self.assertEqual(code, 2, report)
                self.assertIn('reviewed operational', ' '.join(report['errors']))

    def test_operational_unknown_path_rejected(self):
        self.excluded[0]['status'] = 'historical_operational_data_repair'
        self.excluded[0]['reviewedDependencies'] = []
        code, report = self.run_checker()
        self.assertEqual(code, 2, report)
        self.assertIn('reviewed operational', ' '.join(report['errors']))

    def test_operational_missing_or_unknown_dependency_pin_rejected(self):
        entry = self.add_reviewed_operational_repair()
        deps = entry['reviewedDependencies']
        for replacement in (None, [], deps[:-1], deps + [{'path': 'migrations/unknown.sql', 'sha256': 'a'*64}]):
            with self.subTest(dependencies=replacement):
                entry['reviewedDependencies'] = replacement
                code, report = self.run_checker()
                self.assertEqual(code, 2, report)
                self.assertIn('operational', ' '.join(report['errors']))

    def test_operational_dependency_content_change_rejected_with_refreshed_json(self):
        entry = self.add_reviewed_operational_repair()
        dependency = entry['reviewedDependencies'][0]
        dependency['sha256'] = self.add_sql(dependency['path'], 'SELECT 1;')
        code, report = self.run_checker()
        self.assertEqual(code, 2, report)
        self.assertIn('operational', ' '.join(report['errors']))

    def test_operational_dependency_missing_file_rejected(self):
        entry = self.add_reviewed_operational_repair()
        (self.root / 'supabase' / entry['reviewedDependencies'][0]['path']).unlink()
        code, report = self.run_checker()
        self.assertEqual(code, 2, report)

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

    def test_two_bootstraps_must_both_preserve_source(self):
        source = 'migrations/20260101000000_first.sql'
        self.substitute(source, preserve=True)
        rel = 'bootstrap/later-derived.sql'
        digest = self.add_sql(rel)
        self.plan['foundation'].append(rel)
        self.additions['derivedBootstrap'][rel] = {
            'source': source, 'artifactSha256': digest, 'preserveSourceReplay': True}
        declarations = [self.plan['derivedBootstrap']['bootstrap/derived.sql'],
                        self.additions['derivedBootstrap'][rel]]
        for first, second, expected in [(True, True, 'FULL_FILE_SELECTED'),
                                         (False, True, 'SUBSTITUTED'),
                                         (True, False, 'SUBSTITUTED')]:
            with self.subTest(first=first, second=second):
                declarations[0]['preserveSourceReplay'] = first
                declarations[1]['preserveSourceReplay'] = second
                code, report = self.run_checker('--require-full-effects')
                row = next(row for row in report['migrations'] if row['path'] == source)
                self.assertEqual(row['classification'], expected)
                self.assertEqual(code, 0 if first and second else 1)

    def test_read_only_inventory_does_not_mutate_repository_inputs(self):
        self.run_checker()  # Materialize fixture manifests before the comparison.
        before = {p.relative_to(self.root): p.read_bytes()
                  for p in self.root.rglob('*') if p.is_file()}
        self.run_checker()
        after = {p.relative_to(self.root): p.read_bytes()
                 for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)


# Independent literal expectations from the reviewed source-effects brief. These
# tests run the Python selector itself and the separate JS validator, never SQL.
DB2_REPAIR_FIXTURE = {'path': 'migrations/02_db2_execute_controlled_reconciliation.sql',
 'sha256': 'fcdc75e660f157a58e742f64b3e8f7a1c6801565ef16023bd0c9a317982744c9',
 'status': 'historical_operational_data_repair',
 'finding': 'OPERATIONAL-REPAIR-DB2-2026-09-11',
 'reason': 'Reviewed DB2 operational reconciliation and nested '
           'membership/profile/customer/link/run/item/finding/audit writes, customer-number allocation, and '
           'conditional partner events and queued deliveries. No schema or reference seed effect. No '
           'deployment-history or execution authorization claim. Schema-bearing dependencies remain '
           'independently accounted.',
 'evidence': ['repo:quality/audits/OPERATIONAL_REPAIR_CLASSIFICATION_2026-09-06.md',
              'repo:quality/audits/DB2_CONTROLLED_RECONCILIATION_SOURCE_EFFECTS_2026-09-11.md'],
 'reviewedDependencies': [{'path': 'migrations/01_db2_full_view_preflight_schema_and_functions.sql',
                           'sha256': '4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9'},
                          {'path': 'migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql',
                           'sha256': '85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2'},
                          {'path': 'migrations/03_db1_backfill_functions_rls_reports_and_finish.sql',
                           'sha256': '877e395df0050a36ec71298d279c72fb0e6cb13d8b90082277450012e196f169'},
                          {'path': 'migrations/20260522_db1_schema_repair_backfill_foundation.sql',
                           'sha256': 'aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73'},
                          {'path': 'migrations/20260612203000_company_customer_number_prefix_hardening.sql',
                           'sha256': '39f6c82ca05f6876e347c58f2b60a24c358c9a72fe856e42d7474f03f9f66065'},
                          {'path': 'migrations/20260719120000_canonical_customer_number_assignment.sql',
                           'sha256': '259817d0c2fb43e83478b78184fd3d41125636d527e1edd2801783009326fe1e'},
                          {'path': 'migrations/20260727040000_contract_security_energy_direction_api_completion.sql',
                           'sha256': 'c608cb8ca01792971c7dd3974b63138f8ec5d016b643eeff2f7d49f721a9867e'},
                          {'path': 'migrations/20260802170000_canonical_security_convergence.sql',
                           'sha256': 'e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a'},
                          {'path': 'migrations/20260816170000_partner_api_v1_canonical_surface_events.sql',
                           'sha256': '1faa62377d47df7159ccf5440d4dbee44acd12860d440a19b80b643a4fcd6a4b'}]}


class DB2DispositionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gridex-db2-disposition-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for rel in ('supabase/migrations', 'supabase/bootstrap'):
            shutil.copytree(ROOT / rel, self.root / rel)
        (self.root / 'scripts').mkdir()
        (self.root / 'docs').mkdir()
        for pattern in ('gridex-aud-003-*.json', 'migration-history-manifest*.json'):
            for source in (ROOT / 'scripts').glob(pattern):
                shutil.copyfile(source, self.root / 'scripts' / source.name)
        for name in ('gridex-aud-003-clean-replay.sh',
                     'gridex-aud-003-migration-provenance-regression.cjs',
                     'gridex-aud-003-schema-fingerprint.sql'):
            shutil.copyfile(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        for name in ('migration-provenance.md', 'production-runbook.md'):
            shutil.copyfile(ROOT / 'docs' / name, self.root / 'docs' / name)
        self.entry = json.loads(json.dumps(DB2_REPAIR_FIXTURE))
        self.contract = self.read_json('gridex-aud-003-noncanonical-artifacts.json')
        self.contract['artifacts'] = [item for item in self.contract['artifacts']
                                      if item['path'] != self.entry['path']] + [self.entry]
        self.save_contract()

    def read_json(self, name):
        return json.loads((self.root / 'scripts' / name).read_text())

    def write_json(self, name, data):
        (self.root / 'scripts' / name).write_text(json.dumps(data))

    def save_contract(self):
        self.write_json('gridex-aud-003-noncanonical-artifacts.json', self.contract)

    def set_history_pin(self, source, pin):
        originals = {}
        for path in (self.root / 'scripts').glob('migration-history-manifest*.json'):
            data = json.loads(path.read_text())
            if source.name in data.get('files', {}):
                originals[path] = path.read_bytes()
                data['files'][source.name] = pin
                path.write_text(json.dumps(data))
        self.assertTrue(originals, source.name)
        return originals

    def restore_history(self, originals):
        for path, content in originals.items():
            path.write_bytes(content)

    def validators(self):
        shell = (self.root / 'scripts/gridex-aud-003-clean-replay.sh').read_text()
        header = ('python3 - "$HISTORY" "$HISTORY_ADDITIONS" "$HISTORY_RUNTIME_ADDITIONS" '
                  '"$FOUNDATION_PLAN" "$FOUNDATION_ADDITIONS" "$FOUNDATION_ORDER" '
                  '"$NONCANONICAL" "$SUPABASE" "$HOLD" "$FOUNDATION_EXEC" "$TIMESTAMP_EXEC" <<\'PY\'\n')
        selector = shell.split(header, 1)[1].split('\nPY\n', 1)[0]
        names = ('migration-history-manifest.json', 'migration-history-manifest.additions.json',
                 'migration-history-manifest.runtime.additions.json',
                 'gridex-aud-003-legacy-foundation.json',
                 'gridex-aud-003-legacy-foundation.additions.json',
                 'gridex-aud-003-foundation-order.json',
                 'gridex-aud-003-noncanonical-artifacts.json')
        args = [self.root / 'scripts' / name for name in names]
        args += [self.root / 'supabase', self.root / 'supabase/migrations',
                 self.root / 'foundation.out', self.root / 'timestamp.out']
        return {
            'selector': subprocess.run([sys.executable, '-', *map(str, args)], input=selector,
                                       text=True, capture_output=True, timeout=60),
            'provenance': subprocess.run(['node', str(self.root / 'scripts/gridex-aud-003-migration-provenance-regression.cjs')],
                                         text=True, capture_output=True, timeout=60),
        }

    def assert_rejected(self, cause='operational'):
        self.save_contract()
        for validator, result in self.validators().items():
            with self.subTest(validator=validator):
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn(cause, result.stderr, result.stderr)

    def test_db2_exact_source_is_excluded_without_selecting_schema_companions(self):
        results = self.validators()
        for validator, result in results.items():
            with self.subTest(validator=validator):
                self.assertEqual(result.returncode, 0, result.stderr)
        if any(result.returncode for result in results.values()):
            return
        self.assertNotIn(self.entry['path'].split('/')[-1],
                         (self.root / 'foundation.out').read_text() + (self.root / 'timestamp.out').read_text())
        # Exercise the repository declaration too: fixture injection alone cannot
        # prove that the shipped JSON actually classifies this source.
        result = subprocess.run([sys.executable, str(CHECKER), '--require-full-effects'],
                                text=True, capture_output=True, timeout=60)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1, report)
        self.assertEqual(report['counts'], {'FULL_FILE_SELECTED': 546, 'SUBSTITUTED': 23,
                                          'UNCLASSIFIED': 26, 'EXPLICITLY_EXCLUDED': 5})
        self.assertEqual(report['selectedInputCounts'], {'foundation': 104, 'timestamp': 510})
        rows = {row['path']: row for row in report['migrations']}
        self.assertEqual(rows[self.entry['path']]['classification'], 'EXPLICITLY_EXCLUDED')
        self.assertEqual(rows['migrations/02_db2b_apply_superadmin_and_membership.sql']['classification'], 'EXPLICITLY_EXCLUDED')
        for name in ('01_db2_full_view_preflight_schema_and_functions.sql',
                     '01_db2b_preflight_views.sql', '03_db2_validation_and_finish.sql',
                     '03_db2b_validation_views.sql', '20260522_db1_schema_repair_backfill_foundation.sql'):
            row = rows['migrations/' + name]
            self.assertEqual(row['classification'], 'UNCLASSIFIED', name)
            self.assertEqual(row['execution'], [], name)
            self.assertEqual(row['derivedArtifacts'], [], name)
        self.assertFalse(report['sqlExecutionVerified'])
        self.assertFalse(report['ledgerProvenanceVerified'])

    def test_source_bytes_and_pin_cannot_be_refreshed_into_exclusion(self):
        source = self.root / 'supabase' / self.entry['path']
        source.write_bytes(source.read_bytes() + b'\nSELECT public.unreviewed_helper();\n')
        self.entry['sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        self.set_history_pin(source, self.entry['sha256'])
        self.assert_rejected()

    def test_each_dependency_pin_is_independently_bound(self):
        for dependency in self.entry['reviewedDependencies']:
            original = dependency['sha256']
            with self.subTest(path=dependency['path']):
                dependency['sha256'] = '0' * 64
                self.assert_rejected()
            dependency['sha256'] = original

    def test_each_dependency_bytes_rejected_even_with_refreshed_history_and_json(self):
        for dependency in self.entry['reviewedDependencies']:
            source = self.root / 'supabase' / dependency['path']
            original, pin = source.read_bytes(), dependency['sha256']
            with self.subTest(path=dependency['path']):
                source.write_bytes(original + b'\nSELECT public.unreviewed_helper();\n')
                dependency['sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
                history = self.set_history_pin(source, dependency['sha256'])
                self.assert_rejected()
            source.write_bytes(original)
            dependency['sha256'] = pin
            self.restore_history(history)

    def test_dependency_missing_file_and_history_pin_rejected(self):
        for dependency in self.entry['reviewedDependencies']:
            source = self.root / 'supabase' / dependency['path']
            original = source.read_bytes()
            with self.subTest(path=dependency['path'], mutation='missing file'):
                source.unlink()
                self.assert_rejected(cause='missing')
            source.write_bytes(original)
            history = self.set_history_pin(source, '0' * 64)
            with self.subTest(path=dependency['path'], mutation='history pin'):
                self.assert_rejected(cause='checksum')
            self.restore_history(history)

    def test_removed_extra_reordered_dependencies_and_unknown_source_rejected(self):
        deps = self.entry['reviewedDependencies']
        for replacement in (None, [], *[deps[:i] + deps[i+1:] for i in range(9)],
                            deps + [deps[0]], list(reversed(deps))):
            with self.subTest(dependencies=replacement):
                self.entry['reviewedDependencies'] = replacement
                self.assert_rejected()
        self.entry['reviewedDependencies'] = deps
        self.entry['path'] = 'migrations/unreviewed_db2_execution.sql'
        self.assert_rejected()

    def test_execution_and_substitution_cannot_overlap_db2_exclusion(self):
        for substitution in (False, True):
            name = 'gridex-aud-003-legacy-foundation.additions.json'
            plan = self.read_json(name)
            order = self.read_json('gridex-aud-003-foundation-order.json')
            changed = json.loads(json.dumps(plan))
            changed_order = json.loads(json.dumps(order))
            rel = self.entry['path']
            if substitution:
                rel = 'bootstrap/db2-overlap-fixture.sql'
                target = self.root / 'supabase' / rel
                target.write_text('SELECT 1;\n')
                changed['derivedBootstrap'][rel] = {'source': self.entry['path'],
                    'artifactSha256': hashlib.sha256(target.read_bytes()).hexdigest()}
            changed['foundation'].append(rel)
            changed_order['foundation'].append(rel)
            self.write_json(name, changed)
            self.write_json('gridex-aud-003-foundation-order.json', changed_order)
            with self.subTest(substitution=substitution):
                self.assert_rejected(cause='overlap')
            self.write_json(name, plan)
            self.write_json('gridex-aud-003-foundation-order.json', order)

    def test_interleaved_artifact_cannot_be_excluded(self):
        name = 'gridex-aud-003-legacy-foundation.additions.json'
        plan = self.read_json(name)
        rel = self.entry['path']
        plan['derivedBootstrap'][rel] = {
            'source': 'migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql',
            'artifactSha256': self.entry['sha256'], 'preserveSourceReplay': True}
        plan['interleaved'].append({**plan['interleaved'][0], 'path': rel})
        self.write_json(name, plan)
        self.assert_rejected(cause='overlap')

    def test_interleaved_derived_source_cannot_be_excluded(self):
        name = 'gridex-aud-003-legacy-foundation.additions.json'
        plan = self.read_json(name)
        rel = 'bootstrap/db2-interleaved-overlap-fixture.sql'
        target = self.root / 'supabase' / rel
        target.write_text('SELECT 1;\n')
        plan['derivedBootstrap'][rel] = {
            'source': self.entry['path'],
            'artifactSha256': hashlib.sha256(target.read_bytes()).hexdigest()}
        plan['interleaved'].append({**plan['interleaved'][0], 'path': rel})
        self.write_json(name, plan)
        self.assert_rejected(cause='overlap')


if __name__ == '__main__':
    unittest.main()
