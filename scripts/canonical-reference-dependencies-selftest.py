#!/usr/bin/env python3
"""Source admission and reference-only routing controls; no database writes."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('reference_dependencies',ROOT/'scripts/canonical-reference-dependencies.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)


class DependencyTests(unittest.TestCase):
    def test_exact_private_program_preserves_aggregate_and_acl_semantics(self):
        block=m.source_block()
        self.assertEqual(m.hashlib.sha256(block.encode()).hexdigest(),m.BLOCK_SHA)
        self.assertIn('from public.actor_registry_conflicts c',block)
        self.assertIn("where c.status = 'open'",block)
        self.assertIn("c.severity = 'blocking'",block)
        self.assertIn('security definer',block)
        self.assertIn('revoke all on schema gridex_internal from public, anon;',block)
        self.assertNotIn('create or replace view public.',block)
        self.assertNotIn('do $migration$',block)

    def fixture(self, root):
        (root/'supabase/migrations').mkdir(parents=True);(root/'scripts').mkdir()
        (root/'supabase/migrations'/m.SOURCE).write_bytes((ROOT/'supabase/migrations'/m.SOURCE).read_bytes())
        (root/'scripts/migration-history-manifest.additions.json').write_text(json.dumps({'files':{m.SOURCE:m.SOURCE_SHA}}))

    def test_mutated_source_and_manifest_are_rejected(self):
        for bad in ('source','manifest','symlink','missing'):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.fixture(root);path=root/'supabase/migrations'/m.SOURCE
                if bad=='source':path.write_bytes(path.read_bytes()+b'\n')
                if bad=='manifest':(root/'scripts/migration-history-manifest.additions.json').write_text('{"files":{}}')
                if bad in ('symlink','missing'):path.unlink()
                if bad=='symlink':path.symlink_to(ROOT/'supabase/migrations'/m.SOURCE)
                with patch.object(m,'ROOT',root),self.assertRaises(ValueError):m.source_block()

    def test_only_the_exact_owned_reference_database_is_addressed(self):
        target=Mock();m.prepare(target)
        args=target.sql.call_args
        self.assertEqual(args.args[0],'gridex_auth_legacy_native')
        self.assertEqual(args.args[1],'SET LOCAL check_function_bodies = off;\n'+m.source_block())
        self.assertIs(args.kwargs['transaction'],True)
        m.verify(target)
        self.assertEqual(target.sql.call_args.args[0],'gridex_auth_legacy_native')
        self.assertIn("has_function_privilege('anon'",target.sql.call_args.args[1])

    def test_failed_dependency_cannot_claim_verification(self):
        target=Mock();target.sql.side_effect=RuntimeError('blocked')
        with self.assertRaises(RuntimeError):m.verify(target)


if __name__=='__main__':unittest.main(verbosity=2)
