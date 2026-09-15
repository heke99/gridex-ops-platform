import copy
import unittest
import canonical_permission_full_seed as seed

class FullSeedTests(unittest.TestCase):
    def setUp(self):
        self.retained=seed.retain()
        self.doc={'roles':[{'id':'99999999-0000-0000-0000-000000000001','key':'super_admin','scope':'platform','active':True}], 'permissions':[{'id':'99999999-0000-0000-0000-000000000002','key':'masterdata.read'}]}
    def test_exact_original_decisions_and_transaction_boundary(self):
        f,bodies=seed.adapted_fixture(self.retained,self.doc)
        cases=seed.build_cases(self.retained,self.doc)
        self.assertEqual(129,len(cases));self.assertEqual(set(bodies),set(cases))
        for label,sql in cases.items():
            self.assertTrue(sql.startswith('BEGIN;'))
            self.assertTrue(sql.endswith("RESET ROLE; ROLLBACK; SELECT 'PERMISSION_CASE_COMPLETE';\n"))
            self.assertIn("delete from public.role_permissions where role_id='99999999-0000-0000-0000-000000000001'",sql)
            self.assertNotIn('exact_storage_policy_count',sql)
            self.assertNotIn('scope_trigger_count',sql)
        joined='\n'.join(cases.values())
        self.assertTrue('count(*)=(select commands from fixture.baseline_counts)+1' in joined)
        self.assertTrue('count(*)=(select audits from fixture.baseline_counts)+1' in joined)
    def test_seed_only_fixture_grants_and_no_destructive_schema_adaptation(self):
        sql=seed.seed(self.retained,self.doc)
        grants=[line for line in sql.splitlines() if line.lower().startswith('grant ')]
        self.assertTrue(grants)
        self.assertTrue(all('fixture' in line for line in grants))
        for forbidden in ['drop trigger','disable trigger','alter table','delete from public.canonical_platform_access','grant select on public','grant select, insert']:
            self.assertNotIn(forbidden,sql.lower())
        self.assertIn('on conflict(id) do update',sql)
        self.assertIn('fixture.baseline_counts',sql)
    def test_unknown_or_duplicate_identity_rejected(self):
        for mutation in ['empty','duplicate','inactive','unknown']:
            doc=copy.deepcopy(self.doc)
            if mutation=='empty':doc['roles']=[]
            if mutation=='duplicate':doc['permissions']*=2
            if mutation=='inactive':doc['roles'][0]['active']=False
            if mutation=='unknown':doc['permissions'][0]['key']='arbitrary'
            with self.assertRaises(ValueError):seed.resolve_identities(self.retained,doc)
    def test_changed_source_bytes_rejected(self):
        altered=list(self.retained);p,b=altered[0];altered[0]=(p,b+b'\n')
        with self.assertRaises(ValueError):seed.build_cases(tuple(altered),self.doc)
    def test_canonical_ids_reused_and_missing_permissions_seeded(self):
        ids=seed.resolve_identities(self.retained,self.doc)
        self.assertEqual(self.doc['roles'][0]['id'],ids['platformRole'])
        self.assertEqual(self.doc['permissions'][0]['id'],ids['permissions']['masterdata.read'])
        self.assertEqual(6,len(ids['permissions']))

if __name__=='__main__':unittest.main()
