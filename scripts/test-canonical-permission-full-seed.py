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

    def test_full_access_rosters_match_complete_tenant_policy(self):
        f,bodies=seed.adapted_fixture(self.retained,self.doc)
        cases=seed.build_cases(self.retained,self.doc)
        for table,labels in [('company_memberships',range(5,9)),('user_roles',range(9,13))]:
            for number in labels:
                label=f'F{number:02d}'
                for actor,company,foreign in [(f.UA,f.A,f.B),(f.UB,f.B,f.A)]:
                    roster=f"array_agg(user_id order by user_id)=array[{f.lit(actor)}::uuid,{f.lit(f.UAB)}::uuid] from public.{table} where company_id={f.lit(company)}"
                    self.assertIn(f.check(roster,'full_access_select_roster'),cases[label])
                    self.assertIn(f.check(f'count(*)=0 from public.{table} where company_id={f.lit(foreign)}','access_select_foreign'),cases[label])
                    self.assertNotIn(f.check(f'count(*)=1 from public.{table} where company_id={f.lit(company)}','access_select_own'),cases[label])
                self.assertIn(f.check(f'count(*)=0 from public.{table} where company_id is null','full_access_no_global_row'),cases[label])
                # Original writes, privileges and complete rollback assertions remain intact.
                for line in bodies[label].splitlines():
                    if 'access_select_own' not in line:
                        self.assertIn(line,cases[label])

    def test_full_access_adapter_is_exact_and_rejects_source_shape_drift(self):
        f,bodies=seed.adapted_fixture(self.retained,self.doc)
        for label,body in bodies.items():
            adapted=seed.full_access_body(f,label,body)
            if label not in {f'F{i:02d}' for i in range(5,13)}:
                self.assertEqual(body,adapted)
        original=bodies['F05']
        for damaged in (original.replace('count(*)=1','count(*)=2'),original+original,original.replace('access_select_own','unknown')):
            with self.assertRaisesRegex(ValueError,'PERMISSION_FULL_ACCESS_SOURCE_REQUIRED'):
                seed.full_access_body(f,'F05',damaged)

    def test_full_access_policy_source_is_retained(self):
        path='supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql'
        self.assertIn(path,seed.PINS)
        self.assertEqual(seed.PINS[path],seed.sha((seed.ROOT/path).read_bytes()))

if __name__=='__main__':unittest.main()
