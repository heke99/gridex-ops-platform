#!/usr/bin/env python3
"""Retained timestamp/authority tests. SQL transport doubles are not native proof."""
import hashlib
import importlib.util
from pathlib import Path
from types import MappingProxyType
from unittest.mock import patch
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location('retained_' + name.replace('-', '_'), ROOT/'scripts'/(name+'.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m

tail = load('canonical-timestamp-frontier')
fix = load('canonical-live-sync-reconstruction')

class RetainedTimestampTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frontier=load('canonical-foundation-frontier-diagnostic')
        cls.order,cls.report=frontier.verify_selection(frontier.load_controller())
        cls.selected,cls.prerequisites=tail.load_inputs(ROOT,cls.report,cls.order)

    def test_all_selected_and_authority_bytes_retained_once(self):
        reads=[]
        original=Path.read_bytes
        def record(p):
            reads.append(p)
            return original(p)
        with patch.object(Path,'read_bytes',record):
            retained=tail.retain_sources(ROOT,self.selected,self.prerequisites)
        expected={p for p,_ in self.selected}|{p for p,_ in self.prerequisites.values()}|{fix.ORIGINAL,fix.FORWARD,fix.HARDENING}
        self.assertEqual(set(retained),expected)
        self.assertIsInstance(retained,MappingProxyType)
        self.assertEqual(len(reads),len(expected))
        with self.assertRaises(TypeError):
            retained[fix.SOURCE]=b'changed'

    def test_selected_inputs_work_with_no_file_reads_after_admission(self):
        retained=tail.retain_sources(ROOT,self.selected,self.prerequisites)
        with patch.object(Path,'read_bytes',side_effect=AssertionError('source reopened')):
            for source in self.selected+list(self.prerequisites.values()):
                self.assertEqual(tail.read_source(ROOT,source,retained=retained).encode(),retained[source[0]])

    def test_session_render_is_byte_identical_in_both_lanes(self):
        source=(ROOT/'supabase'/fix.SOURCE).read_text()
        expected=fix.reconstruct(ROOT,source)
        retained=tail.retain_sources(ROOT,self.selected,self.prerequisites)
        with patch.object(Path,'read_bytes',side_effect=AssertionError('authority reopened')):
            self.assertEqual(fix.reconstruct(ROOT,source,retained=retained),expected)

    def test_missing_authority_has_no_repository_fallback(self):
        raw=dict(tail.retain_sources(ROOT,self.selected,self.prerequisites))
        for relative in (fix.ORIGINAL,fix.FORWARD,fix.HARDENING):
            broken={p:v for p,v in raw.items() if p!=relative}
            with self.subTest(relative=relative),patch.object(Path,'read_bytes',side_effect=AssertionError('fallback')):
                with self.assertRaisesRegex(ValueError,'LIVE_SYNC_RETAINED_SOURCE_REQUIRED'):
                    fix.reconstruct(ROOT,raw[fix.SOURCE].decode(),retained=MappingProxyType(broken))

    def test_changed_or_nonbytes_authority_is_rejected(self):
        raw=dict(tail.retain_sources(ROOT,self.selected,self.prerequisites))
        for value in (raw[fix.FORWARD]+b'\n',raw[fix.FORWARD].decode(),bytearray(raw[fix.FORWARD])):
            with self.subTest(kind=type(value).__name__),self.assertRaises(ValueError):
                fix.reconstruct(ROOT,raw[fix.SOURCE].decode(),retained=MappingProxyType({**raw,fix.FORWARD:value}))

    def test_missing_mutated_or_mutable_selected_bundle_rejected(self):
        raw=dict(tail.retain_sources(ROOT,self.selected,self.prerequisites))
        source=self.selected[0]
        for bundle in ({**raw},MappingProxyType({p:v for p,v in raw.items() if p!=source[0]}),
                       MappingProxyType({**raw,source[0]:raw[source[0]]+b'\n'})):
            with self.subTest(kind=type(bundle).__name__),self.assertRaises(ValueError):
                tail.read_source(ROOT,source,retained=bundle)

    def test_retained_tail_rejects_source_path_escape(self):
        with self.assertRaises(ValueError):
            tail.read_source(ROOT,('../private.sql',hashlib.sha256(b'SELECT 1;').hexdigest()),
                             retained=MappingProxyType({'../private.sql':b'SELECT 1;'}))

    def test_full_tail_transport_consumes_retained_bytes_and_preserves_order(self):
        retained=tail.retain_sources(ROOT,self.selected,self.prerequisites)
        calls=[]
        class Target:
            def sql(self,db,sql,stage,transaction=False):
                calls.append((stage,sql,transaction))
                return 'no' if stage=='timestamp_white_label_probe' else ''
        # Only native database work is doubled; selected SQL/authority reads and
        # the real scheduler remain active. The hosted staging test runs SQL.
        def boundary(root,target,db,sql,progress,*,retained=None):
            rendered,evidence=fix.reconstruct(root,sql,retained=retained)
            calls.append(('session',rendered,False))
            progress['sessionReconstruction']=evidence
        with patch.object(tail,'load_live_sync_proof') as proof, \
             patch.object(tail,'load_restoration') as restoration, \
             patch.object(tail,'load_residual_restoration') as residual, \
             patch.object(Path,'read_bytes',side_effect=AssertionError('source reopened')):
            proof.return_value.fix=fix
            proof.return_value.execute_boundary.side_effect=boundary
            restoration.return_value.SOURCES={}
            residual.return_value.TIMESTAMP_SOURCES={}
            progress={}
            tail.execute_tail(ROOT,Target(),'owned_test',self.selected,self.prerequisites,progress,retained=retained)
        self.assertEqual(progress['timestampApplied'],514)
        self.assertEqual(len([s for s,_,_ in calls if s=='session']),1)
        for ordinal,source in enumerate(self.selected,1):
            if source[0]!=fix.SOURCE:
                actual=[sql for stage,sql,_ in calls if stage=='timestamp_'+str(ordinal)]
                self.assertEqual(actual,[retained[source[0]].decode()])
        self.assertTrue(all(not transaction for _,_,transaction in calls))

    def test_incomplete_bundle_fails_before_any_sql(self):
        raw=dict(tail.retain_sources(ROOT,self.selected,self.prerequisites))
        for missing in (self.selected[-1][0],fix.ORIGINAL):
            broken=MappingProxyType({p:v for p,v in raw.items() if p!=missing})
            class NoSql:
                def sql(self,*args,**kwargs):
                    raise AssertionError('SQL must not run before complete admission')
            with self.subTest(missing=missing),self.assertRaises(ValueError):
                tail.execute_tail(ROOT,NoSql(),'owned_test',self.selected,self.prerequisites,{},retained=broken)

    def test_duplicate_selected_source_is_rejected_before_reads(self):
        with patch.object(Path,'read_bytes',side_effect=AssertionError('source read')):
            with self.assertRaisesRegex(ValueError,'TIMESTAMP_DUPLICATE_SOURCE'):
                tail.retain_sources(ROOT,self.selected+[self.selected[0]],self.prerequisites)

    def test_native_staging_keeps_originals_absent_through_tail(self):
        import ast
        tree=ast.parse((ROOT/'scripts/canonical-residual-staging-native.py').read_text())
        blocks=[n for n in ast.walk(tree) if isinstance(n,ast.With) and any(
            isinstance(i.context_expr,ast.Call) and isinstance(i.context_expr.func,ast.Name)
            and i.context_expr.func.id=='originals_absent' for i in n.items)]
        self.assertEqual(len(blocks),1)
        calls=[n for n in ast.walk(blocks[0]) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)
               and n.func.attr=='execute_tail']
        self.assertEqual(len(calls),1,'timestamp must execute before originals are restored')
        self.assertTrue(any(k.arg=='retained' for k in calls[0].keywords))

if __name__=='__main__':
    unittest.main(verbosity=2)
