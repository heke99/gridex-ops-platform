"""Offline source/admission/oracle tests; real PG17 qualification is separate."""
import copy
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/canonical-auth-email-action-domain-selftest.py'

def load():
    spec=importlib.util.spec_from_file_location('action_domain_fixture',SCRIPT)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

class ActionDomainTests(unittest.TestCase):
    def test_source_selection_without_sql_tools(self):
        result=subprocess.run([sys.executable,'-B',str(SCRIPT),'--selection-only'],cwd=ROOT,
          env={'PATH':''},capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('SELECTION_ONLY_NOT_SQL',result.stdout)
        self.assertNotIn('cleanupVerified',result.stdout)
        module=load()
        self.assertEqual(len(module.OLD),7);self.assertEqual(len(module.NEW),11)
        self.assertEqual(set(module.NEW)-set(module.OLD),set(module.ADDED))
        self.assertEqual(module.fixture.sha(module.check_row(module.OLD)),module.OBSERVED_CHECK_SHA)

    def test_external_target_rejected_without_echo(self):
        result=subprocess.run([sys.executable,'-B',str(SCRIPT),'--database-url=private_canary'],
          cwd=ROOT,env={'PATH':''},capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('private_canary',result.stdout+result.stderr)

    def test_candidate_mutation_and_symlink_rejected(self):
        module=load()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'candidate.sql';path.write_bytes(b'select private_canary;')
            with self.assertRaises(ValueError):module.read_candidate(path)
            path.write_bytes(module.CANDIDATE.read_bytes())
            link=Path(directory)/'link.sql';link.symlink_to(path)
            with self.assertRaises(ValueError):module.read_candidate(link)

    def test_exact_constraint_delta_rejects_unrelated_change_and_wrong_domain(self):
        module=load()
        def state(values,oid):
            return dict(actionCheck=dict(oid=oid,relationOid=40,row=module.check_row(values)),
              catalog=dict(constraints=[dict(oid=oid,conrelid=40,conbin=str(values),conkey=[4],
                convalidated=True,conislocal=True),dict(oid=99,conrelid=50,conbin='outside')],
                roles=['unchanged'],policies=['deny'],columns=['not_null'],triggers=[]),
              acl=['service','client'],rows={'target':[dict(id=1,action='invite_sent')]})
        before=state(module.OLD,1);after=state(module.NEW,2)
        module.verify_delta(before,after)
        self.assertIn('oid',before['catalog']['constraints'][0])
        for change in (
          lambda x:x['actionCheck'].__setitem__('row',module.check_row(module.NEW[:-1])),
          lambda x:x['actionCheck'].__setitem__('relationOid',41),
          lambda x:x['catalog']['constraints'][0].__setitem__('conkey',[5]),
          lambda x:x['catalog']['constraints'][0].__setitem__('convalidated',False),
          lambda x:x['catalog']['constraints'][1].__setitem__('conbin','altered'),
          lambda x:x['catalog'].__setitem__('policies',['allow']),
          lambda x:x['catalog'].__setitem__('columns',[]),
          lambda x:x['catalog'].__setitem__('triggers',['new']),
          lambda x:x['acl'].pop(),
          lambda x:x['rows']['target'][0].__setitem__('action','changed'),
        ):
            damaged=copy.deepcopy(after);change(damaged)
            with self.assertRaises(ValueError):module.verify_delta(before,damaged)
        with self.assertRaises(ValueError):module.verify_delta(before,before)

if __name__=='__main__':unittest.main()
