#!/usr/bin/env python3
"""True-only replay acceptance and actual shell-pipeline tests; no database."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / 'scripts/gridex-replay-required-checks.py'


class RequiredChecksTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('required_checks', CHECKER)
        cls.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.m)

    def payload(self):
        return {name: True for name in self.m.REQUIRED_CHECKS}

    def test_exact_true_result_is_accepted(self):
        self.m.validate(json.dumps(self.payload()))
        self.assertEqual(len(self.m.REQUIRED_CHECKS), 18)

    def test_every_false_or_null_is_rejected(self):
        for name in self.m.REQUIRED_CHECKS:
            for value in (False, None):
                with self.subTest(name=name, value=value):
                    payload = self.payload(); payload[name] = value
                    with self.assertRaisesRegex(ValueError, 'REQUIRED_CHECK_FAILED'):
                        self.m.validate(json.dumps(payload))

    def test_boolean_lookalikes_are_rejected(self):
        for value in (1, 0, 'true', 't', '', {}, []):
            payload = self.payload(); payload[self.m.REQUIRED_CHECKS[0]] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.m.validate(json.dumps(payload))

    def test_each_missing_key_is_rejected(self):
        for name in self.m.REQUIRED_CHECKS:
            payload = self.payload(); del payload[name]
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'CHECK_CONTRACT_MISMATCH'):
                self.m.validate(json.dumps(payload))

    def test_extra_and_duplicate_keys_are_rejected(self):
        payload = self.payload(); payload['unexpected_ok'] = True
        with self.assertRaisesRegex(ValueError, 'CHECK_CONTRACT_MISMATCH'):
            self.m.validate(json.dumps(payload))
        original = json.dumps(self.payload())
        duplicate = original[:-1] + ', "companies_ok": true}'
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_CHECK_KEY'):
            self.m.validate(duplicate)

    def test_empty_invalid_scalar_and_multiple_rows_are_rejected(self):
        for raw in ('', 't|t|t', 'null', 'true', '[]', '{}', 'secret-value',
                    json.dumps(self.payload()) + '\n' + json.dumps(self.payload())):
            with self.subTest(raw=raw[:12]), self.assertRaises(ValueError):
                self.m.validate(raw)

    def test_rejection_does_not_disclose_input(self):
        result = subprocess.run([sys.executable, str(CHECKER)], input='private-value',
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('private-value', result.stdout + result.stderr)

    def test_oversized_input_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'CHECK_PAYLOAD_TOO_LARGE'):
            self.m.validate(' ' * (self.m.MAX_BYTES + 1))

    def shell_check(self, raw, sql_status=0):
        shell = (ROOT / 'scripts/gridex-aud-003-clean-replay.sh').read_text()
        found = re.findall(r'^psql "\$DB_URL"[^\n]*gridex-replay-required-checks\.py[^\n]*\n.*?^SQL$',
                           shell, re.M | re.S)
        self.assertEqual(len(found), 1, 'exact required-check pipeline must exist once')
        with tempfile.TemporaryDirectory() as directory:
            bindir = Path(directory)
            # A transport double, not a PostgreSQL simulation. Only the response
            # validator and the real set -e/pipefail shell behavior are tested.
            psql = bindir / 'psql'
            psql.write_text('#!' + sys.executable + '\nimport sys\nsys.stdin.read()\n'
                            + 'sys.stdout.write(' + repr(raw) + ')\nsys.exit(' + str(sql_status) + ')\n')
            psql.chmod(0o700)
            script = ('set -euo pipefail\nROOT=' + shlex.quote(str(ROOT))
                      + '\nDB_URL=fixture-only\n' + found[0] + '\nprintf "NEXT_STAGE\\n"\n')
            env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'])
            return subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)

    def test_actual_shell_continues_only_after_all_true(self):
        result = self.shell_check(json.dumps(self.payload()))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('NEXT_STAGE', result.stdout)

    def test_actual_shell_stops_on_false_null_and_missing_result(self):
        for value in (False, None):
            payload = self.payload(); payload['contract_platform_readiness_internal_executes_ok'] = value
            result = self.shell_check(json.dumps(payload))
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('NEXT_STAGE', result.stdout)
        result = self.shell_check('')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('NEXT_STAGE', result.stdout)

    def test_actual_shell_sql_failure_cannot_be_masked_by_valid_json(self):
        result = self.shell_check(json.dumps(self.payload()), sql_status=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('NEXT_STAGE', result.stdout)

    def test_sql_aliases_and_parser_contract_agree(self):
        text = (ROOT / 'scripts/gridex-aud-003-clean-replay.sh').read_text()
        found = re.search(r'SELECT row_to_json\(required_checks\).*?\) AS required_checks;', text, re.S)
        self.assertIsNotNone(found)
        aliases = re.findall(r'\bas ([a-z_]+_ok)\b', found[0])
        self.assertEqual(aliases, list(self.m.REQUIRED_CHECKS))


if __name__ == '__main__':
    unittest.main(verbosity=2)
