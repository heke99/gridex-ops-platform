#!/usr/bin/env python3
"""Test exact whole-source transport with real file and SQL-writer methods.

Container liveness and the SQL subprocess alone are doubled; no native SQL claim.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('retained_input_loader', ROOT/'scripts/canonical-auth-provisioning-replay.py')
controller = importlib.util.module_from_spec(spec); spec.loader.exec_module(controller)
m = controller.load_private()
SQL = {
    'residual_apply_1': ('20260522_db1_schema_repair_backfill_foundation.sql', True),
    'timestamp_120': ('20260623090000_z01_route_profile_actor_setting_backfill.sql', False),
    'timestamp_488': ('20260902100000_rpc_surface_and_permission_scope_corrections.sql', False),
}
FOUNDATION = {
    'replay-source-120.sql': '01_db2b_preflight_views.sql',
    'replay-source-121.sql': '03_db2b_validation_views.sql',
}


class RetainedInputTests(unittest.TestCase):
    @contextlib.contextmanager
    def prepared(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as hold, \
             patch.dict(os.environ, {'GRIDEX_LEGACY_CONTAINER_NAME':'gridex-auth-legacy-continuation-12345678-1'}), \
             patch.object(m.repair,'require_owned'), patch.object(m.dedupe,'require_live'), \
             patch.object(m.subprocess,'run', return_value=subprocess.CompletedProcess([],0,b'',b'')):
            h = m.legacy.OwnedPostgres(postgis=True)
            h.directory = SimpleNamespace(name=directory); h.active=True
            for filename in list(FOUNDATION.values())+[row[0] for row in SQL.values()]:
                (Path(hold)/filename).write_bytes((ROOT/'supabase/migrations'/filename).read_bytes())
            try:
                with m.AcceptedInputs(h) as inputs:
                    inputs.staging = m.legacy.StagedSources(hold)
                    m.dedupe._STATES[h]='INTAKE_COMPLETE'
                    m.dedupe._REFERENCES[h]=SimpleNamespace(scope='full')
                    yield h,inputs
            finally:
                m.dedupe._STATES.pop(h,None);m.dedupe._REFERENCES.pop(h,None)

    def closed_proof(self,h,inputs):
        inputs.__exit__(None,None,None)
        return SimpleNamespace(h=h,name=h.name,directory=h.directory.name)

    def write_sql(self,h,stage,raw=None,**kwargs):
        filename,transaction=SQL[stage]
        source=(ROOT/'supabase/migrations'/filename).read_text() if raw is None else raw
        with contextlib.redirect_stdout(io.StringIO()):
            h.sql(kwargs.pop('database',m.replay.DATABASE),source,stage,transaction=kwargs.pop('transaction',transaction),**kwargs)
        return next(p for p in Path(h.directory.name).glob('fixture-*.sql'))

    def test_all_three_real_sql_writers_have_closed_whole_input_provenance(self):
        for stage in SQL:
            with self.subTest(stage=stage), self.prepared() as (h,inputs):
                path=self.write_sql(h,stage)
                self.assertTrue(inputs.whole_input(self.closed_proof(h,inputs),path))

    def test_both_foundation_sources_have_exact_writer_phase_and_source_pins(self):
        manifest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
        for name,filename in FOUNDATION.items():
            with self.subTest(name=name),self.prepared() as (h,inputs):
                self.assertEqual(inputs.sources.get(name),(filename,manifest[filename]))
                loop=object.__new__(m.replay.FoundationLoop);loop.target=h
                frame=SimpleNamespace(f_code=m.replay.FoundationLoop._run.__code__,f_locals={'self':loop})
                self.assertTrue(inputs.writer(frame,name))
                m.dedupe._STATES[h]='FRESH'
                self.assertFalse(inputs.writer(frame,name))

    def test_changed_bytes_rejected_before_file_or_subprocess(self):
        with self.prepared() as (h,inputs):
            with self.assertRaises(m.BoundaryError): self.write_sql(h,'timestamp_120',raw='SELECT 1;')
            self.assertFalse(list(Path(h.directory.name).glob('fixture-*.sql')))
            m.subprocess.run.assert_not_called()

    def test_wrong_phase_scope_database_transaction_and_expectation_rejected(self):
        cases=('phase','scope','database','transaction','expect')
        for case in cases:
            with self.subTest(case=case),self.prepared() as (h,inputs):
                kwargs={}
                if case=='phase': m.dedupe._STATES[h]='FRESH'
                if case=='scope': m.dedupe._REFERENCES[h]=SimpleNamespace(scope='intake77')
                if case=='database': kwargs['database']='gridex_auth_legacy_atomic'
                if case=='transaction': kwargs['transaction']=True
                if case=='expect': kwargs['expect']='23514'
                with self.assertRaises(m.BoundaryError): self.write_sql(h,'timestamp_120',**kwargs)
                self.assertFalse(list(Path(h.directory.name).glob('fixture-*.sql')))

    def test_repeated_source_stage_rejected(self):
        with self.prepared() as (h,inputs):
            self.write_sql(h,'timestamp_120')
            with self.assertRaises(m.BoundaryError): self.write_sql(h,'timestamp_120')

    def test_source_copy_via_unreviewed_stage_has_no_provenance(self):
        with self.prepared() as (h,inputs):
            raw=(ROOT/'supabase/migrations'/SQL['timestamp_120'][0]).read_text()
            with contextlib.redirect_stdout(io.StringIO()): h.sql(m.replay.DATABASE,raw,'unreviewed_copy')
            path=next(Path(h.directory.name).glob('fixture-*.sql'))
            self.assertFalse(inputs.whole_input(self.closed_proof(h,inputs),path))

    def test_direct_private_copy_and_wrong_handle_are_not_accepted(self):
        with self.prepared() as (h,inputs):
            path=h.private('fixture-0123456789abcdef.sql',(ROOT/'supabase/migrations'/SQL['timestamp_120'][0]).read_bytes())
            self.assertFalse(inputs.whole_input(self.closed_proof(h,inputs),path))
            with self.assertRaises(m.BoundaryError):
                inputs.whole_input(SimpleNamespace(h=object(),name=h.name,directory=h.directory.name),path)

    def test_changed_content_replacement_symlink_and_mode_are_rejected(self):
        for attack in ('content','inode','symlink','mode'):
            with self.subTest(attack=attack),self.prepared() as (h,inputs):
                path=self.write_sql(h,'timestamp_120'); proof=self.closed_proof(h,inputs)
                if attack=='content': path.write_bytes(b'SELECT 1;')
                if attack=='inode':
                    other=path.with_suffix('.replacement');other.write_bytes(path.read_bytes());other.chmod(0o600);other.replace(path)
                if attack=='symlink':
                    other=path.with_suffix('.target');other.write_bytes(path.read_bytes());path.unlink();path.symlink_to(other)
                if attack=='mode': path.chmod(0o644)
                with self.assertRaises(m.BoundaryError): inputs.whole_input(proof,path)

    def test_staged_source_drift_or_missing_stage_rejected(self):
        for attack in ('drift','missing'):
            with self.subTest(attack=attack),self.prepared() as (h,inputs):
                if attack=='drift': (inputs.staging.hold/SQL['timestamp_120'][0]).write_text('SELECT 1;')
                else: inputs.staging=None
                with self.assertRaises(m.BoundaryError):self.write_sql(h,'timestamp_120')
                self.assertFalse(list(Path(h.directory.name).glob('fixture-*.sql')))

if __name__=='__main__':unittest.main(verbosity=2)
