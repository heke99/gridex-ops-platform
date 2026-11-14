"""Recover private helper bodies from repository SQL; never execute SQL or network IO."""
import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import subprocess


def sha(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def framed_rows(value):
    if isinstance(value, list):
        rows = value
    else:
        if isinstance(value, dict) and 'content' in value:
            value = json.loads(next(item['text'] for item in value['content'] if item.get('type') == 'text'))
        result = value['result']
        frame = re.search(r'<(untrusted-data-[A-Za-z0-9-]+)>\s*(\[.*\])\s*</\1>', result, re.S)
        if not frame:
            raise ValueError('Missing exact metadata data frame')
        rows = json.loads(frame[2])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('Expected data rows')
    return rows


def metadata_from_wrapper(value):
    rows = framed_rows(value)
    for row in rows:
        if not re.fullmatch(r'[a-z_][a-z0-9_]*', row['proname']) or not re.fullmatch(r'[a-f0-9]{64}', row['body_sha256']):
            raise ValueError('Invalid helper metadata')
    return rows


def scan_embedded_secrets(text):
    patterns = [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', r'AKIA[0-9A-Z]{16}', r'(?:sk_live_|sk_test_)[A-Za-z0-9]{16,}', r'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}', r'postgres(?:ql)?://[^\s\x27]+:[^\s\x27]+@']
    if any(re.search(pattern, text) for pattern in patterns):
        raise ValueError('Offline embedded-secret scan blocked captured definition')


CREATE = re.compile(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?(?:public|private)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s*\(', re.I)


def candidates(text):
    """Yield byte-preserved dollar bodies and repository migration JSON patches."""
    for match in CREATE.finditer(text):
        # Do not allow AS search to wander into a later CREATE statement.
        next_create = CREATE.search(text, match.end())
        boundary = next_create.start() if next_create else len(text)
        body_start = re.search(r'\bAS\s+(\$[A-Za-z_0-9]*\$)', text[match.end():boundary], re.I)
        if not body_start:
            continue
        start = match.end() + body_start.end()
        end = text.find(body_start[1], start)
        if end < 0:
            continue
        yield {'name': match[1], 'body': text[start:end], 'kind': 'dollar_function', 'offset': match.start()}
    if '"patched"' not in text and '"original"' not in text:
        return
    for match in re.finditer(r"'((?:[^']|'')*)'\s*::\s*jsonb", text, re.S):
        try:
            rows = json.loads(match[1].replace("''", "'"))
        except (ValueError, TypeError):
            continue
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('signature'), str):
                continue
            name = re.match(r'(?:public|private)\.([a-z_][a-z0-9_]*)\(', row['signature'])
            if name:
                for field in ('original', 'patched'):
                    if isinstance(row.get(field), str):
                        yield {'name': name[1], 'body': row[field], 'kind': 'json_' + field, 'offset': match.start()}


def recover(rows, sources):
    matches = {}
    for source, text in sources:
        for candidate in candidates(text):
            for index, row in enumerate(rows):
                if candidate['name'] == row['proname'] and sha(candidate['body']) == row['body_sha256'] and index not in matches:
                    matches[index] = {**candidate, 'source': source, 'source_sha256': sha(text)}
    missing = [row['proname'] + '(' + row['arguments'] + ')' for index, row in enumerate(rows) if index not in matches]
    if missing:
        raise ValueError('Unmatched exact bodies: ' + ', '.join(missing))
    return [matches[index] for index in range(len(rows))]


def render(rows, matches):
    output = ['-- Repository-derived exact private helper bodies; no SQL has been executed.\nCREATE SCHEMA IF NOT EXISTS private;\n']
    for row, match in zip(rows, matches):
        if row['language'] not in ('sql', 'plpgsql') or row.get('prokind') != 'f':
            raise ValueError('Unsupported language or function kind')
        volatility = {'v': 'VOLATILE', 's': 'STABLE', 'i': 'IMMUTABLE'}
        parallel = {'u': 'UNSAFE', 'r': 'RESTRICTED', 's': 'SAFE'}
        if row.get('provolatile') not in volatility or row.get('proparallel') not in parallel:
            raise ValueError('Unsupported function execution flags')
        for field in ('proisstrict', 'proleakproof', 'proretset', 'security_definer'):
            if type(row.get(field)) is not bool:
                raise ValueError('Invalid boolean function property')
        for field in ('procost', 'prorows'):
            if type(row.get(field)) not in (int, float) or not math.isfinite(row[field]) or row[field] < 0:
                raise ValueError('Invalid numeric function property')
        if row['procost'] <= 0 or (row['proretset'] and row['prorows'] <= 0) or (not row['proretset'] and row['prorows'] != 0):
            raise ValueError('Invalid cost/rows combination')
        delimiter = '$elklart_repo_body$'
        if delimiter in match['body']:
            raise ValueError('Body delimiter collision')
        statement = f"CREATE OR REPLACE FUNCTION private.{row['proname']}({row['declaration_arguments']})\nRETURNS {row['returns']}\nLANGUAGE {row['language']}\nSECURITY {'DEFINER' if row['security_definer'] else 'INVOKER'}\n"
        statement += volatility[row['provolatile']] + '\n'
        statement += ('STRICT' if row['proisstrict'] else 'CALLED ON NULL INPUT') + '\n'
        statement += 'PARALLEL ' + parallel[row['proparallel']] + '\n'
        statement += ('LEAKPROOF' if row['proleakproof'] else 'NOT LEAKPROOF') + '\n'
        statement += 'COST ' + str(row['procost']) + '\n'
        if row['proretset']:
            statement += 'ROWS ' + str(row['prorows']) + '\n'
        statement += 'AS ' + delimiter + match['body'] + delimiter + ';\n'
        output.append(statement)
        output.append(render_config(row))
    return '\n'.join(output)


def identifier(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        raise ValueError('Invalid SQL identifier')
    return '"' + value.replace('"', '""') + '"'


def sql_literal(value):
    if not isinstance(value, str) or '\x00' in value:
        raise ValueError('Invalid SQL literal')
    return "E'" + value.replace('\\', '\\\\').replace("'", "''") + "'"


def render_config(row):
    """Transfer captured GUC strings through PostgreSQL, not SQL list quoting.

    SET search_path TO 'a,b' can quote one schema rather than two. set_config
    consumes the original GUC string; FROM CURRENT captures that exact setting.
    Local changes and explicit restoration preserve the caller's session state.
    """
    output = []
    seen = set()
    for setting in row.get('proconfig') or []:
        key, value = setting.split('=', 1)
        if key not in ('search_path', 'row_security', 'statement_timeout', 'lock_timeout') or key in seen:
            raise ValueError('Unsupported or duplicate configuration name')
        seen.add(key)
        target = f"private.{identifier(row['proname'])}({row['arguments']})"
        tag = '$elklart_guc_' + sha(target + setting)[:16] + '$'
        block = f"""DECLARE previous_value text;
BEGIN
 previous_value := pg_catalog.current_setting({sql_literal(key)});
 PERFORM pg_catalog.set_config({sql_literal(key)}, {sql_literal(value)}, true);
 ALTER FUNCTION {target} SET {identifier(key)} FROM CURRENT;
 PERFORM pg_catalog.set_config({sql_literal(key)}, previous_value, true);
EXCEPTION WHEN OTHERS THEN
 IF previous_value IS NOT NULL THEN
  PERFORM pg_catalog.set_config({sql_literal(key)}, previous_value, true);
 END IF;
 RAISE;
END;"""
        if tag in block:
            raise ValueError('Configuration delimiter collision')
        output.append('DO ' + tag + '\n' + block + '\n' + tag + ';\n')
    return '\n'.join(output)


def render_acl(rows, acl):
    schema = acl['schema']
    if schema['name'] != 'private':
        raise ValueError('Only private schema ACL is supported')
    expected = {(row['proname'], row['arguments']): row for row in rows}
    actual = {(item['name'], item['arguments']) for item in acl['functions']}
    if actual != set(expected) or len(actual) != len(acl['functions']):
        raise ValueError('Private function ACL inventory mismatch')
    output = ['-- Exact captured private owners and ACLs; scoped to these objects only.']
    objects = [('SCHEMA private', schema, {'USAGE', 'CREATE'})]
    for item in acl['functions']:
        row = expected[(item['name'], item['arguments'])]
        objects.append((f"FUNCTION private.{identifier(item['name'])}({item['arguments']})", {**item, 'owner': row['owner']}, {'EXECUTE'}))
    for target, item, allowed in objects:
        output.append(f"ALTER {target} OWNER TO {identifier(item['owner'])};")
        grantees = {'PUBLIC', 'anon', 'authenticated', 'service_role', item['owner']}
        for grant in item['grants']:
            if grant['privilege'] not in allowed or type(grant['grantable']) is not bool:
                raise ValueError('Unsupported private ACL grant')
            grantees.add(grant['grantee'])
        for grantee in sorted(grantees):
            role = 'PUBLIC' if grantee == 'PUBLIC' else identifier(grantee)
            output.append(f'REVOKE ALL PRIVILEGES ON {target} FROM {role};')
        output.append(f'REVOKE ALL PRIVILEGES ON {target} FROM CURRENT_USER;')
        for grant in item['grants']:
            role = 'PUBLIC' if grant['grantee'] == 'PUBLIC' else identifier(grant['grantee'])
            output.append(f"GRANT {grant['privilege']} ON {target} TO {role}" + (' WITH GRANT OPTION' if grant['grantable'] else '') + ';')
    return '\n'.join(output) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--history-ref', action='append', default=[])
    parser.add_argument('--captured-definitions')
    parser.add_argument('--acl', required=True)
    args = parser.parse_args()
    repo = pathlib.Path(args.repo).resolve()
    rows = metadata_from_wrapper(json.loads(pathlib.Path(args.metadata).read_bytes()))
    sources = []
    for path in subprocess.check_output(['git', 'ls-files', '*.sql'], cwd=repo, text=True).splitlines():
        sources.append((path, (repo / path).read_bytes().decode('utf-8')))
    for ref in args.history_ref:
        for path in subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', ref], cwd=repo, text=True).splitlines():
            if path.endswith('.sql'):
                sources.append((ref + ':' + path, subprocess.check_output(['git', 'show', ref + ':' + path], cwd=repo).decode('utf-8')))
    if args.captured_definitions:
        capture = pathlib.Path(args.captured_definitions)
        for row in framed_rows(json.loads(capture.read_bytes())):
            definition = row['definition']
            scan_embedded_secrets(definition)
            target = [item for item in rows if item['proname'] == row['proname'] and item['arguments'] == row['arguments']]
            bodies = list(candidates(definition))
            if len(target) != 1 or len(bodies) != 1 or sha(bodies[0]['body']) != target[0]['body_sha256'] or row.get('body_sha256', target[0]['body_sha256']) != target[0]['body_sha256']:
                raise ValueError('Captured definition hash or identity mismatch')
            sources.append(('captured-definition:' + str(capture) + '#' + row['proname'], definition))
    matches = recover(rows, sources)  # No output until every requested helper matches.
    destination = pathlib.Path(args.output)
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    acl_path = pathlib.Path(args.acl)
    acl_rows = framed_rows(json.loads(acl_path.read_bytes()))
    if len(acl_rows) != 1:
        raise ValueError('Expected one private ACL capture')
    sql = render(rows, matches) + '\n' + render_acl(rows, acl_rows[0]['private_acl'])
    sql_path = destination / 'private-repo-derived-helpers-v3.sql'
    with open(os.open(sql_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb') as handle:
        handle.write(sql.encode('utf-8'))
    sql_path.chmod(0o600)
    provenance = [{'name': row['proname'], 'arguments': row['arguments'], 'body_sha256': row['body_sha256'], 'owner_metadata': row['owner'], 'proconfig': row.get('proconfig'), 'properties': row, **{key: match[key] for key in ('source', 'source_sha256', 'kind', 'offset')}} for row, match in zip(rows, matches)]
    provenance = {'format': 'elklart_private_helpers_v3', 'guc_encoding': 'set_config_from_current_v1', 'sql_sha256': sha(sql), 'postgres_qualified': False, 'metadata_sha256': hashlib.sha256(pathlib.Path(args.metadata).read_bytes()).hexdigest(), 'acl_source': str(acl_path), 'acl_source_sha256': hashlib.sha256(acl_path.read_bytes()).hexdigest(), 'functions': provenance}
    provenance_path = destination / 'private-repo-derived-helpers-v3.provenance.json'
    with open(os.open(provenance_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as handle:
        handle.write(json.dumps(provenance, indent=2) + '\n')
    provenance_path.chmod(0o600)
    print(json.dumps({'matched': len(matches), 'sql_sha256': sha(sql)}))


if __name__ == '__main__':
    main()
