#!/usr/bin/env python3
"""Construction and orchestration negatives; never a substitute for native SQL."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('runner', ROOT / 'scripts/canonical-permission-native-runner.py')
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_finite_case_and_baseline_contract(self):
        fixture = runner.fixture
        cases = fixture.build_cases()
        self.assertEqual(set(cases), {f'{prefix}{i:02}' for prefix, size in [('P',28),('C',32),('F',16),('S',24),('D',27)] for i in range(1,size+1)} | {'S_VIEWER','S_UPSERT_OWN'})
        self.assertEqual(set(runner.baseline_cases()), {'P05','P06','P07','S13','S14','S15','S16','S20','S22','S_VIEWER'})
        self.assertNotEqual(runner.baseline_cases()['P05'], cases['P05'])
        self.assertNotEqual(runner.baseline_cases()['S14'], cases['S14'])

    def test_each_case_rolls_back_then_proves_terminal_marker(self):
        sql = runner.case_sql('P01', runner.fixture.build_cases()['P01'])
        self.assertTrue(sql.startswith('begin;\n'))
        self.assertIn("set local timezone='UTC';", sql)
        self.assertIn('rollback;\nselect', sql)
        self.assertTrue(sql.endswith("'PERMISSION_CASE_COMPLETE';\n"))
        with self.assertRaises(ValueError):
            runner.case_sql('secret from SQL', '')

    def test_missing_terminal_receipt_is_rejected(self):
        class Target:
            def sql(self, *args, **kwargs):
                return ''
        with self.assertRaisesRegex(runner.NativeError, 'CASE_TERMINAL_MISSING'):
            runner.run_case(Target(), runner.NATIVE, 'P01', 'select 1;')

    def test_ambient_or_replay_database_is_never_accepted(self):
        for name in ['postgres','gridex_auth_legacy_replay','postgres://localhost/test','gridex_auth_legacy_native;drop database postgres']:
            with self.subTest(name=name), self.assertRaisesRegex(runner.NativeError, 'PERMISSION_DATABASE_NOT_ADMITTED'):
                runner.run_case(None, name, 'P01', '')

    def test_candidate_tamper_and_copy_drift_reject(self):
        fixture = runner.fixture
        read = Path.read_bytes
        targets = [(fixture.CANDIDATE,'FORWARD_CANDIDATE_HASH_MISMATCH')]
        if fixture.SDD.exists():
            targets.append((fixture.SDD,'FORWARD_CANDIDATE_COPY_MISMATCH'))
        for target, message in targets:
            with self.subTest(target=target):
                with patch.object(Path,'read_bytes',lambda path: read(path)+b'\n' if path==target else read(path)):
                    with self.assertRaisesRegex(fixture.admission.AdmissionError,message):
                        fixture.candidate()

    def test_acl_poison_exercises_arbitrary_and_service_grants(self):
        sql = runner.acl_poison(all_functions=True)
        for signature in runner.fixture.PRIVATE_SIGNATURES:
            self.assertIn('grant execute on function '+signature+' to service_role, fixture_permission_grantee;',sql)
        self.assertIn('grant fixture_permission_grantee to anon, authenticated, service_role with inherit true;',sql)
        self.assertIn('grant execute on function '+runner.fixture.DIAGNOSTIC_SIGNATURE+' to service_role, fixture_permission_grantee;',sql)
        self.assertNotIn('customer_document_path_allows',sql)

    def test_workflow_dedicated_lane_and_always_exact_cleanup(self):
        workflow = (ROOT / '.github/workflows/ops-hardening.yml').read_text()
        lane = workflow.split('  canonical-permission-native-proof:\n',1)[1].split('\n  readiness-operations-continuation-proof:',1)[0]
        self.assertIn('gridex-auth-legacy-permissions-${{ github.run_id }}-${{ github.run_attempt }}',lane)
        self.assertIn('if: always()',lane)
        self.assertIn('python3 -B scripts/canonical-permission-native-runner.py --cleanup-owned',lane)
        self.assertNotIn('secrets.',lane)
        self.assertNotIn('DATABASE_URL',lane)

    def test_ambient_replay_container_name_rejected(self):
        for name in ['gridex-auth-legacy-continuation-12345678', 'existing-replay', '']:
            with patch.dict(runner.os.environ, {'GRIDEX_LEGACY_CONTAINER_NAME':name}):
                with self.assertRaisesRegex(runner.NativeError, 'DEDICATED_PERMISSION_CONTAINER_REQUIRED'):
                    runner.dedicated_name()

    def test_native_orchestration_requires_full_catalog_and_rollback_preservation(self):
        class Target:
            calls = []
            def __enter__(self):
                self.name = 'gridex-auth-legacy-permissions-fixture1'
                return self
            def __exit__(self, *args):
                self.calls.append(('close',))
            def reset(self, database):
                self.calls.append(('reset',database))
            def sql(self, database, sql, stage, **kwargs):
                self.calls.append(('sql',database,stage,kwargs))
                if stage in ['baseline_catalog','baseline_rollback']:
                    return '{"rows":[],"version":"baseline"}'
                if stage in ['candidate_catalog','repeat_catalog','recovered_catalog','matrix_rollback']:
                    return '{"rows":[],"version":"candidate"}'
                return runner.TERMINAL
            def docker(self, args):
                self.calls.append(('docker',args))
            def verify_logging(self):
                self.calls.append(('logging',))
        class Owned:
            OwnedPostgres = Target
        with patch.object(runner,'owned_module',return_value=Owned), patch.object(runner,'dedicated_name'), patch('builtins.print'):
            runner.execute()
        stages = [call[2] for call in Target.calls if call[0]=='sql']
        self.assertEqual(sum(stage.startswith('case_') for stage in stages),129)
        self.assertTrue(stages.index('baseline_P05') < stages.index('candidate_first'))
        self.assertTrue(stages.index('candidate_repeat') < stages.index('candidate_acl_recovery'))
        self.assertEqual(Target.calls[-1],('close',))
        self.assertEqual({call[1] for call in Target.calls if call[0]=='sql'},runner.DATABASES)
        with patch.object(runner,'owned_module',return_value=Owned), patch.object(runner,'dedicated_name'), patch.object(runner,'capture',side_effect=[{'rows':[]},{'rows':[1]}]), patch('builtins.print'):
            with self.assertRaisesRegex(runner.NativeError,'BASELINE_ROLLBACK_DRIFT'):
                runner.execute()
        self.assertEqual(Target.calls[-1],('close',))

    def test_private_diagnostic_exposes_only_admitted_slice_or_assertion(self):
        raw = 'psql:/legacy-private/fixture-0123456789abcdef.sql:1: ERROR:  42P01: arbitrary secret payload\n'
        self.assertEqual(runner.diagnostic(raw,'source_composition'),{'source_slice':'managed_compatible_bootstrap','sql_line':1})
        source = runner.fixture.admission.compose()
        admitted = runner.fixture.admission.admit()
        for key in ['storage_bucket_foundation','storage_private_latest','override_writer']:
            line = source[:source.index(admitted[key])].count('\n')+1
            raw = f'psql:/legacy-private/fixture-0123456789abcdef.sql:{line}: ERROR:  42P01: secret payload\n'
            self.assertEqual(runner.diagnostic(raw,'source_composition'),{'source_slice':key,'sql_line':line})
        for label in ['actor_identity','affected_rows','expected_sqlstate_mismatch']:
            raw = 'psql:/legacy-private/fixture-0123456789abcdef.sql:9: ERROR:  P0001: '+label+'\n'
            self.assertEqual(runner.diagnostic(raw,'case_P01'),{'assertion':label})
        for payload in ['secret_customer_payload','actor_identity extra private text','actor_identity; SELECT secret','actor_identity\nDETAIL: secret']:
            raw = 'psql:/legacy-private/fixture-0123456789abcdef.sql:9: ERROR:  P0001: '+payload+'\n'
            result = runner.diagnostic(raw,'case_P01')
            self.assertNotIn('secret',str(result))
            if '\n' not in payload:
                self.assertEqual(result,{})
        self.assertEqual(runner.diagnostic('psql:/other/file.sql:1: ERROR: P0001: actor_identity\n','case_P01'),{})
        self.assertEqual(runner.diagnostic('psql:/legacy-private/fixture-0123456789abcdef.sql:9999999999: ERROR: 42P01: private\n','source_composition'),{})

    def test_owned_substrate_is_original_and_network_disabled(self):
        owned = runner.owned_module()
        self.assertEqual(owned.__file__,str(ROOT / 'scripts/canonical-auth-provisioning-legacy-batch.py'))
        self.assertIn("'--network','none'",Path(owned.__file__).read_text())
        self.assertEqual(runner.DATABASES,{'gridex_auth_legacy_native','gridex_auth_legacy_atomic'})


if __name__ == '__main__':
    unittest.main()
