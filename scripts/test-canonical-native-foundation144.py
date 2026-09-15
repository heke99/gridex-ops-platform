#!/usr/bin/env python3
"""Source/transport tests, deliberately not a substitute for native SQL proof."""
import copy
import hashlib
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class PlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = importlib.import_module('canonical_native_foundation144')
        cls.p = importlib.import_module('canonical_native_historical_prefix')
        cls.plan = cls.m.prepare()

    def test_complete_order_and_residual_boundaries(self):
        self.assertEqual(len(self.plan),7)
        original=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        regular=[s for g in self.plan for s in g.steps if s.ordinal is not None]
        self.assertEqual([s.ordinal for s in regular],list(range(78,145)))
        self.assertEqual([s.source for s in regular],original[77:])
        self.assertEqual([g.end for g in self.plan],[77,99,99,125,125,144,144])
        residual=[s for g in self.plan for s in g.steps if s.ordinal is None]
        self.assertEqual(len(residual),7)
        self.assertEqual(len(set(s.source for s in residual)),7)
        self.assertEqual([g.kind for g in self.plan],['residual77','foundation78_99','residual99',
                          'foundation100_125','residual125','foundation126_144','residual144'])

    def test_source_bytes_and_rendered_dispositions_are_bound(self):
        dispositions=self.m.load('canonical-residual-source-admission.py').verify(ROOT)
        rendered={s['source']:s for s in dispositions['sources']}
        for g in self.plan:
            for s in g.steps:
                raw=(ROOT/'supabase'/s.source).read_bytes()
                self.assertEqual(self.p.sha(raw),s.source_sha256)
                self.assertEqual(self.p.sha(s.rendered),s.rendered_sha256)
                if s.ordinal is None:
                    self.assertEqual(s.rendered_sha256,rendered[s.source]['renderedSha256'])
                else:self.assertTrue(s.rendered==raw,'Original source bytes changed')

    def test_only_exact_outer_transaction_is_transferred(self):
        for g in self.plan:
            for s in g.steps:
                body,outer=self.m.atomic_body(s.rendered)
                self.assertTrue(s.sql==body,'Atomic source body changed')
                self.assertEqual(s.outer_transaction_transferred,outer)
                self.assertEqual(outer,s.ordinal in (90,91,96,97,104,143) or s.source.endswith('20260601070000_ediel_production_readiness_hardening.sql'))
                ids=self.p.identity(s.sql.decode())
                self.assertFalse(any(i[0].upper() in ('BEGIN','COMMIT','ROLLBACK','START') for i in ids))

    def test_unknown_or_changed_sources_fail_before_database(self):
        with patch.dict(self.m.SUPPORT_PINS,{'canonical-residual-transitions.py':'0'*64}):
            with self.assertRaises(ValueError):self.m.prepare()
        for value in ('../README.md','/tmp/x','migrations/nonexistent.sql'):
            with self.assertRaises(ValueError):self.m.read_source(value,{})

    def test_each_whole_body_is_preserved_in_atomic_program(self):
        for g in self.plan:
            program=self.m.render(g)
            for s in g.steps:self.assertEqual(program.sql.count(self.m.native_body(s)),1)
            self.assertIn(b'pg_advisory_xact_lock',program.sql)
            self.assertIn(b'native_foundation_context',program.sql)
            self.assertIn(b"stage='complete'",program.sql)
            self.assertNotIn(b'INSERT INTO supabase_migrations',program.sql)
            self.assertNotIn(b'ALTER SYSTEM',program.sql)
            self.assertNotIn(b'DISABLE TRIGGER ALL',program.sql)
            self.assertTrue(program.name.startswith('gridex_native_foundation_'))
            self.assertEqual(len(self.p.identity(program.sql.decode())),3)

    def test_db2_transfer_changes_only_exact_owned_fixture_admission(self):
        g=self.plan[-1]; s=g.steps[0]
        self.assertEqual(s.source,'migrations/01_db2_full_view_preflight_schema_and_functions.sql')
        body=self.m.native_body(s)
        self.assertNotIn(self.m.DB2_PORTABLE_TARGET.encode(),body)
        self.assertEqual(body.replace(self.m.DB2_NATIVE_TARGET.encode(),self.m.DB2_PORTABLE_TARGET.encode()),s.sql)
        for term in (b'DB2_INVITATION_INDEX_PREIMAGE_MISMATCH',b'DB2_LEGACY_OPERATOR_RECONCILIATION_REQUIRED',
                     b'LOCK TABLE public.company_invitations IN SHARE MODE',b'pg_backend_pid()',b'txid_current()',
                     b"stage='started'",b"current_user<>'postgres'",b"current_database()<>'postgres'"):
            self.assertIn(term,body)
        self.assertEqual(self.m.native_body(g.steps[1]),g.steps[1].sql)

    def test_db2_original_environment_rejection_is_a_required_native_control(self):
        g=self.plan[-1]
        program=self.m.render(g,failure='portable')
        self.assertIn(self.m.DB2_PORTABLE_TARGET.encode(),program.sql)
        self.assertNotIn(self.m.DB2_NATIVE_TARGET.encode(),program.sql)
        self.assertIn(b"HINT=CASE WHEN SQLERRM='DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED'",program.sql)
        for other in self.plan[:-1]:
            with self.assertRaises(ValueError):self.m.render(other,failure='portable')

    def test_db2_changed_or_duplicated_target_predicate_is_not_transferred(self):
        from dataclasses import replace
        s=self.plan[-1].steps[0]
        for body in (s.sql.replace(self.m.DB2_PORTABLE_TARGET.encode(),b'IF false THEN'),s.sql+s.sql):
            with self.assertRaises(ValueError):self.m.native_body(replace(s,sql=body))
        with self.assertRaises(ValueError):self.m.native_body(replace(s,source_sha256='0'*64))

    def test_db2_failure_hint_is_finite_and_not_an_arbitrary_error_message(self):
        raw=b'SQLSTATE 55000 NATIVE_FOUNDATION_STAGE_R071 HINT: DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED'
        self.assertEqual(self.m.failure_diagnostic(raw).get('reason'),'DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED')
        self.assertNotIn('secret',json.dumps(self.m.failure_diagnostic(raw.replace(b'DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED',b'secret@example.invalid'))))

    def test_whole_source_postconditions_and_index_oracles_are_not_dropped(self):
        raw=b'\n'.join(self.m.render(g).sql for g in self.plan)
        for token in (b'gridex_index_effects',b'INDEX_SOURCE_EFFECT_MISMATCH',
                      b'RESIDUAL_ACTOR_VIEW_IDENTITY_CHANGED',b'RESIDUAL_ROLE_IDENTITY_OR_ACL_CHANGED',
                      b'RESIDUAL_WHOLE_SOURCE_EFFECT_MISSING',b'ediel_field_rules',
                      b'grid-owner-agreements',b'negative_aperak_on_error'):
            self.assertTrue(token in raw,'Missing bounded condition '+token.decode())

    def test_ledger_guard_is_exact_invoker_with_lock_and_transaction_checks(self):
        for g in self.plan:
            p=self.m.render(g)
            sql=self.m.ledger_guard(p.name)
            for term in (p.name,'SECURITY INVOKER','pg_locks','txid_current','pg_backend_pid',
                         "stage='complete'",'P1482'):
                self.assertIn(term,sql)
            self.assertNotIn('SECURITY DEFINER',sql)
        with self.assertRaises(ValueError):self.m.ledger_guard('arbitrary')

    def test_incomplete77_is_rejected_before_sql_or_cli(self):
        def fail(*a,**kw):self.fail('Database accessed before predecessor acceptance')
        for parent in ({},{'foundationInputsExecuted':77},
                       {'foundationInputsExecuted':77,'historicalOperations77':{'verified':True}}):
            with self.assertRaises(ValueError):self.m.execute(self.p,fail,fail,Path('/tmp'),parent)

    def test_error_projection_never_emits_raw_source_or_customer_data(self):
        raw=b'ERROR: private@example.invalid SQLSTATE 23514 NATIVE_FOUNDATION_STAGE_0087'
        self.assertEqual(self.m.failure_diagnostic(raw),{'sqlstate':'23514','stage':'0087'})
        value=self.m.failure_diagnostic(b'ERROR private@example.invalid arbitrary 12345')
        self.assertNotIn('private',json.dumps(value))
        self.assertIsNone(value['sqlstate'])

    def test_real_ledger_identity_rejects_skipped_replaced_or_extra_body(self):
        g=self.plan[0];p=self.m.render(g);raw=p.sql.decode()
        stmts=[raw[t[0][1]:t[-1][2]] for t in self.p.statements(raw)]
        filename='20260915090000_'+p.name+'.sql'
        entry={'name':p.name,'version':filename[:14],'statements':stmts}
        self.p.verify_entry(entry,filename,p)
        for wrong in (stmts[:-1],['SELECT 1'],stmts+['SELECT 2']):
            with self.assertRaises(ValueError):self.p.verify_entry({**entry,'statements':wrong},filename,p)

    def test_provider_counter_value_never_called_rollback(self):
        text=(ROOT/'scripts/canonical_native_foundation144.py').read_text()
        self.assertIn('sequenceValuesRollbackClaimed=False',text)
        self.assertIn('completeReplayVerified=False',text)
        self.assertIn('generatedTypesVerified=False',text)
        self.assertNotIn('completeReplayVerified=True',text)

class ExecutionControlTests(unittest.TestCase):
    def exercise(self, fault=None):
        from datetime import datetime, timedelta
        from types import SimpleNamespace
        m=importlib.import_module('canonical_native_foundation144')
        p=m.prefix
        groups=m.prepare()
        entries=[{'version':'20260915090000','name':'prior','statements':['SELECT 1']}]
        state={'runs':0,'created':0,'guard':False,'entries':copy.deepcopy(entries)}
        parent={'providerEventBootstrap':m.provider.receipt(),'foundationInputsExecuted':77}
        batch=SimpleNamespace(catalog_sql=lambda:'SELECT \'test_catalog\'::json;')
        with tempfile.TemporaryDirectory() as root:
            d=Path(root);d.chmod(0o700)
            old=d/'20260915090000_prior.sql';old.write_bytes(b'SELECT 1;');old.chmod(0o600)
            stat=old.stat();retained=[(old,b'SELECT 1;',(stat.st_dev,stat.st_ino))]
            def sql(query):
                if query==p.LEDGER_SQL:return copy.deepcopy(state['entries'])
                if query==m.DROP_GUARD:
                    state['guard']=False
                    return fault!='cleanup'
                if 'CREATE TRIGGER gridex_native_foundation_guard' in query:
                    state['guard']=True;return True
                if "jsonb_build_object('role',current_user" in query:
                    return {'role':'postgres','database':'postgres','settings':p.SETTINGS}
                if query==m.repair.catalog_sql(batch):key='catalog'
                elif query==m.repair.previous.ROWS_SQL:key='rows'
                elif query==m.repair.SEQUENCES_SQL:key='sequences'
                elif query==m.provider.QUERY:key='events'
                else:self.fail('Unexpected SQL callback')
                return {'changed':bool(state['runs'] and fault==key)}
            def native(*args,**kwargs):
                if args[:2]==('migration','new'):
                    state['created']+=1
                    version=(datetime(2026,9,15,9,1)+timedelta(seconds=state['created'])).strftime('%Y%m%d%H%M%S')
                    path=d/(version+'_'+args[2]+'.sql');path.write_text('');state['path']=path
                    return SimpleNamespace(returncode=0,stderr=b'')
                self.assertEqual(args,('migration','up','--local'))
                native_run=state['runs'];state['runs']+=1
                phase=native_run%5
                if native_run==30:
                    return SimpleNamespace(returncode=1,stderr=b'SQLSTATE 55000 NATIVE_FOUNDATION_STAGE_R071 HINT: DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED')
                if native_run>30:phase=(native_run-1)%5
                if fault=='file':old.write_bytes(b'SELECT 2;')
                if phase<3:
                    if phase==2:self.assertTrue(state['guard'])
                    code=('P1480','P1481','P1482')[phase]
                    if fault=='wrong_error':code='P9999'
                    if fault=='ledger':state['entries'].append({'fabricated':True})
                    return SimpleNamespace(returncode=0 if fault=='unexpected_success' else 1,
                                           stderr=('SQLSTATE '+code).encode())
                if phase==3:
                    if fault=='apply':return SimpleNamespace(returncode=1,stderr=b'SQLSTATE 23514')
                    path=state['path'];raw=path.read_text()
                    statements=[raw[t[0][1]:t[-1][2]] for t in p.statements(raw)]
                    state['entries'].append({'version':path.name[:14],'name':path.name[15:-4],
                       'statements':['SELECT 2'] if fault=='statements' else statements})
                if phase==4 and fault=='repeat':state['entries'].append({'repeat':True})
                return SimpleNamespace(returncode=0,stderr=b'')
            with patch.object(m,'predecessor',return_value=(d,entries,retained)), \
                 patch.object(m,'prepare',return_value=groups), \
                 patch.object(m.repair,'load_sources',return_value=(batch,())), \
                 patch.object(m.provider,'require'),patch.object(m.time,'sleep'):
                if fault:
                    with self.assertRaises(ValueError):m.execute(p,native,sql,d,parent)
                    self.assertFalse(parent['historicalFoundation144']['executed'])
                else:
                    r=m.execute(p,native,sql,d,parent)
                    self.assertTrue(r['executed'])
                    self.assertEqual(r['foundationInputsExecuted'],67)
                    self.assertEqual(r['residualInputsExecuted'],7)
                    self.assertEqual(parent['foundationInputsExecuted'],144)
                    self.assertEqual(len(state['entries']),8)
                    self.assertEqual([len(g['cases']) for g in r['groups']],[3,3,3,3,3,3,4])
                    self.assertFalse(r['completeReplayVerified'])
                    self.assertFalse(r['fullSourceEffectsAccepted'])
                    self.assertFalse(state['guard'])
                    self.assertEqual(len(list(d.iterdir())),8)
    def test_complete_call_order_and_actual_statement_readback(self):self.exercise()
    def test_wrong_error_stops_without_acceptance(self):self.exercise('wrong_error')
    def test_unexpected_success_is_not_a_negative_proof(self):self.exercise('unexpected_success')
    def test_failed_ledger_write_is_rejected(self):self.exercise('ledger')
    def test_catalog_rollback_failure_rejected(self):self.exercise('catalog')
    def test_row_rollback_failure_rejected(self):self.exercise('rows')
    def test_event_rollback_failure_rejected(self):self.exercise('events')
    def test_retained_source_change_rejected(self):self.exercise('file')
    def test_guard_cleanup_failure_rejected(self):self.exercise('cleanup')
    def test_actual_migration_failure_rejected(self):self.exercise('apply')
    def test_wrong_actual_ledger_statements_rejected(self):self.exercise('statements')
    def test_noop_repeat_mutation_rejected(self):self.exercise('repeat')


if __name__=='__main__':unittest.main(verbosity=2)
