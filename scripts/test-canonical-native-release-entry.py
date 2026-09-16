"""Ordinary entry preserves failures and reaches acceptance only via its verifier."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
import canonical_native_release_verify as release

spec=importlib.util.spec_from_file_location('release_entry_test',Path(__file__).with_name('canonical-auth-provisioning-replay.py'))
entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)

class Tests(unittest.TestCase):
    def invoke(self,root,status=0,verification=None):
        native=SimpleNamespace(run_guarded=Mock(return_value=status))
        loader=SimpleNamespace(exec_module=lambda module: None)
        with patch.object(entry,'ROOT',root),patch.object(entry.sys,'argv',['replay']), \
             patch.object(entry.importlib.util,'spec_from_file_location',return_value=SimpleNamespace(loader=loader)), \
             patch.object(entry.importlib.util,'module_from_spec',return_value=native), \
             patch.object(release,'verify',verification):
            entry.main()
        return native

    def test_native_failure_never_reaches_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);verification=Mock()
            with self.assertRaisesRegex(RuntimeError,'NATIVE_HISTORICAL_PREFIX_FAILED'):
                self.invoke(root,status=1,verification=verification)
            verification.assert_not_called()
            self.assertFalse((root/'artifacts/native-release-verification.json').exists())

    def test_unsupported_schema_or_types_never_emit_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);verification=Mock(side_effect=ValueError('NATIVE_RELEASE_SOURCE_DECISIONS_REQUIRED'))
            with self.assertRaisesRegex(RuntimeError,'NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED'):
                self.invoke(root,verification=verification)
            self.assertFalse((root/'artifacts/native-release-verification.json').exists())

    def test_fresh_invocation_is_passed_to_verifier_before_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'artifacts').mkdir();start=time.time_ns()
            def verify(actual_root,*,started_ns):
                self.assertEqual(actual_root,root)
                self.assertLessEqual(start,started_ns);self.assertLessEqual(started_ns,time.time_ns())
                self.assertFalse((root/'artifacts/native-release-verification.json').exists())
                return {'schemaAccepted':True}
            native=self.invoke(root,verification=Mock(side_effect=verify))
            native.run_guarded.assert_called_once_with(historical_prefix=True)
            self.assertIn('"schemaAccepted": true',(root/'artifacts/native-release-verification.json').read_text())

if __name__=='__main__':unittest.main()
