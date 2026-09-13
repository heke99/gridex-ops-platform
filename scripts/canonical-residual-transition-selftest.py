#!/usr/bin/env python3
"""No database acceptance claims: exact source/transform negative controls."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('residual_transitions', ROOT/'scripts/canonical-residual-transitions.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.authority = m.read(ROOT, m.AUTHORITY)

    def test_db1_is_byte_identical(self):
        raw = m.read(ROOT, m.DB1)
        self.assertEqual(m.reconstruct(m.DB1, raw).encode(), raw)

    def test_intake_only_changes_canonical_role_column(self):
        raw = m.read(ROOT, m.INTAKE)
        rendered = m.reconstruct(m.INTAKE, raw).encode()
        self.assertEqual(rendered, raw.replace(b'ro.role_key', b'ro.key'))
        self.assertEqual(raw.count(b'ro.role_key'), 1)
        self.assertEqual(rendered.count(b"('super_admin', 'superadmin', 'platform_admin')"), 1)
        self.assertIn(b"cm.status = 'active'", rendered)
        self.assertIn(b'cm.user_id = auth.uid()', rendered)
        self.assertIn(b'ur.user_id = auth.uid()', rendered)

    def test_alignment_keeps_all_surrounding_bytes(self):
        raw = m.read(ROOT, m.ALIGNMENT)
        text = raw.decode()
        match = m.function(text)
        candidate = m.reconstruct(m.ALIGNMENT, raw, self.authority)
        self.assertIn(text[:match.start()], candidate)
        self.assertIn(text[match.end():], candidate)
        self.assertNotIn(match.group(0), candidate)
        self.assertNotIn('drop function', candidate.lower())
        self.assertNotIn('cascade;', candidate.lower())
        self.assertIn('RESIDUAL_ROLE_IDENTITY_OR_ACL_CHANGED', candidate)
        self.assertIn('to_jsonb(p)', candidate)

    def test_each_original_tamper_is_rejected(self):
        for path in m.ORDER:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'SOURCE_MISMATCH'):
                m.reconstruct(path, m.read(ROOT, path)+b'\n', self.authority)

    def test_canonical_authority_tamper_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_MISMATCH'):
            m.reconstruct(m.ALIGNMENT, m.read(ROOT, m.ALIGNMENT), self.authority+b'\n')

    def test_missing_authority_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_MISMATCH'):
            m.reconstruct(m.ALIGNMENT, m.read(ROOT, m.ALIGNMENT))

    def test_unknown_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_MISMATCH'):
            m.reconstruct('migrations/unreviewed.sql', b'SELECT 1;')

    def test_guard_requires_exact_shape_and_compiler(self):
        guard = m.role_guard(self.authority)
        for required in ("check_function_bodies", "p.proretset", "p.proargmodes", "p.proargnames", "l.lanname='sql'", "p.proconfig", "p.prosecdef", "p.provolatile='s'"):
            self.assertIn(required, guard)


if __name__ == '__main__':
    unittest.main()
