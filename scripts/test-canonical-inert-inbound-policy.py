#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('inert_qualification',ROOT/'scripts/canonical-inert-inbound-policy-qualification.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class InertPolicyTests(unittest.TestCase):
    def test_exact_observed24_match_source_compiler_and_definition(self):
        sql,rows,revoke=m.selection()
        self.assertEqual(len(rows),24)
        for r in rows:
            table,name=r['identity'][1:];row=r['row']
            action={'r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE'}[row['command']]
            expected=('gridex_mp_'+hashlib.md5(f'public.{table}:{action}:authenticated'.encode()).hexdigest()[:20]
                      if row['permissive'] else 'tenant_lifecycle_'+action.lower()+'_guard')
            self.assertEqual(name,expected)
            payload='\x1f'.join((row['command'],str(row['permissive']).lower(),row['using_expression'],row['check_expression'],','.join(row['roles'])))
            self.assertEqual(hashlib.sha256(payload.encode()).hexdigest(),r['definitionSha256'])
            self.assertEqual(sql.count("('%s', '%s', '%s')"%(table,name,r['definitionSha256'])),3)
        self.assertIn('revoke all privileges',revoke)

    def test_delta_allows_only_exact24_policy_removals(self):
        _,rows,_=m.selection()
        catalog={'relation/public.outside':{'acl':'retained'},'policy/public.outside/service':{'roles':'retained'}}
        for r in rows:catalog['policy/public.'+r['identity'][1]+'/'+r['identity'][2]]={'definition':'retained'}
        before=(catalog,{'rows':'same'})
        after=({'relation/public.outside':{'acl':'retained'},'policy/public.outside/service':{'roles':'retained'}},{'rows':'same'})
        m.verify_delta(before,after,rows)
        for altered in ((dict(after[0],unexpected=True),after[1]),(after[0],{'rows':'changed'})):
            with self.assertRaisesRegex(ValueError,'INERT_EXACT_POLICY_DELTA_REQUIRED'):
                m.verify_delta(before,altered,rows)
        missing=copy.deepcopy(before);missing[0].pop('policy/public.'+rows[0]['identity'][1]+'/'+rows[0]['identity'][2])
        with self.assertRaisesRegex(ValueError,'INERT_EXPECTED_POLICY_MISSING'):
            m.verify_delta(missing,after,rows)

    def test_only_captured_policy_dependencies_may_disappear(self):
        _,rows,_=m.selection()
        policies={'policy/public.'+r['identity'][1]+'/'+r['identity'][2]:{} for r in rows}
        dependency='dependency/policy fixed on table public.fixed/table public.fixed/a'
        other='dependency/function retained()/table public.outside/n'
        before=(dict(policies, **{dependency:'a',other:'n'}),{'rows':'same'})
        after=({other:'n'},{'rows':'same'})
        m.verify_delta(before,after,rows,[dependency])
        with self.assertRaisesRegex(ValueError,'INERT_EXACT_POLICY_DELTA_REQUIRED'):
            m.verify_delta(before,({},after[1]),rows,[dependency])
        for invalid in ([dependency,dependency],['relation/public.outside'],['dependency/missing']):
            with self.assertRaisesRegex(ValueError,'INERT_DEPENDENCY_SET_REQUIRED'):
                m.verify_delta(before,after,rows,invalid)

    def test_dependency_capture_is_scoped_to_exact_policy_objects(self):
        from unittest.mock import Mock
        _,rows,_=m.selection()
        target=Mock()
        target.sql.return_value='["dependency/fixed"]'
        self.assertEqual(m.policy_dependencies(target,rows),['dependency/fixed'])
        query=target.sql.call_args.args[1]
        self.assertIn("d.classid='pg_policy'::regclass",query)
        self.assertIn("n.nspname='public'",query)
        for r in rows:
            self.assertIn("('%s','%s')" % tuple(r['identity'][1:]),query)

    def test_changed_candidate_refused(self):
        with patch.object(m,'CANDIDATE_SHA','0'*64):
            with self.assertRaisesRegex(ValueError,'INERT_QUALIFICATION_SOURCE_REQUIRED'):m.selection()

if __name__=='__main__':unittest.main()
