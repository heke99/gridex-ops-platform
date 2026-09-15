#!/usr/bin/env python3
"""Exercise CI identity against real private admission; no container or SQL."""
import importlib.util
from pathlib import Path
import re
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('owned_workflow_controller', ROOT/'scripts/canonical-auth-provisioning-replay.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OwnedWorkflowTests(unittest.TestCase):
    def workflow_identity(self):
        workflow = (ROOT/'.github/workflows/gridex-residual-prefix77-probe.yml').read_text()
        self.assertEqual(workflow.count('  ordinary-owned-continuation:\n'), 1)
        job = workflow.split('  ordinary-owned-continuation:\n', 1)[1]
        values = re.findall(r'^      GRIDEX_LEGACY_CONTAINER_NAME: (.+)$', job, re.M)
        self.assertEqual(len(values), 1)
        return values[0].replace('${{ github.run_id }}', '34778949144').replace('${{ github.run_attempt }}', '1')

    def test_actual_workflow_identity_passes_unchanged_private_preparation_guard(self):
        private = m.load_private()
        # No container or SQL: exercise the real name/method/source admission
        # with only the live-handle prerequisite mocked for this constructor test.
        with patch.dict(m.os.environ, {'GRIDEX_LEGACY_CONTAINER_NAME': self.workflow_identity()}):
            target = m.load_batch().OwnedPostgres(postgis=True)
        with patch.object(private.repair, 'require_owned') as owned:
            with private.AcceptedInputs(target) as inputs:
                self.assertIs(inputs.active, True)
                self.assertIs(private._ACTIVE[target], inputs)
            owned.assert_called_once_with(target, False)
        self.assertIs(inputs.closed, True)
        self.assertNotIn(target, private._ACTIVE)
        self.assertIs(target.private.__func__, private.legacy.OwnedPostgres.private)
        self.assertIs(target.run_files.__func__, private.legacy.OwnedPostgres.run_files)

    def test_unreviewed_workflow_identity_still_rejected_before_source_reads(self):
        private = m.load_private()
        with patch.dict(m.os.environ, {'GRIDEX_LEGACY_CONTAINER_NAME': 'gridex-auth-legacy-ordinary-34778949144-1'}):
            target = m.load_batch().OwnedPostgres(postgis=True)
        with patch.object(private.repair, 'require_owned'), \
             patch.object(private.AcceptedInputs, 'canonical') as reads:
            with self.assertRaisesRegex(private.BoundaryError, '^FRESH_FIXED_PREPARATION_REQUIRED$'):
                private.AcceptedInputs(target).__enter__()
        reads.assert_not_called()
        self.assertNotIn(target, private._ACTIVE)

    def test_valid_workflow_name_does_not_admit_replaced_private_methods(self):
        private = m.load_private()
        with patch.dict(m.os.environ, {'GRIDEX_LEGACY_CONTAINER_NAME': self.workflow_identity()}):
            target = m.load_batch().OwnedPostgres(postgis=True)
        target.private = Mock()
        with patch.object(private.repair, 'require_owned'), \
             patch.object(private.AcceptedInputs, 'canonical') as reads:
            with self.assertRaisesRegex(private.BoundaryError, '^TRUSTED_ACCEPTED_METHODS_REQUIRED$'):
                private.AcceptedInputs(target).__enter__()
        reads.assert_not_called()
        target.private.assert_not_called()
        self.assertNotIn(target, private._ACTIVE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
