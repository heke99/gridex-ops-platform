import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).with_name('elklart-reset-probe.py')
spec = importlib.util.spec_from_file_location('reset_probe', SOURCE)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class ResetProbeSafety(unittest.TestCase):
    def test_optimized_python_keeps_operational_guards(self):
        code = "import runpy; m=runpy.run_path(" + repr(str(SOURCE)) + "); m['require'](False)"
        result = subprocess.run([sys.executable, '-O', '-c', code], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'ValueError', result.stderr)

    def test_foreign_status_is_rejected_before_any_delete(self):
        file = Mock()
        file.read_text.side_effect = [json.dumps({'ops':{}}),json.dumps({'API_URL':'https://foreign.invalid'})]
        with patch.object(sys,'argv',['probe','mutate']), patch.object(probe,'private',return_value=file), patch.object(probe,'call') as call:
            with self.assertRaises(ValueError):
                probe.main()
            call.assert_not_called()

    def test_probe_cannot_delete_another_identity(self):
        file = Mock()
        file.read_text.side_effect = [json.dumps({'ops':{'email':'customer@elklart.example.invalid','userId':'a'*36}}),json.dumps({'API_URL':'http://localhost:54321'})]
        with patch.object(sys,'argv',['probe','mutate']), patch.object(probe,'private',return_value=file), patch.object(probe,'call') as call:
            with self.assertRaises(ValueError):
                probe.main()
            call.assert_not_called()
