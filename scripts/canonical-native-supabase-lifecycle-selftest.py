#!/usr/bin/env python3
"""Offline rejection controls for the synthetic native CLI lifecycle."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import stat
from types import SimpleNamespace
import tempfile
import tomllib
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_lifecycle',ROOT/'scripts/canonical-native-supabase-lifecycle.py')
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PROJECT = 'gridex-sb-45c3b5c5b510-0123456789abcdef'
TEMPLATE = '''project_id = "generated"
[db]
port = 54322
shadow_port = 54320
major_version = 17
[db.seed]
enabled = true
[api]
enabled = true
[analytics]
enabled = false
[auth]
enabled = true
site_url = "http://localhost:3000"
[storage]
enabled = true
[realtime]
enabled = true
[edge_runtime]
enabled = true
deno_version = 2
'''
FILE = '20260914000000_native_lifecycle_proof.sql'


def ledger():
    return {'ledger':[{'version':FILE[:14],'name':'native_lifecycle_proof',
                       'statements':[s.strip() for s in m.FIRST.split(';') if s.strip()]}],
            'probeRows':1,'failedColumnExists':False,'probeAcl':None,'probeRls':True}


class NativeTests(unittest.TestCase):
    def test_owner_rejects_hosted_or_arbitrary_targets(self):
        self.assertEqual(m.owner(PROJECT),PROJECT)
        for value in ('piidsfebjqjmnepdpnas','main','gridex-native-100-1','../'+PROJECT,
                      PROJECT+'\n','postgresql://localhost/postgres'):
            with self.assertRaises(ValueError):m.owner(value)

    def test_config_is_local_and_ports_are_distinct(self):
        text=m.config(PROJECT,25432,25433,TEMPLATE)
        self.assertIn('major_version = 17',text)
        self.assertNotIn('project-ref',text)
        for ports in [(5432,5432),(True,5432),(1,5432),(5432,65536)]:
            with self.assertRaises(ValueError):m.config(PROJECT,*ports,TEMPLATE)

    def test_real_workflow_ids_never_trigger_supabase_project_name_truncation(self):
        value=m.project_name('34822996630','1','0123456789abcdef')
        self.assertEqual(value,PROJECT)
        self.assertLessEqual(len(value),40)
        self.assertLessEqual(len(m.project_name('9'*40,'9'*20,'f'*16)),40)
        self.assertNotEqual(value,m.project_name('34822996630','2','0123456789abcdef'))
        with self.assertRaises(ValueError):m.owner('gridex-native-34822996630-1-0123456789abcdef')
        for run,attempt,nonce in [('main','1','0'*16),('100','../','0'*16),('100','1','xyz')]:
            with self.assertRaises(ValueError):m.project_name(run,attempt,nonce)

    def test_config_preserves_upstream_auth_storage_and_other_defaults(self):
        before=tomllib.loads(TEMPLATE)
        after=tomllib.loads(m.config(PROJECT,25432,25433,TEMPLATE))
        before['project_id']=PROJECT
        before['db']['port']=25432;before['db']['shadow_port']=25433
        for section in ('api','analytics'):before[section]['enabled']=False
        before['db']['seed']['enabled']=False
        self.assertEqual(before,after)
        for text in [TEMPLATE.replace('shadow_port = 54320',''),
                     TEMPLATE.replace('major_version = 17','major_version = 15'),
                     TEMPLATE+'\n[remotes.production]\nproject_id = "piidsfebjqjmnepdpnas"\n']:
            with self.assertRaises(ValueError):m.config(PROJECT,25432,25433,text)

    def test_command_diagnostics_use_only_closed_markers_not_untrusted_values(self):
        raw=b'failed to connect to postgres postgres://u:private@private.example/db SQLSTATE 08006'
        value=m.command_signals(raw,b'private-raw-diagnostic@example.invalid')
        self.assertIn('POSTGRES_CONNECTION_FAILED',value)
        self.assertNotIn('private',json.dumps(value))
        self.assertEqual(m.command_signals(b'unclassified private value',b''),[])

    def test_database_requires_exact_owner_network_and_official_pg17_image(self):
        data=[{'Name':'/supabase_db_'+PROJECT,
               'Config':{'Image':'public.ecr.aws/supabase/postgres:17.6.1.test',
                         'Labels':{'com.supabase.cli.project':PROJECT}},
               'NetworkSettings':{'Networks':{PROJECT+'-network':{}}}}]
        m.check_container(data,PROJECT,PROJECT+'-network')
        for field,value in [('name','someone-else'),('owner','main'),('network','bridge'),
                            ('image','untrusted/postgres:17.6')]:
            bad=copy.deepcopy(data)
            if field=='name':bad[0]['Name']=value
            if field=='owner':bad[0]['Config']['Labels']['com.supabase.cli.project']=value
            if field=='network':bad[0]['NetworkSettings']['Networks']={value:{}}
            if field=='image':bad[0]['Config']['Image']=value
            with self.assertRaises(ValueError):m.check_container(bad,PROJECT,PROJECT+'-network')

    def test_actual_statement_ledger_required_not_name_only_markers(self):
        m.verify_ledger(ledger(),FILE)
        for statements in [[],['SELECT 1'],ledger()['ledger'][0]['statements'][:-1],
                           list(reversed(ledger()['ledger'][0]['statements']))]:
            bad=ledger();bad['ledger'][0]['statements']=statements
            with self.assertRaises(ValueError):m.verify_ledger(bad,FILE)
        for key,value in [('probeRows',True),('probeRows',2),('probeRls',False),
                          ('failedColumnExists',True)]:
            bad=ledger();bad[key]=value
            with self.assertRaises(ValueError):m.verify_ledger(bad,FILE)

    def test_unknown_duplicate_or_missing_ledger_entries_are_rejected(self):
        for entries in [[],ledger()['ledger']*2,[{**ledger()['ledger'][0],'version':'19990101000000'}]]:
            bad=ledger();bad['ledger']=entries
            with self.assertRaises(ValueError):m.verify_ledger(bad,FILE)

    def test_cli_arguments_cannot_select_external_targets(self):
        with patch.object(m.sys,'argv',['script','--linked']), patch.object(m.shutil,'which') as which:
            with self.assertRaisesRegex(ValueError,'DEDICATED_NATIVE_CI_REQUIRED'):m.run()
        which.assert_not_called()

    def execute_fixture(self, fail_stage=None):
        calls=[];created=False;stopped=False;network_removed=False;work=None;migrations=0
        in_network=[]
        def fake(args,**kwargs):
            nonlocal created,stopped,network_removed,work,migrations
            calls.append(args)
            if args[:2]==['docker','run']:
                self.assertIn(PROJECT+'-network',args)
                args=args[args.index('/fixture/supabase'):]
                in_network.append(args[3:])
            elif args[0]=='/fixture/supabase':
                self.assertTrue(args[1:]==['--version'] or args[3:]==['init'])
            output=b'';status=0
            if args[0]=='/fixture/supabase':
                if args[1:] == ['--version']:
                    output=m.VERSION.encode()
                else:
                    work=Path(args[2]); sub=args[3:]
                    if sub==['init']:
                        (work/'supabase').mkdir();(work/'supabase/config.toml').write_text(TEMPLATE)
                    elif 'start' in sub:
                        created=True
                        if fail_stage=='start':status=1
                    elif sub[:2]==['migration','new']:
                        migrations+=1
                        name=(FILE if migrations==1 else '20260914000001_native_rollback_proof.sql')
                        (work/'supabase/migrations'/name).write_text('')
                    elif sub[:2]==['migration','up']:
                        if migrations==2:status=1
                    elif sub[0]=='stop':
                        if fail_stage=='cleanup':status=1
                        else:stopped=True
            elif args[:3]==['docker','container','ls']:
                self.assertIn('-a',args)  # stopped leftovers must also be found
                if created and not stopped:output=b'container-id'
            elif args[:3]==['docker','network','create']:
                output=b'network-id'
            elif args[:3]==['docker','network','ls']:
                output=b'' if network_removed else b'network-id'
            elif args[:3]==['docker','network','rm']:
                network_removed=True
            elif args[:3]==['docker','network','inspect']:
                output=json.dumps([{'Labels':{'gridex.native.owner':PROJECT},'Internal':True}]).encode()
            elif args[:2]==['docker','inspect']:
                output=json.dumps([{'Name':'/supabase_db_'+PROJECT,'Image':'sha256:fixture',
                    'Config':{'Image':'public.ecr.aws/supabase/postgres:17.6.1.test',
                              'Labels':{'com.supabase.cli.project':PROJECT}},
                    'NetworkSettings':{'Networks':{PROJECT+'-network':{}}}}]).encode()
            elif args[:2]==['docker','exec']:
                data=kwargs['data'] if 'data' in kwargs else kwargs['input']
                if data==m.METADATA.encode():output=json.dumps({'serverVersion':'17.6','currentRole':'postgres','defaultPrivileges':[]}).encode()
                else:output=json.dumps(ledger()).encode()
            return subprocess.CompletedProcess(args,status,output,b'private-raw-diagnostic@example.invalid')
        def bootstrap(*args):
            if fail_stage == 'bootstrap':
                raise ValueError('private-bootstrap-failure@example.invalid')
            return {'nativeDefaultGrantsMatched':True}
        with tempfile.TemporaryDirectory() as directory, patch.object(m,'ROOT',Path(directory)), \
             patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_RUN_ID':'34822996630','GITHUB_RUN_ATTEMPT':'1'}), \
             patch.object(m.secrets,'token_hex',return_value='0123456789abcdef'), \
             patch.object(m.shutil,'which',return_value='/fixture/supabase'), \
             patch.object(m.sys,'argv',['script']), patch.object(m.subprocess,'run',side_effect=fake), \
             patch.object(m,'load_transport',return_value=SimpleNamespace(cli_command=lambda cli,w,p,a:['docker','run','--network',p+'-network',cli,'--workdir',str(w),*a])), \
             patch.object(m,'load_bootstrap',return_value=SimpleNamespace(verify=bootstrap)), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            status=m.run()
            report=json.loads((Path(directory)/'artifacts/native-supabase-lifecycle.json').read_text())
            self.assertNotIn('private-raw-diagnostic',output.getvalue()+json.dumps(report))
            self.assertFalse(work.exists())
        if fail_stage == 'bootstrap':
            self.assertEqual(migrations, 0)
        self.assertFalse(any('--all' in args or '--linked' in args or '--db-url' in args for args in calls))
        self.assertTrue(any('stop' in args and PROJECT in args for args in calls))
        self.assertTrue(in_network)
        return status,report

    def test_real_ledger_path_and_exact_cleanup_are_exercised(self):
        status,report=self.execute_fixture()
        self.assertEqual(status,0)
        self.assertTrue(report['nativeLedgerVerified'])
        self.assertTrue(report['failedMigrationRolledBack'])
        self.assertTrue(report['privateWorkspaceRemoved'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertFalse(report['productionModified'])

    def test_failed_start_is_cleaned_but_not_reported_as_success(self):
        status,report=self.execute_fixture('start')
        self.assertEqual(status,1)
        self.assertTrue(report['cleanupVerified'])
        self.assertNotIn('nativeLedgerVerified',report)

    def test_bootstrap_mismatch_stops_before_migrations_and_still_cleans(self):
        status, report = self.execute_fixture('bootstrap')
        self.assertEqual(status, 1)
        self.assertEqual(report['phase'], 'PORTABLE_BOOTSTRAP_AUTHORIZATION')
        self.assertTrue(report['cleanupVerified'])
        self.assertNotIn('nativeLedgerVerified', report)
        self.assertNotIn('private-bootstrap-failure', json.dumps(report))

    def test_failed_cleanup_cannot_be_accepted(self):
        status,report=self.execute_fixture('cleanup')
        self.assertEqual(status,1)
        self.assertFalse(report['cleanupVerified'])
        self.assertEqual(report['outcome'],'BLOCKED')


class CliNetworkTests(unittest.TestCase):
    def test_transport_uses_internal_dns_port_and_only_the_synthetic_workspace(self):
        transport=m.load_transport()
        original=Path.stat
        def stat_fixture(path,**kwargs):
            if str(path)=='/var/run/docker.sock':
                return SimpleNamespace(st_mode=stat.S_IFSOCK|0o660,st_gid=123)
            return original(path,**kwargs)
        with tempfile.TemporaryDirectory() as temp, patch.object(Path,'stat',stat_fixture):
            base=Path(temp);work=base/(PROJECT+'-private');work.mkdir(mode=0o700)
            cli=base/'supabase';cli.write_text('fixture')
            backend=base/'supabase-go';backend.write_text('fixture')
            args=transport.cli_command(cli,work,PROJECT,('migration','up','--local'))
            self.assertIn('--rm',args)
            self.assertIn('--read-only',args)
            self.assertIn('--cap-drop=ALL',args)
            self.assertIn('SUPABASE_SERVICES_HOSTNAME=supabase_db_'+PROJECT,args)
            self.assertEqual(args[args.index('--network')+1],PROJECT+'-network')
            self.assertEqual(args[-3:],['migration','up','--local'])
            self.assertNotIn('--publish',args)
            self.assertNotIn('--privileged',args)
            self.assertNotIn(str(ROOT),str(args))
            self.assertNotIn('GH_TOKEN',str(args))
            for command in [('migration','up','--linked'),('db','push'),('stop','--all'),
                            ('--network-id','bridge','db','start')]:
                with self.assertRaisesRegex(ValueError,'FIXED_NATIVE_CLI_COMMAND_REQUIRED'):
                    transport.cli_command(cli,work,PROJECT,command)
            for ordinal in (1,2):
                name=f'gridex_native_forward_{ordinal:02d}_'+'a'*12
                result=transport.cli_command(cli,work,PROJECT,('migration','new',name))
                self.assertEqual(result[-3:],['migration','new',name])
            for name in ('gridex_native_forward_03_'+'a'*12,'gridex_native_forward_1_'+'a'*12,
                         'gridex_native_forward_01_'+'a'*11,'gridex_native_forward_01_'+'a'*13):
                with self.assertRaisesRegex(ValueError,'FIXED_NATIVE_CLI_COMMAND_REQUIRED'):
                    transport.cli_command(cli,work,PROJECT,('migration','new',name))
            backend.unlink()
            with self.assertRaisesRegex(ValueError,'COMPLETE_OFFICIAL_CLI_BUNDLE_REQUIRED'):
                transport.cli_command(cli,work,PROJECT,('migration','up','--local'))

    def test_transport_does_not_admit_shared_or_foreign_workspaces(self):
        transport=m.load_transport()
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)
            with self.assertRaisesRegex(ValueError,'PRIVATE_NATIVE_WORKSPACE_REQUIRED'):
                transport.cli_command(directory/'supabase',directory,PROJECT,('migration','up','--local'))
            named=directory/(PROJECT+'-private');named.mkdir(mode=0o755)
            with self.assertRaisesRegex(ValueError,'PRIVATE_NATIVE_WORKSPACE_REQUIRED'):
                transport.cli_command(directory/'supabase',named,PROJECT,('migration','up','--local'))


if __name__=='__main__':unittest.main(verbosity=2)
