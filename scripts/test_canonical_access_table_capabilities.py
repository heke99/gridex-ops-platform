"""Offline admission and preservation tests; SQL behavior is qualified in PG17 CI."""
import copy
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/canonical-access-table-capabilities-selftest.py'
def load():
    if not SCRIPT.is_file():raise AssertionError('access capability fixture missing')
    spec=importlib.util.spec_from_file_location('access_capability_fixture',SCRIPT)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
class AccessCapabilitiesTests(unittest.TestCase):
    def test_selection_without_database_tools(self):
        self.assertTrue(SCRIPT.is_file(),'access capability fixture missing')
        result=subprocess.run([sys.executable,'-B',str(SCRIPT),'--selection-only'],cwd=ROOT,env={'PATH':''},capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('SELECTION_ONLY_NOT_SQL',result.stdout)
    def test_exact_two_table_four_privilege_delta_and_repeat(self):
        m=load();before=dict(acl=[],catalog={'columnAcl':['SELECT(marker)']},rows={'retained':[1]})
        for schema,table,role in [('public','company_invitations','authenticated'),('public','user_roles','authenticated'),
                ('public','outside_targets','authenticated'),('control','user_roles','authenticated'),('public','user_roles','service_role')]:
            before['acl'] += [[schema,table,'postgres',role,p,False] for p in ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']]
        after=copy.deepcopy(before)
        after['acl']=[x for x in after['acl'] if not(x[0]=='public' and x[1] in ('company_invitations','user_roles') and x[3]=='authenticated' and x[4] in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))]
        m.verify_delta(before,after);m.verify_delta(after,after)
        for i in range(len(after['acl'])):
            bad=copy.deepcopy(after);del bad['acl'][i]
            with self.assertRaisesRegex(ValueError,'EXACT_ACCESS_CAPABILITY_DELTA_REQUIRED'):m.verify_delta(before,bad)
        for key in ('rows','catalog'):
            bad=copy.deepcopy(after);bad[key]={}
            with self.assertRaises(ValueError):m.verify_delta(before,bad)
    def test_changed_bytes_symlink_and_untrusted_target_refused(self):
        m=load()
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'candidate.sql';p.write_bytes(b'select 1;')
            with self.assertRaises(ValueError):m.read_candidate(p)
            p.write_bytes(m.CANDIDATE.read_bytes());link=p.with_name('link.sql');link.symlink_to(p)
            with self.assertRaises(ValueError):m.read_candidate(link)
        with mock.patch.object(sys,'argv',[str(SCRIPT),'--database-url=untrusted']),mock.patch.object(m.fixture,'sql') as sql:
            with self.assertRaisesRegex(ValueError,'NO_EXTERNAL_TARGET_OR_ACCEPTANCE_OPTIONS'):m.run()
            sql.assert_not_called()
    def test_existing_membership_refused_before_owned_database(self):
        m=load()
        def reply(sql,**kwargs):
            if 'pg_auth_members' in sql:return 'f'
            if 'count(*) from pg_database' in sql:return '0'
            return 't'
        with mock.patch.object(m.fixture,'sql',side_effect=reply),mock.patch.object(m.fixture,'owned_database') as owned,mock.patch.object(sys,'argv',[str(SCRIPT)]):
            with self.assertRaisesRegex(ValueError,'PREEXISTING_FIXTURE_ROLE_MEMBERSHIP_REFUSED'):m.run()
            owned.assert_not_called()
if __name__=='__main__':unittest.main()
