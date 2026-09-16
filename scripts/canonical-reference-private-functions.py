#!/usr/bin/env python3
"""Restore the public dump's exact private trigger dependencies, not placeholders.

The closed inventory contains the 14 directly bound private triggers and their
2 transitive private helpers. All declarations and explicit ACL statements are
read unchanged from checksum-verified historical migrations. This is only a
reference prerequisite; no original migration is marked applied or rewritten.
"""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'gridex_auth_legacy_native'
MANIFEST = 'scripts/canonical-reference-private-functions.json'
SCHEMA_BLOCK = 'create schema if not exists private;\nrevoke all on schema private from public, anon, authenticated, service_role;'
ROLES = ('anon', 'authenticated', 'service_role')


def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def source(name, expected):
    if not re.fullmatch(r'[A-Za-z0-9_]+\.sql', name):
        raise ValueError('PRIVATE_DEPENDENCY_NAME_REQUIRED')
    path = ROOT/'supabase/migrations'/name
    if path.is_symlink() or not path.is_file() or path.resolve() != path:
        raise ValueError('PRIVATE_DEPENDENCY_SOURCE_REQUIRED')
    digests = []
    for filename in ('migration-history-manifest.json', 'migration-history-manifest.additions.json',
                     'migration-history-manifest.runtime.additions.json'):
        files = json.loads((ROOT/'scripts'/filename).read_text())['files']
        if name in files:
            digests.append(files[name])
    raw = path.read_bytes()
    if not digests or set(digests) != {expected} or sha(raw) != expected:
        raise ValueError('PRIVATE_DEPENDENCY_SOURCE_HASH_MISMATCH')
    return raw.decode()


def extract(text, name):
    if not re.fullmatch(r'[a-z_][a-z_0-9]*', name):
        raise ValueError('PRIVATE_DEPENDENCY_FUNCTION_NAME_REQUIRED')
    matches = list(re.finditer(r'^create\s+(?:or\s+replace\s+)?function\s+private\.'+name+r'\s*\(', text, re.I|re.M))
    if len(matches) != 1:
        raise ValueError('EXACT_PRIVATE_DECLARATION_REQUIRED')
    first = matches[0]
    header = re.search(r'\bas\s+(\$[a-z_0-9]*\$)', text[first.end():], re.I)
    if header is None:
        raise ValueError('PRIVATE_DEPENDENCY_BODY_REQUIRED')
    start = first.end()+header.end(); tag = header[1]
    end = text.find(tag+';', start)
    if end < 0:
        raise ValueError('PRIVATE_DEPENDENCY_BODY_REQUIRED')
    declaration = text[first.start():end+len(tag)+1]
    body = text[start:end]
    acls = [hit[0] for hit in re.finditer(r'^(?:revoke|grant)\b[^;]*;', text, re.M|re.I)
            if re.search(r'\bon\s+function\s+private\.'+name+r'\s*\(', hit[0], re.I)]
    program = declaration+'\n'+('\n'.join(acls)+'\n' if acls else '')
    rights = {'public'}
    for acl in acls:
        match = re.search(r'\b(from|to)\s+([a-z_,\s]+);$', acl, re.I)
        if not match:
            raise ValueError('PRIVATE_DEPENDENCY_ACL_REQUIRED')
        roles = {r.strip().lower() for r in match[2].split(',')}
        if not roles <= {'public', 'postgres', *ROLES}:
            raise ValueError('PRIVATE_DEPENDENCY_ACL_ROLE_REQUIRED')
        if match[1].lower() == 'from': rights -= roles
        else: rights |= roles
    return program, body, {r: r in rights or 'public' in rights for r in ROLES}


def inputs():
    path = ROOT/MANIFEST
    if path.is_symlink() or not path.is_file() or path.resolve() != path:
        raise ValueError('PRIVATE_DEPENDENCY_MANIFEST_REQUIRED')
    manifest = json.loads(path.read_text())
    snapshot = ROOT/'supabase/schema.sql'
    if snapshot.is_symlink() or sha(snapshot.read_bytes()) != manifest['snapshotSha256']:
        raise ValueError('PRIVATE_DEPENDENCY_SNAPSHOT_REQUIRED')
    bound = sorted(set(re.findall(r'^CREATE TRIGGER[^\n]*EXECUTE FUNCTION private\.([a-z_0-9]+)\(', snapshot.read_text(), re.M)))
    if len(bound) != 14 or bound != manifest['triggerFunctions'] or len(manifest['functions']) != 16:
        raise ValueError('PRIVATE_DEPENDENCY_CLOSED_TRIGGER_SET_REQUIRED')
    schema = source(manifest['schemaSource'], manifest['schemaSourceSha256'])
    if schema.count(SCHEMA_BLOCK) != 1 or sha(SCHEMA_BLOCK) != manifest['schemaBlockSha256']:
        raise ValueError('PRIVATE_DEPENDENCY_SCHEMA_SOURCE_REQUIRED')
    programs = {}; expected = {}; direct = set(bound)
    for name, item in manifest['functions'].items():
        program, body, rights = extract(source(item['source'], item['sourceSha256']), name)
        if sha(program) != item['programSha256'] or hashlib.md5(body.encode()).hexdigest() != item['bodyMd5']:
            raise ValueError('PRIVATE_DEPENDENCY_PROGRAM_CHANGED')
        header = program[:program.lower().index('as $')]
        if bool(re.search(r'\bsecurity\s+definer\b', header, re.I)) != item['securityDefiner']:
            raise ValueError('PRIVATE_DEPENDENCY_SECURITY_MODE_CHANGED')
        programs[name] = program
        expected[name] = {'bodyMd5': item['bodyMd5'], 'securityDefiner': item['securityDefiner'], 'rights': rights}
    closure = set(direct)
    while True:
        if not closure <= set(programs):
            raise ValueError('PRIVATE_DEPENDENCY_MISSING_HELPER')
        next_set = closure | {name for current in closure for name in
                              re.findall(r'\bprivate\.([a-z_0-9]+)\s*\(', programs[current], re.I)}
        if closure == next_set: break
        closure = next_set
    if closure != set(programs):
        raise ValueError('PRIVATE_DEPENDENCY_UNRELATED_PROGRAM')
    return manifest, programs, expected


def prepare(target):
    manifest, programs, expected = inputs()
    sql = 'SET LOCAL check_function_bodies = off;\n'+SCHEMA_BLOCK+'\n'+'\n'.join(programs.values())
    target.sql(DATABASE, sql, 'reference_private_trigger_dependencies', transaction=True)
    return expected


def verify(target):
    manifest, programs, expected = inputs()
    raw = target.sql(DATABASE, """SELECT jsonb_build_object(
      'schemaRestricted', NOT has_schema_privilege('anon','private','USAGE')
        AND NOT has_schema_privilege('authenticated','private','USAGE')
        AND NOT has_schema_privilege('service_role','private','USAGE'),
      'functions', (SELECT jsonb_object_agg(p.proname,jsonb_build_object(
        'bodyMd5',md5(p.prosrc),'securityDefiner',p.prosecdef,'rights',jsonb_build_object(
          'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
          'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
          'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))))
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private'),
      'functionCount', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private')
    );""", 'reference_private_trigger_contract', transaction=True)
    actual = json.loads(raw)
    if actual != {'schemaRestricted': True, 'functions': expected, 'functionCount': len(expected)}:
        raise ValueError('PRIVATE_DEPENDENCY_NATIVE_CONTRACT_MISMATCH')
    return {'directPrivateTriggerFunctions': 14, 'privateDependencyClosure': 16,
            'exactBodiesAndPrivilegesVerified': True, 'placeholderUsed': False}
