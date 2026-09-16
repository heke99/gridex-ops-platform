#!/usr/bin/env python3
"""Finite reference dependency and privilege checks; no database required."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('private_reference',ROOT/'scripts/canonical-reference-private-functions.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)


class PrivateReferenceTests(unittest.TestCase):
    def test_all_direct_triggers_and_transitive_private_helpers_are_present(self):
        manifest,programs,expected=m.inputs()
        self.assertEqual(len(manifest['triggerFunctions']),14)
        self.assertEqual(set(programs)-set(manifest['triggerFunctions']),
                         {'gridex_emit_partner_resource_event_v2','remove_terms_accepted_from_application_response'})
        self.assertEqual(set(programs),set(expected))
        for name,program in programs.items():
            self.assertTrue(program.startswith('create or replace function private.'+name+'('))
            self.assertEqual(m.sha(program),manifest['functions'][name]['programSha256'])

    def test_exact_explicit_privileges_and_invoker_functions_are_preserved(self):
        _,_,expected=m.inputs()
        self.assertEqual(expected['gridex_guard_site_resolution_materialization_v1']['rights'],
                         {'anon':False,'authenticated':False,'service_role':True})
        self.assertFalse(expected['gridex_require_locked_pricing_run_for_invoice_export']['securityDefiner'])
        self.assertFalse(expected['normalize_website_application_legal_blockers']['securityDefiner'])
        self.assertTrue(expected['gridex_partner_customer_event_v2']['rights']['anon'])
        self.assertIn('revoke all on schema private from public, anon, authenticated, service_role;',m.SCHEMA_BLOCK)

    def test_reference_schema_only_program_is_transactional_and_not_public_ddl(self):
        target=Mock();m.prepare(target)
        call=target.sql.call_args
        self.assertEqual(call.args[0],'gridex_auth_legacy_native')
        self.assertIs(call.kwargs['transaction'],True)
        self.assertTrue(call.args[1].startswith('SET LOCAL check_function_bodies = off;'))
        self.assertNotRegex(call.args[1],r'(?m)^create (?:or replace )?(?:function|trigger|table|view) public\.')
        self.assertNotIn('create trigger manual_inbound_tenant_graph_guard',call.args[1])

    def test_wrong_source_checksum_missing_source_and_unsafe_path_are_rejected(self):
        manifest,_,_=m.inputs();item=next(iter(manifest['functions'].values()))
        for name,digest in ((item['source'],'0'*64),('../source.sql',item['sourceSha256']),
                            ('missing.sql',item['sourceSha256'])):
            with self.assertRaises(ValueError):m.source(name,digest)
        with patch.object(m.Path,'is_symlink',return_value=True),self.assertRaises(ValueError):
            m.source(item['source'],item['sourceSha256'])

    def test_wrong_program_hash_or_missing_helper_fails_before_sql(self):
        original=json.loads((ROOT/m.MANIFEST).read_text())
        original_read=m.Path.read_text
        for mode in ('program','missing','extra','trigger_set'):
            altered=copy.deepcopy(original)
            if mode=='program':next(iter(altered['functions'].values()))['programSha256']='0'*64
            if mode=='missing':del altered['functions']['remove_terms_accepted_from_application_response']
            if mode=='extra':altered['functions']['unrelated']=next(iter(altered['functions'].values()))
            if mode=='trigger_set':altered['triggerFunctions'].pop()
            def read(path,*args,**kwargs):
                return json.dumps(altered) if path==ROOT/m.MANIFEST else original_read(path,*args,**kwargs)
            target=Mock()
            with patch.object(m.Path,'read_text',read),self.assertRaises(ValueError):m.prepare(target)
            target.sql.assert_not_called()

    def test_duplicate_or_unterminated_declaration_is_rejected(self):
        text='create or replace function private.example() returns trigger language plpgsql as $$begin return new; end;$$;'
        with self.assertRaises(ValueError):m.extract(text+'\n'+text,'example')
        with self.assertRaises(ValueError):m.extract(text[:-3],'example')
        with self.assertRaises(ValueError):m.extract(text,'../example')

    def test_native_contract_checks_every_body_security_mode_acl_and_namespace(self):
        _,_,expected=m.inputs()
        good={'schemaRestricted':True,'functions':expected,'functionCount':16}
        target=Mock();target.sql.return_value=json.dumps(good)
        self.assertTrue(m.verify(target)['exactBodiesAndPrivilegesVerified'])
        for mode in ('schema','count','body','security','privilege','missing'):
            bad=copy.deepcopy(good)
            first=next(iter(bad['functions']))
            if mode=='schema':bad['schemaRestricted']=False
            if mode=='count':bad['functionCount']=17
            if mode=='body':bad['functions'][first]['bodyMd5']='0'*32
            if mode=='security':bad['functions'][first]['securityDefiner']=not bad['functions'][first]['securityDefiner']
            if mode=='privilege':bad['functions'][first]['rights']['anon']=not bad['functions'][first]['rights']['anon']
            if mode=='missing':del bad['functions'][first]
            target.sql.return_value=json.dumps(bad)
            with self.assertRaisesRegex(ValueError,'PRIVATE_DEPENDENCY_NATIVE_CONTRACT_MISMATCH'):m.verify(target)


if __name__=='__main__':unittest.main(verbosity=2)
