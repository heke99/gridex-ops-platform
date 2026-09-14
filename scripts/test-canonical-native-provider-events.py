"""Finite native provider-event admission, not full replay qualification."""
import copy
import importlib
from pathlib import Path
import unittest

class ProviderEventTests(unittest.TestCase):
    def setUp(self):
        self.m=importlib.import_module('canonical_native_provider_events')

    def test_only_exact_complete_reviewed_inventory_is_admitted(self):
        self.m.validate(self.m.expected())
        for key,value in (('owner','postgres'),('functionOwner','postgres'),('enabled','D'),
                          ('functionContractSha256','0'*64),('tags',['CREATE TABLE']),
                          ('event','ddl_command_start'),('function','public.foreign()'),('name','foreign')):
            inventory=self.m.expected();inventory[0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): self.m.validate(inventory)
        for inventory in ([],self.m.expected()[:-1],self.m.expected()*2,self.m.expected()[::-1],None):
            with self.assertRaises(ValueError):self.m.validate(inventory)

    def test_bootstrap_binds_pristine_image_and_rechecks_every_event(self):
        seen=[]
        def sql(query):seen.append(query);return self.m.expected()
        receipt=self.m.bootstrap(sql,self.m.IMAGE_ID,{'extensions':[{'name':'pg_graphql','version':'1.5.11'}]})
        self.assertEqual(seen,[self.m.QUERY]);self.assertTrue(receipt['pristineBootstrapVerified'])
        self.m.require(sql,receipt)
        self.assertEqual(seen,[self.m.QUERY]*2)
        for bad in (None,{},dict(receipt,imageId='foreign'),dict(receipt,pristineBootstrapVerified=1)):
            with self.assertRaises(ValueError):self.m.require(sql,bad)
        with self.assertRaises(ValueError):self.m.bootstrap(sql,'foreign',{'extensions':[]})
        with self.assertRaises(ValueError):self.m.require(lambda q:[],receipt)

    def test_guard_is_exact_invoker_comparison_not_name_or_owner_exemption(self):
        sql=self.m.setup_sql()
        self.assertIn('SECURITY INVOKER SET search_path=pg_catalog',sql)
        self.assertIn('pg_get_functiondef',sql)
        self.assertIn('functionContractSha256',sql)
        self.assertIn('IS DISTINCT FROM',self.m.predicate())
        self.assertNotIn('SET ROLE',sql)
        self.assertNotIn('ALTER EVENT TRIGGER',sql)
        self.assertNotIn('SECURITY DEFINER',sql)
        self.assertNotIn('GRANT ',sql)
        self.assertIn('REVOKE ALL ON FUNCTION pg_temp.gridex_native_provider_events()',sql)

    def test_cached_sequence_value_is_explicitly_not_a_rollback_claim(self):
        m=self.m
        self.assertIn('pg_sequence',m.SEQUENCE_SHAPE)
        self.assertNotIn('last_value',m.SEQUENCE_SHAPE)
        self.assertNotIn('setval',m.SEQUENCE_SHAPE)
        self.assertEqual(m.CACHE_SCOPE,'graphql.seq_schema_version')

    def test_native_adaptation_preserves_original_support_and_real_denial_probe(self):
        p=importlib.import_module('canonical_native_historical_prefix')
        m=importlib.import_module('canonical_native_repair_envelope')
        batch,sources=m.load_sources(p)
        before={'relation/public.roles':{'kind':'r','owner':'postgres'}}
        final={**before,'function/public.example()':{}}
        old=m.prepare(p,batch,sources,before,final,())
        native=m.prepare(p,batch,sources,before,final,(),native_events=True)
        self.assertIn(self.m.OLD_PREDICATE.encode(),old.sql)
        self.assertNotIn(self.m.OLD_PREDICATE.encode(),native.sql)
        for source in sources:self.assertEqual(native.sql.count(source.data),1)
        self.assertIn(b"tgrelid='public.roles'::regclass",native.sql)
        probes=m.probes(p,native)
        self.assertEqual(probes[0][1],'P0004')
        self.assertIn(self.m.OLD_PREDICATE.encode(),probes[0][0])
        self.assertEqual([s for _,s,_ in probes[-4:]],['P5653','57014','P5656','P5657'])
        self.assertEqual(len(probes),8) # old ban, three contract mismatches, four transaction probes

    def test_fixed_contract_mismatch_probes_do_not_modify_real_trigger_catalog(self):
        for setup in self.m.mismatch_setups():
            self.assertNotEqual(setup,self.m.setup_sql())
            self.assertIn('CREATE FUNCTION pg_temp.',setup)
            self.assertNotIn('ALTER EVENT TRIGGER',setup)
            self.assertNotIn('CREATE EVENT TRIGGER',setup)
            self.assertNotIn('UPDATE pg_',setup)

    def test_fresh_bootstrap_is_captured_before_any_historical_input(self):
        text=(Path(__file__).parent/'canonical-native-supabase-lifecycle.py').read_text()
        self.assertLess(text.index('provider_events.bootstrap('),text.index('historical.execute('))
        self.assertIn("provider_bootstrap=report['providerEventBootstrap']",text)

if __name__=='__main__':unittest.main(verbosity=2)
