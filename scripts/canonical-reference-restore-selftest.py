#!/usr/bin/env python3
"""No containers: prove isolated client arguments and cleanup rejection paths."""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('restore_test',ROOT/'scripts/canonical-reference-restore.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
ID='a'*64
NAME='gridex-reference-client-'+'b'*24
META={'Id':ID,'HostConfig':{'NetworkMode':'none','PortBindings':{}},
      'Config':{'Image':'postgis/postgis:17-3.5','Labels':{'gridex.auth-legacy.owner':'gridex-auth-legacy-test12345'}}}


class Target:
    name=_created_name='gridex-auth-legacy-test12345'
    active=True
    def __init__(self, meta=None):self.meta=meta or copy.deepcopy(META)
    def verify_logging(self):pass
    def docker(self, args):
        assert args==['inspect',self.name]
        return json.dumps([self.meta]).encode()


def result(code=0,out=b'',err=b''):
    return SimpleNamespace(returncode=code,stdout=out,stderr=err)


class RestoreTests(unittest.TestCase):
    def test_client_has_no_public_network_mounts_or_logging(self):
        argv=m.command(ID,NAME)
        self.assertEqual(argv[argv.index('--network')+1],'container:'+ID)
        self.assertIn('--log-driver=none',argv)
        self.assertIn('--read-only',argv)
        self.assertIn('--cap-drop=ALL',argv)
        self.assertIn('--security-opt=no-new-privileges',argv)
        self.assertIn('--rm',argv)
        self.assertEqual(argv[argv.index('--entrypoint')+1],'psql')
        self.assertNotIn('--volume',argv);self.assertNotIn('--publish',argv)
        self.assertEqual(argv[-2:],['-f','-'])

    def test_arbitrary_target_and_client_name_rejected(self):
        for target,name in [('postgresql://remote',NAME),(ID,'other'),('a'*63,NAME)]:
            with self.assertRaisesRegex(ValueError,'OWNED_RESTORE_CLIENT_REQUIRED'):
                m.command(target,name)

    def test_unowned_or_networked_server_never_starts_client(self):
        for bad in ('network','owner','ports','image'):
            meta=copy.deepcopy(META)
            if bad=='network':meta['HostConfig']['NetworkMode']='bridge'
            if bad=='owner':meta['Config']['Labels']={}
            if bad=='ports':meta['HostConfig']['PortBindings']={'5432/tcp':[{'HostPort':'5432'}]}
            if bad=='image':meta['Config']['Image']='unreviewed'
            with patch.object(m.subprocess,'run') as run:
                with self.assertRaisesRegex(ValueError,'ISOLATED_REFERENCE_SERVER_REQUIRED'):
                    m.execute(Target(meta),b'SELECT 1;')
                run.assert_not_called()

    def test_private_stdin_and_successful_auto_disposal(self):
        with patch.object(m.subprocess,'run',side_effect=[result(out=b'1\n'),result()]) as run:
            answer=m.execute(Target(),b'SELECT 1;')
            self.assertEqual(answer.stdout,b'1\n')
            self.assertEqual(run.call_args_list[0].kwargs['input'],b'SELECT 1;')
            self.assertTrue(run.call_args_list[0].kwargs['capture_output'])
            self.assertEqual(run.call_count,2)

    def test_timed_out_client_requires_verified_owned_disposal(self):
        owned={'Id':'c'*64,'Config':{'Labels':{'gridex.reference-client.owner':NAME},'Image':'postgres:17'},
               'HostConfig':{'NetworkMode':'container:'+ID}}
        timeout=m.subprocess.TimeoutExpired(['docker'],180)
        with patch.object(m.secrets,'token_hex',return_value='b'*24), \
             patch.object(m.subprocess,'run',side_effect=[timeout,result(out=b'c'*64),result(out=json.dumps([owned]).encode()),result()]) as run:
            with self.assertRaises(m.subprocess.TimeoutExpired):m.execute(Target(),b'SELECT 1;')
            self.assertEqual(run.call_args_list[-1].args[0],['docker','rm','--force','--volumes','c'*64])

    def test_cleanup_does_not_remove_an_unowned_client(self):
        owned={'Id':'c'*64,'Config':{'Labels':{'gridex.reference-client.owner':'other'},'Image':'postgres:17'},
               'HostConfig':{'NetworkMode':'container:'+ID}}
        with patch.object(m.secrets,'token_hex',return_value='b'*24), \
             patch.object(m.subprocess,'run',side_effect=[result(code=1),result(out=b'c'*64),result(out=json.dumps([owned]).encode())]) as run:
            with self.assertRaisesRegex(ValueError,'RESTORE_CLIENT_OWNERSHIP_MISMATCH'):
                m.execute(Target(),b'SELECT 1;')
            self.assertEqual(run.call_count,3)

    def test_disposal_failure_never_reports_success(self):
        with patch.object(m.subprocess,'run',side_effect=[result(),result(code=1)]):
            with self.assertRaisesRegex(ValueError,'RESTORE_CLIENT_DISPOSAL_UNVERIFIED'):
                m.execute(Target(),b'SELECT 1;')

    def test_native_restriction_controls_require_real_denials_and_recovery(self):
        replies = [result(code=3, err=b'restricted'), result(code=3, err=b'wrong key'),
                   result(out=b'1\nGRIDEX_RESTRICTION_RELEASED\n')]
        with patch.object(m, 'execute', side_effect=replies) as run:
            m.restriction_controls(Target())
            programs = [call.args[1] for call in run.call_args_list]
            self.assertEqual(len(programs), 3)
            self.assertIn(b'\\echo GRIDEX_FORBIDDEN_META', programs[0])
            self.assertIn(b'\\unrestrict wrong', programs[1])
            self.assertIn(b'\\echo GRIDEX_RESTRICTION_RELEASED', programs[2])
            self.assertNotIn(b'gridex_canonical_schema_snapshot', b''.join(programs))

    def test_native_controls_reject_a_client_that_ignores_restrictions(self):
        for index in (0, 1):
            replies = [result(code=3), result(code=3), result(out=b'1\nGRIDEX_RESTRICTION_RELEASED\n')]
            replies[index] = result(code=0)
            with patch.object(m, 'execute', side_effect=replies):
                with self.assertRaisesRegex(ValueError, 'NATIVE_RESTRICTION_DENIAL_REQUIRED'):
                    m.restriction_controls(Target())

    def test_native_controls_reject_missing_success_output_or_failed_client(self):
        for good in (result(code=3), result(), result(out=b'1\n'), result(out=b'private-value')):
            with patch.object(m, 'execute', side_effect=[result(code=3), result(code=3), good]):
                with self.assertRaisesRegex(ValueError, 'NATIVE_RESTRICTED_CLIENT_REQUIRED'):
                    m.restriction_controls(Target())

    def test_live_dump_rekeying_preserves_every_sql_line(self):
        raw=(ROOT/'supabase/schema.sql').read_bytes()
        out=m.rekey(raw)
        self.assertEqual(len(raw.splitlines()),len(out.splitlines()))
        self.assertEqual(sum(a!=b for a,b in zip(raw.splitlines(),out.splitlines())),2)


if __name__=='__main__':unittest.main(verbosity=2)
