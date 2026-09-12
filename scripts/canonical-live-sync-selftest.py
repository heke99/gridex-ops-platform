#!/usr/bin/env python3
"""Offline source/transaction/privacy tests; native proof runs separately."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]

def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

fix=load('canonical-live-sync-reconstruction')
proof=load('canonical-live-sync-proof')

class ReconstructionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original=fix.read_pinned(ROOT,fix.SOURCE,fix.SOURCE_SHA256)
        cls.rendered,cls.evidence=fix.reconstruct(ROOT,cls.original)

    def test_real_historical_failure_sequence_is_present(self):
        prefix,block,suffix=fix.split_source(self.original)
        self.assertEqual(block.count('perform public.gridex__repair_replace_function_text('),4)
        self.assertLess(block.index('v_disabled_at timestamptz'),block.index('into v_status, v_disabled_at'))
        self.assertIn('execute replace(v_definition, p_old, p_new);',prefix)
        self.assertEqual(self.original,prefix+block+suffix)

    def test_entire_non_session_source_retained_byte_for_byte(self):
        prefix,block,suffix=fix.split_source(self.original)
        self.assertTrue(self.rendered.startswith(prefix))
        self.assertTrue(self.rendered.endswith(suffix))
        self.assertNotIn(block,self.rendered)
        self.assertEqual(fix.digest(prefix.encode()),'6f729479f0b9ee8bc57d7cd25db7404f7bd189f0d6de74df0ad46180034ad24c')
        self.assertEqual(fix.digest(suffix.encode()),'2ac7f7c743fee92f6a2c38e15dc1d630d488131eff58f281cd083e7d6c9b08e6')

    def test_exact_complete_versioned_guard_reused_not_stubbed(self):
        definition,body=fix.function_parts(fix.read_pinned(ROOT,fix.FORWARD,fix.FORWARD_SHA256))
        self.assertEqual(self.rendered.count(definition),1)
        self.assertIn('return v_disabled_at is null;',body)
        self.assertIn("if v_user_id is null then\n    return false;",body)
        self.assertNotIn('gridex__forward_replace_function_text',self.rendered)

    def test_preimage_and_acl_oid_owner_assertions_are_in_same_transaction(self):
        for text in ("current_setting('check_function_bodies') <> 'on'",'LIVE_SYNC_GUARD_PREIMAGE_MISMATCH',
                     'p.oid=b.oid','p.proowner=b.proowner','p.proacl IS NOT DISTINCT FROM b.proacl',
                     'LIVE_SYNC_GUARD_POSTIMAGE_MISMATCH'):
            self.assertIn(text,self.rendered)
        self.assertTrue(self.rendered.endswith('commit;\n'))
        self.assertLess(self.rendered.index('begin;'),self.rendered.index('DO $session_admission$'))
        self.assertNotIn('check_function_bodies = off',self.rendered)
        self.assertNotIn('DISABLE TRIGGER',self.rendered)

    def test_reconstructed_bytes_are_deterministic_and_receipt_is_scoped(self):
        again,evidence=fix.reconstruct(ROOT,self.original)
        self.assertEqual(again,self.rendered)
        self.assertEqual(evidence,self.evidence)
        self.assertEqual(evidence['reconstructedSha256'],'ccebd218e15fb8243178f9d4e94490a0b4113dd0fa9163468401b9c8429a867a')
        self.assertIs(evidence['completeSourceEffectsAccepted'],False)
        self.assertIs(evidence['historicalBytesModified'],False)

    def test_changed_historical_bytes_fail_before_rendering(self):
        for changed in (self.original+'\n',self.original.replace('v_disabled_at','altered'),self.rendered):
            with self.assertRaisesRegex(ValueError,'LIVE_SYNC_SOURCE_HASH_MISMATCH'):
                fix.reconstruct(ROOT,changed)

    def test_changed_forward_authority_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'supabase/migrations').mkdir(parents=True)
            for name,sha in ((fix.ORIGINAL,fix.ORIGINAL_SHA256),(fix.FORWARD,fix.FORWARD_SHA256)):
                (root/'supabase'/name).write_text(fix.read_pinned(ROOT,name,sha))
            p=root/'supabase'/fix.FORWARD;p.write_text(p.read_text().replace('return false;','return true;'))
            with self.assertRaisesRegex(ValueError,'LIVE_SYNC_SOURCE_HASH_MISMATCH'):
                fix.reconstruct(root,self.original)

    def test_symlink_source_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'supabase/migrations').mkdir(parents=True)
            (root/'supabase'/fix.ORIGINAL).symlink_to(ROOT/'supabase'/fix.ORIGINAL)
            with self.assertRaisesRegex(ValueError,'LIVE_SYNC_SOURCE_REQUIRED'):
                fix.reconstruct(root,self.original)

    def test_missing_or_duplicate_function_authority_rejected(self):
        definition,_=fix.function_parts(fix.read_pinned(ROOT,fix.FORWARD,fix.FORWARD_SHA256))
        for sql in ('SELECT 1;',definition+'\n'+definition):
            with self.assertRaisesRegex(ValueError,'LIVE_SYNC_FUNCTION_AUTHORITY_MISMATCH'):
                fix.function_parts(sql)

    def test_no_external_clone_or_production_target(self):
        class Target:
            def command(self,*args):raise AssertionError('no I/O allowed')
        for source,destination in (('production',proof.CLONES[0]),('gridex_auth_legacy_replay','production')):
            with self.assertRaisesRegex(ValueError,'LIVE_SYNC_OWNED_CLONE_REQUIRED'):
                proof.clone(Target(),source,destination)
        with self.assertRaisesRegex(ValueError,'LIVE_SYNC_OWNED_TARGET_REQUIRED'):
            proof.execute_boundary(ROOT,Target(),'production',self.original,{})

    def test_fixture_acl_and_disabled_status_checks_are_not_omitted(self):
        class Target:
            def __init__(self):self.calls=[]
            def reset(self,name):self.name=name
            def sql(self,*args,**kwargs):self.calls.append((args,kwargs));return ''
        target=Target();definition,_=fix.function_parts(fix.read_pinned(ROOT,fix.FORWARD,fix.FORWARD_SHA256))
        with patch.object(proof,'checkpoint'):
            proof.behavior(target,{'definition':definition,'execute':{'anon':False,'authenticated':True,'service_role':True}})
        combined='\n'.join(call[0][1] for call in target.calls)
        for text in ('locked_security','disabled_at=now()','SET LOCAL ROLE authenticated','DROP COLUMN disabled_at','DROP TABLE public.user_profiles'):
            self.assertIn(text,combined)
        denied=next(call for call in target.calls if call[0][2]=='live_sync_acl_anon')
        self.assertEqual(denied[1]['expect'],'42501')

    def test_sql_error_diagnostic_is_closed_and_source_bound(self):
        # Loading through the existing controller preserves its dataclass loader.
        controller=load('canonical-auth-provisioning-replay').controller()
        legacy=controller.load_batch()
        def receipt(message):
            return legacy.safe_receipt('ERROR: 55000: '+message+'\nDETAIL: private-value',3,'live_sync_test')
        self.assertEqual(receipt('LIVE_SYNC_GUARD_PREIMAGE_MISMATCH')['known_failure'],'LIVE_SYNC_GUARD_PREIMAGE_MISMATCH')
        signature='public.gridex_is_current_session_allowed()'
        self.assertEqual(receipt('gridex_repair_unexpected_function_definition:'+signature)['source_function'],signature)
        for message in ('secret@example.test','LIVE_SYNC_SECRET_VALUE',
                        'gridex_repair_unexpected_function_definition:public.private_value()'):
            result=receipt(message)
            self.assertNotIn('known_failure',result)
            self.assertNotIn('source_function',result)
            self.assertNotIn('private-value',str(result))
        self.assertNotIn('known_failure',legacy.safe_receipt('ERROR: 55000: LIVE_SYNC_GUARD_PREIMAGE_MISMATCH',3,'unrelated'))

    def test_original_files_are_not_modified_by_rendering(self):
        for name,expected in ((fix.SOURCE,fix.SOURCE_SHA256),(fix.ORIGINAL,fix.ORIGINAL_SHA256),(fix.FORWARD,fix.FORWARD_SHA256)):
            self.assertEqual(fix.digest((ROOT/'supabase'/name).read_bytes()),expected)

if __name__=='__main__':unittest.main()
