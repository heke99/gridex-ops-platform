"""Offline admission and evidence tests; PostgreSQL behavior requires owned replay."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import canonical_policy_actor_qualification as q


class QualificationTests(unittest.TestCase):
    def test_retained_source_rejects_changes_missing_and_symlink(self):
        raw = q.retain(Path(__file__).resolve().parents[1])
        self.assertEqual(q.validate(raw), raw)
        for bad in (None, raw + b'\n', raw[:-1], 'sql'):
            with self.assertRaisesRegex(ValueError, 'POLICY_ACTOR_SOURCE_REQUIRED'):
                q.validate(bad)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                q.retain(root)
            path = root / q.SOURCE
            path.parent.mkdir(parents=True)
            path.symlink_to(Path(__file__).resolve().parents[1] / q.SOURCE)
            with self.assertRaises(ValueError):
                q.retain(root)

    def test_closed_52_policy_inventory_and_source_decisions(self):
        self.assertEqual(len(q.POLICIES), 52)
        self.assertEqual(len({p[:3] for p in q.POLICIES}), 52)
        self.assertEqual(len(q.SERVICE_POLICIES), 76)
        self.assertEqual(len({p[:2] for p in q.SERVICE_POLICIES}), 76)
        self.assertEqual({p[0] for p in q.SERVICE_POLICIES} - {p[0] for p in q.POLICIES},
                         {'billing_import_batches','billing_import_rows'})
        self.assertEqual({mode: sum(p[3] == mode for p in q.POLICIES)
                          for mode in ('tenant', 'service', 'platform', 'acl_denied')},
                         dict(tenant=30, service=15, platform=3, acl_denied=4))
        for table, command, name, mode, digest in q.POLICIES:
            action = {'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE'}[command]
            expected = hashlib.md5(f'public.{table}:{action}:authenticated'.encode()).hexdigest()[:20]
            self.assertEqual(name, 'gridex_mp_' + expected)
            self.assertEqual(len(digest), 64)

    def test_unowned_target_never_executes(self):
        class External:
            def sql(self, *args, **kwargs):
                self.fail('external SQL must not execute')
        with self.assertRaisesRegex(ValueError, 'POLICY_ACTOR_OWNED_TARGET_REQUIRED'):
            q.execute(External(), q.retain(Path(__file__).resolve().parents[1]), {})

    def test_receipt_rejects_missing_extra_and_false_cases(self):
        valid = q.expected_result()
        self.assertEqual(q.validate_result(valid), valid)
        self.assertEqual(q.validate_result(q.expected_result('evaluated'))['serviceChangedPoliciesInert'], 0)
        for bad in ({}, {**valid, 'businessGraphAccepted': True},
                    {**valid, 'caseCount': valid['caseCount'] - 1},
                    {**valid, 'unexpected': True}, {**valid, 'verified': False},
                    {**valid, 'verified': 1}, {**valid, 'servicePolicyMode': 'assumed'}):
            with self.assertRaisesRegex(ValueError, 'POLICY_ACTOR_RESULT_REQUIRED'):
                q.validate_result(bad)

    def test_complete_prefix_requires_each_exact_forward_receipt(self):
        from canonical_forward_sources import FORWARD_SOURCES
        self.assertEqual(len(FORWARD_SOURCES), 9)
        good = dict(foundationApplied=144, timestampApplied=514, forwardSources=dict(
            executed=True, inputsExecuted=9, sources=[dict(source=p, sourceSha256=h,
                executed=True, positiveAndRepeatVerified=True, rowsPreserved=True)
                for p,h in FORWARD_SOURCES]))
        q._complete(good, False)
        bads = [{}, {**good, 'timestampApplied': 513}]
        for field in ('sourceSha256', 'rowsPreserved', 'positiveAndRepeatVerified'):
            bad = copy.deepcopy(good)
            bad['forwardSources']['sources'][-1][field] = False
            bads.append(bad)
        bad = copy.deepcopy(good)
        bad['forwardSources']['sources'].reverse()
        bads.append(bad)
        for bad in bads:
            with self.assertRaisesRegex(ValueError, 'POLICY_ACTOR_COMPLETE_REPLAY_REQUIRED'):
                q._complete(bad, False)

    def test_execution_receipt_binds_source_context_and_target(self):
        valid=dict(q.expected_result(),source=q.SOURCE,sourceSha256=q.SOURCE_SHA256,
            completePolicyContextSha256='a'*64,catalogAndRowsPreserved=True,nativeTarget=False,ledgerProvenanceAccepted=False)
        self.assertEqual(q.validate_execution_receipt(valid,native=False),valid)
        for key,value in [('sourceSha256','bad'),('completePolicyContextSha256',''),('catalogAndRowsPreserved',1),
                          ('nativeTarget',True),('ledgerProvenanceAccepted',True),('unexpected',True),('verified',False)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                q.validate_execution_receipt(dict(valid,**{key:value}),native=False)

    def test_state_change_cannot_be_reported_as_rollback(self):
        import json
        class Target:
            def sql(self, *args, **kwargs):
                return json.dumps(q.expected_result())
        with patch.object(q, '_admit', return_value=('owned', False)), \
             patch.object(q, '_complete'), patch.object(q, '_policy_context', return_value='context'), \
             patch.object(q, '_snapshot', side_effect=[('before',), ('changed',)]):
            with self.assertRaisesRegex(ValueError, 'POLICY_ACTOR_ROLLBACK_REQUIRED'):
                q.execute(Target(), q.retain(Path(__file__).resolve().parents[1]), {})


if __name__ == '__main__':
    unittest.main()
