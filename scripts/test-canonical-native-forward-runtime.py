#!/usr/bin/env python3
"""Offline forward admission regressions; actual SQL remains a separate gate."""
from dataclasses import replace
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import canonical_forward_sources as sources
import canonical_native_forward_runtime as forward
import canonical_native_timestamp_runtime as timestamp
import canonical_native_timestamp_sources as compiler

ROOT = Path(__file__).resolve().parents[1]


class ForwardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = compiler.prepare()

    def test_empty_or_modified_historical_plan_cannot_bypass_514(self):
        runner = object.__new__(timestamp.Runner)
        runner.target = SimpleNamespace(assert_native_owned=Mock())
        runner.unchanged = Mock()
        runner.entries = [None]*65
        runner.retained = [None]*65
        parent = dict(foundationInputsExecuted=144, timestampInputsExecuted=514,
            historicalTimestampTail=dict(executed=True, noOpRepeatVerified=True,
                timestampInputsExecuted=514, phase='ALL_SELECTED_TIMESTAMP_INPUTS_EXECUTED',
                whiteLabelShimCreated=False, actualLedgerRows=65, executionUnits=[]))
        with self.assertRaisesRegex(ValueError, 'FORWARD_RETAINED_HISTORICAL_PLAN_REQUIRED'):
            forward.admit(runner, replace(self.plan, units=()), parent)
        runner.unchanged.assert_not_called()

    def test_forward_programs_retain_exact_original_sources_and_cli_transaction(self):
        retained = sources.retain(ROOT)
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('reopened source')):
            programs = forward.programs(retained)
        self.assertEqual(len(programs), 5)
        for ordinal, (original, program) in enumerate(zip(retained, programs), 1):
            body, transferred = compiler.transfer_outer(original.sql)
            self.assertTrue(transferred)
            self.assertEqual(program.sql, body)
            self.assertEqual((program.source, program.source_sha256), sources.FORWARD_SOURCES[ordinal-1])
        with self.assertRaises(ValueError):
            forward.programs(tuple(reversed(retained)))

    def failure_fixture(self, folder, *, ledger, result=None, ordinal=1):
        program = forward.programs(sources.retain(ROOT))[ordinal-1]
        runner = SimpleNamespace(directory=Path(folder),target=object(),
            unchanged=Mock(),sql=Mock(return_value=True),
            native=Mock(return_value=result or SimpleNamespace(returncode=1,
                stderr=b'ERROR: NATIVE_FORWARD_LEDGER_FAULT (SQLSTATE PF002)\n' if ledger else
                       b'ERROR: NATIVE_FORWARD_POST_BODY (SQLSTATE PF001)\n')))
        def create(probe):
            path = Path(folder)/('20260915140000_'+probe.name+'.sql')
            path.write_bytes(probe.sql); path.chmod(0o600)
            stat=path.stat()
            return path,(stat.st_dev,stat.st_ino)
        runner.create = create
        return runner,program

    def test_negative_controls_require_exact_fault_and_restored_snapshot(self):
        for ordinal,ledger in ((ordinal,ledger) for ordinal in (1,2,3,4,5) for ledger in (False,True)):
            with tempfile.TemporaryDirectory() as directory:
                runner,program=self.failure_fixture(directory,ledger=ledger,ordinal=ordinal)
                with patch.object(timestamp,'native_snapshot',side_effect=[({},[]),({},[])]):
                    receipt=forward.negative(runner,program,ordinal,ledger=ledger)
                self.assertEqual(receipt['expectedSqlstate'],'PF002' if ledger else 'PF001')
                self.assertTrue(receipt['ledgerUnchanged'])
                runner.unchanged.assert_called_once()
                self.assertEqual(list(Path(directory).iterdir()),[])
                if ledger:
                    guard=runner.sql.call_args_list[0].args[0]
                    self.assertIn('NEW.name IS DISTINCT FROM',guard)
                    self.assertIn('PF009',guard)
                    self.assertIn(forward.assertion(ordinal),guard)
                    self.assertEqual(runner.sql.call_args_list[-1].args[0],forward.DROP)

    def test_new_ordinal_assertions_cover_exact_qualified_privilege_targets(self):
        inbound=forward.assertion(3)
        for table in ('inbound_ediel_match_attempts','inbound_ediel_parse_results','inbound_email_attachments'):
            self.assertIn("'"+table+"'",inbound)
        self.assertIn('SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN',inbound)
        self.assertIn('has_any_column_privilege',inbound)
        tenant=forward.assertion(4)
        for table in ('billing_disputes','billing_partner_customers','company_go_live_reviews',
                      'customer_import_batches','customer_import_rows','grid_owner_access_agreements','production_route_wizard_runs'):
            self.assertIn("'"+table+"'",tenant)
        self.assertIn("'TRUNCATE'",tenant)
        remaining=forward.assertion(5)
        self.assertIn('count(*)=22',remaining)
        self.assertIn("pg_has_role('authenticated',c.relowner,'MEMBER')",remaining)
        self.assertIn("'white_label_platform_memberships'",remaining)
        self.assertIn("'ediel_test_run_locks'",remaining)
        for ordinal in (0,6):
            with self.assertRaisesRegex(ValueError,'FORWARD_SOURCE_ORDINAL_REQUIRED'):
                forward.assertion(ordinal)

    def test_cli_success_wrong_or_ambiguous_error_cannot_pass_negative(self):
        results=[SimpleNamespace(returncode=0,stderr=b''),
                 SimpleNamespace(returncode=1,stderr=b'ERROR: unrelated (SQLSTATE PF001)'),
                 SimpleNamespace(returncode=1,stderr=b'ERROR: NATIVE_FORWARD_POST_BODY (SQLSTATE PF001)\nERROR: second')]
        for result in results:
            with tempfile.TemporaryDirectory() as directory:
                runner,program=self.failure_fixture(directory,ledger=False,result=result)
                with patch.object(timestamp,'native_snapshot',return_value=({},[])), self.assertRaisesRegex(
                        ValueError,'FORWARD_FAILURE_CONTROL_REQUIRED'):
                    forward.negative(runner,program,1,ledger=False)
                self.assertEqual(list(Path(directory).iterdir()),[])

    def test_snapshot_or_ledger_mutation_blocks_forward_negative(self):
        with tempfile.TemporaryDirectory() as directory:
            runner,program=self.failure_fixture(directory,ledger=False)
            with patch.object(timestamp,'native_snapshot',side_effect=[({},[]),({'drift':True},[])]), self.assertRaisesRegex(
                    ValueError,'FORWARD_ROLLBACK_REQUIRED'):
                forward.negative(runner,program,1,ledger=False)
        with tempfile.TemporaryDirectory() as directory:
            runner,program=self.failure_fixture(directory,ledger=True)
            runner.unchanged.side_effect=ValueError('changed-ledger')
            with patch.object(timestamp,'native_snapshot',return_value=({},[])), self.assertRaisesRegex(
                    ValueError,'changed-ledger'):
                forward.negative(runner,program,1,ledger=True)
            self.assertEqual(runner.sql.call_args_list[-1].args[0],forward.DROP)
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_missing_snapshot_capability_or_restoration_qualification_is_rejected(self):
        from canonical_native_timestamp_snapshot import CONTROLS
        progress=dict(whiteLabelShimCreated=False,prerequisitesExecuted=4,executionUnits=[],
            nativeSpatialCapability=dict(version='170006',postgis='3.3'),
            snapshotQualification=dict(nonSystemSchemasCovered=True,ledgerVerifiedSeparately=True,
                cases=[dict(case=item[0],changedObjectDetected=True) for item in CONTROLS],parentUnchanged=True))
        for key in ('nativeSpatialCapability','snapshotQualification','prerequisitesExecuted'):
            with self.assertRaisesRegex(ValueError,'FORWARD_TIMESTAMP_QUALIFICATIONS_REQUIRED'):
                forward.require_qualifications(self.plan,{**progress,key:None} if key!='nativeSpatialCapability'
                                               else {**progress,key:{}})
        with self.assertRaisesRegex(ValueError,'FORWARD_TIMESTAMP_QUALIFICATIONS_REQUIRED'):
            forward.require_qualifications(self.plan,progress)


if __name__ == '__main__':
    unittest.main()
