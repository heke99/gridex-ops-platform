#!/usr/bin/env python3
"""Finite maintenance transport controls; actual PostgreSQL remains a CI gate."""
import contextlib
import copy
import io
import json
import subprocess
import unittest
from unittest.mock import Mock, patch

import canonical_native_clone_quiesce as q
import canonical_native_timestamp_proof as p

DESTINATION = p.CLONES[-1]


class Maintenance:
    def __init__(self):
        self.state = dict(database=dict(oid=5,datname='postgres',datdba=10,
                         datallowconn=True,datistemplate=False,datacl=['private ACL']),
                         owner='postgres',settings=[],backendCounts=dict(client=2,background=1))
        self.calls = []
        self.clone_oid = None
        self.fail = None
        self.after_pause_failure = False
        self.create_error = False
        self.changed_snapshot = False
        self.changed_ledger = False
        self.changed_metadata = False
        self.foreign_restore = False

    def run(self, args, **options):
        if 'createdb' in args:
            operation = 'create'
            assert self.state['database']['datallowconn'] is False
            assert options['allow_failure'] is True
            self.calls.append((operation,args,options))
            if self.create_error:
                return subprocess.CompletedProcess(args,1,b'',b'private create error')
            self.clone_oid = '42'
            if self.changed_metadata:
                self.state['database']['datacl'] = ['changed private ACL']
            return subprocess.CompletedProcess(args,0,b'',b'')
        operation = options['data'].decode().splitlines()[0].split(':')[1]
        self.calls.append((operation,args,options))
        if operation == 'pause':
            self.state['database']['datallowconn'] = False
            if self.after_pause_failure:
                raise subprocess.TimeoutExpired('private command',120)
        if operation == 'restore':
            if self.foreign_restore:
                return subprocess.CompletedProcess(args,3,b'',b'private foreign ownership')
            self.state['database']['datallowconn'] = True
        if operation == self.fail:
            return subprocess.CompletedProcess(args,3,b'private stdout',b'private SQL error')
        value = copy.deepcopy(self.state) if operation == 'inspect' else True
        return subprocess.CompletedProcess(args,0,json.dumps(value).encode(),b'')

    def target(self):
        target = object.__new__(p.NativeTimestampTarget)
        target.name = 'supabase_db_gridex-sb-'+'a'*12+'-'+'b'*16
        target._owned = {}
        target._run = self.run
        target.assert_native_owned = Mock(return_value=True)
        target._oid = Mock(side_effect=lambda name:self.clone_oid)
        target.snapshot = Mock(side_effect=lambda:'changed' if self.changed_snapshot and self.clone_oid else 'same')
        target.sql = Mock(side_effect=lambda *args:'changed' if self.changed_ledger and self.clone_oid else 'ledger')
        return target


class QuiesceTests(unittest.TestCase):
    def invoke(self, fixture, target=None):
        target = target or fixture.target()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result = q.create_from_postgres(target,DESTINATION)
        return target,result,output.getvalue()

    def test_fixed_transport_pauses_drains_restores_before_clone_acceptance(self):
        fixture = Maintenance()
        target,result,output = self.invoke(fixture)
        self.assertEqual(result.returncode,0)
        self.assertEqual([c[0] for c in fixture.calls],['inspect','pause','drain','create','restore','inspect'])
        self.assertIs(fixture.state['database']['datallowconn'],True)
        self.assertEqual(target._owned,{DESTINATION:'42'})
        self.assertEqual(json.loads(output)['backendCounts'],dict(client=2,background=1,autovacuum=0,replication=0,other=0))
        self.assertNotIn('private',output)
        for operation,args,options in fixture.calls:
            if operation == 'create':
                self.assertEqual(args,['docker','exec',target.name,'createdb','-U','postgres',
                                       '--maintenance-db=template1','-T','postgres',DESTINATION])
                continue
            self.assertEqual(args[args.index('-d')+1],'template1')
            self.assertEqual(args[args.index('-U')+1],'supabase_admin')
            self.assertIn('--single-transaction',args)
            self.assertIn(q.GUARD.encode(),options['data'])
            if operation != 'inspect':
                self.assertIn(b"datname='postgres' AND oid=5::oid",options['data'])
                self.assertIn(b"pg_get_userbyid(datdba)='postgres'",options['data'])
        drain = next(c[2]['data'] for c in fixture.calls if c[0]=='drain')
        self.assertIn(b'pg_terminate_backend(backend.pid,1000)',drain)
        self.assertIn(b'datid=5::oid)>64',drain)

    def test_foreign_container_preexisting_clone_or_source_never_pauses(self):
        fixture=Maintenance();target=fixture.target()
        target.assert_native_owned.side_effect=ValueError('NATIVE_TIMESTAMP_NETWORK_REQUIRED')
        with self.assertRaisesRegex(ValueError,'NETWORK_REQUIRED'):self.invoke(fixture,target)
        self.assertEqual(fixture.calls,[])
        fixture=Maintenance();fixture.clone_oid='foreign'
        with self.assertRaisesRegex(ValueError,'PREEXISTING_CLONE'):self.invoke(fixture)
        self.assertEqual(fixture.calls,[])
        for field,value in [('owner','foreign'),('backendCounts',{'client':65})]:
            fixture=Maintenance();fixture.state[field]=value
            with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):self.invoke(fixture)
            self.assertEqual([c[0] for c in fixture.calls],['inspect'])
        for field,value in [('datallowconn',False),('datname','foreign'),('datistemplate',True)]:
            fixture=Maintenance();fixture.state['database'][field]=value
            with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):self.invoke(fixture)
            self.assertEqual([c[0] for c in fixture.calls],['inspect'])

    def test_pause_timeout_and_drain_failure_always_attempt_restoration(self):
        for timeout in (False,True):
            fixture=Maintenance();fixture.after_pause_failure=timeout
            fixture.fail=None if timeout else 'drain'
            with self.assertRaises((ValueError,subprocess.TimeoutExpired)):self.invoke(fixture)
            self.assertIs(fixture.state['database']['datallowconn'],True)
            self.assertNotIn('create',[c[0] for c in fixture.calls])
            self.assertIn('restore',[c[0] for c in fixture.calls])

    def test_failed_create_remains_failed_after_source_is_restored(self):
        fixture=Maintenance();fixture.create_error=True
        target,result,_=self.invoke(fixture)
        self.assertEqual(result.returncode,1)
        self.assertIs(fixture.state['database']['datallowconn'],True)
        self.assertEqual(target._owned,{})

    def test_restore_failure_or_changed_source_cannot_return_success(self):
        for field in ('foreign_restore','changed_metadata','changed_snapshot','changed_ledger'):
            fixture=Maintenance();setattr(fixture,field,True);target=fixture.target()
            with self.assertRaisesRegex(ValueError,'RESTORE_REQUIRED|PRESERVATION_REQUIRED'):
                self.invoke(fixture,target)
            if field not in ('foreign_restore','changed_metadata'):
                self.assertIs(fixture.state['database']['datallowconn'],True)
                self.assertEqual(target._owned,{DESTINATION:'42'})

    def test_admin_errors_never_export_sql_or_accept_arbitrary_operations(self):
        fixture=Maintenance();fixture.fail='inspect'
        with self.assertRaises(ValueError) as error:self.invoke(fixture)
        self.assertEqual(str(error.exception),'NATIVE_CLONE_QUIESCE_INSPECT_REQUIRED')
        for operation in ('terminate other database','ALTER ROLE','create',''):
            with self.assertRaisesRegex(ValueError,'OPERATION_REQUIRED'):
                q._admin(fixture.target(),operation)
        with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):
            q._admin(fixture.target(),'pause',oid='5; SELECT 1')
        with self.assertRaisesRegex(ValueError,'OWNER_REQUIRED'):
            q.create_from_postgres(object(),DESTINATION)


if __name__ == '__main__':unittest.main()
