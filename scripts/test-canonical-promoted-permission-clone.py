"""Transport fixtures for full registered-frontier checks; not real SQL proof."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('promoted_permission_clone',Path(__file__).with_name('canonical-full-permission-clone-qualification.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PromotedCloneTests(unittest.TestCase):
    def progress(self,count=12):
        rows=[dict(source=path,sourceSha256=digest,executed=True,positiveAndRepeatVerified=True,rowsPreserved=True)
              for path,digest in m.forward_sources.FORWARD_SOURCES[:count]]
        return dict(foundationApplied=144,timestampApplied=514,
                    forwardSources=dict(executed=True,inputsExecuted=count,sources=rows))

    def test_ten_forward_prefix_cannot_be_mistaken_for_promoted_frontier(self):
        target=Mock()
        for count in (0,10,11):
            with self.assertRaisesRegex(ValueError,'COMPLETE_REPLAY'):
                m.qualify_promoted(target,object(),self.progress(count))
            target.reset.assert_not_called()
        self.assertEqual(len(m.forward_sources.FORWARD_SOURCES),12)

    def exercise(self,defect=None):
        first={'catalog':{key:dict(roles=['123']) for key in m.storage_policy_scope.KEYS},'rows':{},'ledger':[]}
        state={'snapshot':copy.deepcopy(first)}
        def capture(target,legacy,database):
            return copy.deepcopy(first if database==m.PARENT else state['snapshot'])
        calls=[]
        def private(target,legacy,database,sql,stage,transaction=True):
            calls.append(stage)
            if stage=='matrix_identities':return '{}'
            if stage=='promoted_postconditions':return 'false' if defect=='postcondition' else 'true'
            if stage=='candidate_repeat' and defect=='repeat':state['snapshot']['rows']['drift']=1
            if stage=='local_storage_scope_poison':
                state['snapshot']['catalog'][m.storage_policy_scope.KEYS[0]]['roles']=['0']
                if defect=='scope_poison':state['snapshot']['rows']['drift']=1
            if stage=='local_acl_poison':state['snapshot']['catalog']['acl_drift']=1
            if stage=='candidate_acl_recovery' and defect!='recovery':state['snapshot']=copy.deepcopy(first)
            if stage=='matrix_case':return 'PERMISSION_CASE_COMPLETE\n'
            return ''
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(m,'capture',side_effect=capture))
            stack.enter_context(patch.object(m,'private_sql',side_effect=private))
            verify=stack.enter_context(patch.object(m,'verify_functions'))
            acl=stack.enter_context(patch.object(m,'acl_check'))
            behavior=stack.enter_context(patch.object(m,'behavior'))
            stack.enter_context(patch.object(m.full_seed,'build_cases',return_value={'S21':'original unchanged S21'}))
            negative=stack.enter_context(patch.object(m.storage_policy_scope,'sql',return_value='table:user_roles'))
            matrix=stack.enter_context(patch.object(m,'matrix',return_value=128 if defect=='matrix' else 129))
            target=SimpleNamespace(name='owned-clone-fixture',reset=Mock(),docker=Mock())
            result=m.qualify_promoted(target,object(),self.progress())
            self.assertEqual([c.args[-1] for c in behavior.call_args_list],[[],[]])
            self.assertEqual(verify.call_count,1)
            self.assertEqual(acl.call_count,2)
            self.assertEqual(negative.call_args.args[-2:],('scope_negative_s21','42501'))
            self.assertEqual(matrix.call_count,1)
        return result,calls

    def test_registered_sources_repeat_exact_functions_all_cases_and_negative_recovery(self):
        result,calls=self.exercise()
        self.assertTrue(result['promoted'])
        self.assertTrue(result['matrix129Verified'])
        self.assertEqual(result['matrixCases'],129)
        self.assertEqual(result['exactFunctions'],8)
        self.assertTrue(result['storagePolicyNegativeAndRecoveryVerified'])
        self.assertEqual(calls.count('candidate_repeat'),2)
        self.assertEqual(calls.count('candidate_acl_recovery'),2)
        self.assertNotIn('schemaAccepted',result)

    def test_postconditions_repeat_scope_recovery_and_matrix_failure_cannot_pass(self):
        for defect in ('postcondition','repeat','scope_poison','recovery','matrix'):
            with self.subTest(defect=defect),self.assertRaises(ValueError):self.exercise(defect)

    def test_run_routes_to_full_registered_frontier_not_old_candidate_baseline(self):
        import inspect
        source=inspect.getsource(m.run)
        self.assertIn("progress['permissionQualification'] = qualify_promoted(target, legacy, progress)",source)
        self.assertNotIn("progress['permissionQualification'] = qualify(target, legacy, progress)",source)

if __name__=='__main__':unittest.main()
