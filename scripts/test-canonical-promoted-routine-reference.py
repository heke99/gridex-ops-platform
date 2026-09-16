"""Regression: a qualified forward supersedes one RPC, not the policy reference.

No SQL execution claim: native/portable live metadata and actor gates still run.
"""
import copy
from dataclasses import replace
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import canonical_removed_policy_qualification as q
import canonical_permission_forward_contract as forward
import test_canonical_removed_policy_qualification as fixtures

SIGNATURE = 'canonical_manage_platform_user_access(jsonb)'
MIGRATION = 'supabase/migrations/20260916095319_canonical_permission_overrides_and_storage_write_guards.sql'
BEFORE_SHA = '00ec6fa609f9187565f6149d78659271753e89af7d528071f00a6b975e8e4708'
AFTER_SHA = '3067d995d0a92c0b1bbfaf5029e8508b8db57d79b2de90ac205e90d9fc46ca07'


def source_bodies(retained):
    reference = next(raw for name, _, raw in retained.evidence if name == 'supabase/schema.sql')
    old = re.search(
        rb'^CREATE FUNCTION public\.canonical_manage_platform_user_access\([^\n]*\) RETURNS [^\n]+\n'
        rb'.*?\s+AS (\$[a-zA-Z0-9_]*\$)(.*?)\1;', reference, re.M | re.S)[2].decode()
    source = (ROOT / MIGRATION).read_bytes()
    if q.sha(source) != forward.PERMISSION_SHA:
        raise AssertionError('test requires the already qualified migration')
    new = re.search(
        rb'create or replace function public\.canonical_manage_platform_user_access\(p_command jsonb\)'
        rb'.*?as \$function\$(.*?)\$function\$;', source, re.S)[1].decode()
    if q.sha(old.encode()) != BEFORE_SHA or q.sha(new.encode()) != AFTER_SHA:
        raise AssertionError('test body pins changed')
    return old, new


class PromotedRoutineReferenceTests(unittest.TestCase):
    def setUp(self):
        self.retained = q.retain(ROOT)
        self.old, self.new = source_bodies(self.retained)
        self.metadata = fixtures.metadata_fixture(q, self.retained)
        self.row = next(row for row in self.metadata['routines'] if row['signature'] == SIGNATURE)
        # Independent source extraction, not an expectation copied from the validator.
        self.row['prosrc'] = self.new
        # The existing fixture isolates routine/authority checks; policy hashes
        # have their own tests and are measured unmocked by both SQL CI paths.
        guard = patch.object(q, 'require_policy_hashes')
        guard.start()
        self.addCleanup(guard.stop)

    def test_exact_promoted_rpc_is_accepted_without_policy_or_acl_change(self):
        result = q.validate_metadata(self.metadata, self.retained)
        self.assertEqual(result['policyCount'], 267)
        self.assertEqual(result['helperBodiesVerified'], 6)
        self.assertEqual(result['canonicalRpcMetadataVerified'], 6)
        self.assertIs(result['canonicalRpcBusinessBehaviorVerified'], False)
        self.assertEqual(q.expected_routines(self.retained)[SIGNATURE]['prosrc'], self.new)

    def test_old_rpc_body_is_not_a_second_allowed_baseline(self):
        self.row['prosrc'] = self.old
        with self.assertRaisesRegex(ValueError, 'REMOVED_POLICY_RETAINED_HELPER_BODY_REQUIRED'):
            q.validate_metadata(self.metadata, self.retained)

    def test_promoted_rpc_metadata_and_body_stay_exact(self):
        mutations = {'prosrc': self.new + '\n-- drift', 'prosecdef': False,
                     'provolatile': 's', 'prokind': 'p', 'proconfig': ['search_path=public'],
                     'lanname': 'sql', 'owner': 'authenticated', 'acl': []}
        for key, value in mutations.items():
            bad = copy.deepcopy(self.metadata)
            next(row for row in bad['routines'] if row['signature'] == SIGNATURE)[key] = value
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, 'REMOVED_POLICY_RETAINED_HELPER_BODY_REQUIRED'):
                q.validate_metadata(bad, self.retained)

    def test_promoted_rpc_client_or_public_execute_still_rejected(self):
        for role in ('anon', 'authenticated', 'PUBLIC'):
            bad = copy.deepcopy(self.metadata)
            row = next(row for row in bad['routines'] if row['signature'] == SIGNATURE)
            row['acl'].append(dict(grantee=role, grantor='postgres', privilege='EXECUTE', grantable=False))
            row['executable_by'].append(role)
            with self.subTest(role=role), self.assertRaises(ValueError):
                q.validate_metadata(bad, self.retained)

    def test_other_eleven_routine_bodies_are_not_relaxed(self):
        for index, row in enumerate(self.metadata['routines']):
            if row['signature'] == SIGNATURE:
                continue
            bad = copy.deepcopy(self.metadata)
            bad['routines'][index]['prosrc'] += '\n-- drift'
            with self.subTest(signature=row['signature']), self.assertRaisesRegex(ValueError, 'REMOVED_POLICY_RETAINED_HELPER_BODY_REQUIRED'):
                q.validate_metadata(bad, self.retained)

    def test_promoted_source_is_retained_and_cannot_be_missing_or_changed(self):
        evidence = self.retained.evidence
        self.assertEqual(sum(name == MIGRATION for name, _, _ in evidence), 1)
        variants = (
            tuple(item for item in evidence if item[0] != MIGRATION),
            tuple((name, digest, raw + b'\n') if name == MIGRATION else (name, digest, raw)
                  for name, digest, raw in evidence),
        )
        for changed in variants:
            with self.subTest(), self.assertRaises(ValueError):
                q.validate_retained(replace(self.retained, evidence=changed))

    def test_retained_sources_are_sufficient_after_originals_are_staged_away(self):
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('unexpected source reread')):
            result = q.validate_metadata(self.metadata, self.retained)
            self.assertEqual(result['canonicalRpcMetadataVerified'], 6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
