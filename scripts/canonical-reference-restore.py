#!/usr/bin/env python3
"""Restore the immutable reference with a current isolated PostgreSQL client.

Server and client have no external network or host-published ports. No source SQL
or pg_dump text is persisted in client/container logs. Only the two outer psql
restriction keys are changed, using fresh random values; all SQL remains exact.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_DB = 'gridex_auth_legacy_native'
CLIENT_IMAGE = 'postgres:17'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load(filename):
    path = ROOT/'scripts'/filename
    spec = importlib.util.spec_from_file_location('restore_'+filename.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def command(server_id, name):
    if not re.fullmatch(r'[a-f0-9]{64}', server_id) or not re.fullmatch(r'gridex-reference-client-[a-f0-9]{24}', name):
        raise ValueError('OWNED_RESTORE_CLIENT_REQUIRED')
    return ['docker','run','--rm','-i','--name',name,
            '--label','gridex.reference-client.owner='+name,
            '--network','container:'+server_id,'--read-only','--cap-drop=ALL',
            '--security-opt=no-new-privileges','--log-driver=none',
            '--user','postgres','--entrypoint','psql',CLIENT_IMAGE,
            '-X','-h','127.0.0.1','-U','postgres','-d',REFERENCE_DB,
            '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-qAt','-f','-']


def execute(target, raw, timeout=180):
    target.verify_logging()
    metadata = json.loads(target.docker(['inspect',target.name]))[0]
    if (not target.active or target.name != target._created_name or
        metadata['HostConfig']['NetworkMode'] != 'none' or
        metadata['Config'].get('Labels',{}).get('gridex.auth-legacy.owner') != target.name or
        metadata['HostConfig'].get('PortBindings') or metadata['Config']['Image'] != 'postgis/postgis:17-3.5'):
        raise ValueError('ISOLATED_REFERENCE_SERVER_REQUIRED')
    name = 'gridex-reference-client-'+secrets.token_hex(12)
    argv = command(metadata['Id'], name)
    env = load('canonical-auth-provisioning-replay.py').load_batch().clean_environment()
    try:
        return subprocess.run(argv,input=raw,capture_output=True,timeout=timeout,env=env)
    finally:
        # --rm normally disposes the client. A timed-out docker CLI process is
        # not proof of disposal: remove only the uniquely named and owned client.
        remaining = subprocess.run(['docker','container','ls','-aq','--filter','name=^/'+name+'$'],
                                   capture_output=True,timeout=30,env=env)
        if remaining.returncode:
            raise ValueError('RESTORE_CLIENT_DISPOSAL_UNVERIFIED')
        if remaining.stdout.strip():
            check = subprocess.run(['docker','inspect',name],capture_output=True,timeout=30,env=env)
            if check.returncode:
                raise ValueError('RESTORE_CLIENT_DISPOSAL_UNVERIFIED')
            owned = json.loads(check.stdout)[0]
            if (owned['Config'].get('Labels',{}).get('gridex.reference-client.owner') != name or
                owned['HostConfig']['NetworkMode'] != 'container:'+metadata['Id'] or
                owned['Config']['Image'] != CLIENT_IMAGE):
                raise ValueError('RESTORE_CLIENT_OWNERSHIP_MISMATCH')
            removed = subprocess.run(['docker','rm','--force','--volumes',owned['Id']],
                                     capture_output=True,timeout=30,env=env)
            if removed.returncode:
                raise ValueError('RESTORE_CLIENT_DISPOSAL_UNVERIFIED')


def rekey(data):
    process = subprocess.run(['node','-e',
        "const fs=require('node:fs');process.stdout.write(require('./scripts/gridex-schema-dump.cjs').prepareRestore(fs.readFileSync(0,'utf8')));"],
        input=data,capture_output=True,timeout=30,cwd=ROOT)
    if process.returncode:
        raise ValueError('RESTRICTED_RESTORE_PREPARATION_FAILED')
    return process.stdout


def restore_reference(target, raw):
    """Read an immutable dump through private stdin; never duplicate it on disk."""
    target.reset(REFERENCE_DB)
    bootstrap = (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
    target.sql(REFERENCE_DB, bootstrap, 'reference_platform', transaction=False)
    target.sql(REFERENCE_DB, 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;\nDROP SCHEMA public CASCADE;',
               'reference_spatial_prerequisite', transaction=False)
    target.verify_logging()
    # Native RED/GREEN control of the old invalid normalized key. This contains
    # no source definitions, operator literals, credentials or business data.
    old_probe = b'\\restrict gridex_canonical_schema_snapshot\nSELECT 1;\n\\unrestrict gridex_canonical_schema_snapshot\n'
    old = execute(target, old_probe)
    print(json.dumps({'stage':'restricted_client_probe','invalidKeyExitCode':old.returncode,
                      'invalidKeyOutputSha256':sha(old.stdout+old.stderr)}),flush=True)
    if old.returncode == 0:
        raise ValueError('INVALID_RESTRICT_KEY_REGRESSION_REQUIRED')
    good = execute(target, rekey(old_probe))
    print(json.dumps({'stage':'restricted_client_probe','validKeyExitCode':good.returncode,
                      'validKeyOutputSha256':sha(good.stdout+good.stderr)}),flush=True)
    if good.returncode or good.stdout.strip() != b'1':
        raise ValueError('NATIVE_RESTRICTED_CLIENT_REQUIRED')
    prepared = rekey(raw)
    if sum(a != b for a,b in zip(raw.splitlines(), prepared.splitlines())) != 2 or len(raw.splitlines()) != len(prepared.splitlines()):
        raise ValueError('EXACT_RESTRICT_KEY_ONLY_CHANGE_REQUIRED')
    print(json.dumps({'stage':'native_restricted_restore_control','invalidKeyRejected':True,
                      'freshKeyAccepted':True,'originalSnapshotSha256':sha(raw),
                      'preparedStreamSha256':sha(prepared),'changedGuardLines':2}), flush=True)
    result = execute(target, prepared)
    if result.returncode:
        safe = load('canonical-foundation-frontier-diagnostic.py').safe_error_identifiers(result.stderr)
        print(json.dumps({'stage': 'reference_restore', **safe}), flush=True)
        raise ValueError('INDEPENDENT_REFERENCE_RESTORE_FAILED')
    return load('canonical-full-schema-reference.py').capture(target, REFERENCE_DB)
