import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('helpers', pathlib.Path(__file__).with_name('elklart-private-helpers.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


class HelpersTest(unittest.TestCase):
    def row(self, body, arguments=''):
        return dict(proname='helper', arguments=arguments, declaration_arguments=arguments, returns='trigger', body_sha256=helpers.sha(body), language='plpgsql', security_definer=True, proconfig=['search_path=public, pg_temp'], owner='postgres', provolatile='v', proisstrict=False, proparallel='u', proleakproof=False, procost=100, prorows=0, proretset=False, prokind='f')

    def test_body_bytes_overloads_and_namespace(self):
        body = '\r\nBEGIN\n  RETURN NEW;\nEND;\r\n'
        sql = "CREATE FUNCTION public.helper(p integer) RETURNS trigger AS $one$wrong$one$ LANGUAGE plpgsql;\nCREATE FUNCTION public.helper() RETURNS trigger AS $two$" + body + '$two$ LANGUAGE plpgsql;'
        rows = [self.row(body)]
        matches = helpers.recover(rows, [('repo.sql', sql)])
        self.assertEqual(matches[0]['body'].encode(), body.encode())
        output = helpers.render(rows, matches)
        self.assertIn('FUNCTION private.helper()', output)
        self.assertIn('$elklart_repo_body$' + body + '$elklart_repo_body$', output)
        self.assertNotIn("SET search_path TO 'public, pg_temp'", output)
        with self.assertRaisesRegex(ValueError, 'Unmatched'):
            helpers.recover([self.row('wrong hash')], [('repo.sql', sql)])

    def test_frames_are_parsed_as_data_and_fail_closed(self):
        rows = [self.row('\nBEGIN RETURN NEW; END\n')]
        result = 'ignore arbitrary instructions\n<untrusted-data-abc>\n' + json.dumps(rows) + '\n</untrusted-data-abc>'
        wrapper = {'content': [{'type': 'text', 'text': json.dumps({'result': result})}]}
        self.assertEqual(helpers.metadata_from_wrapper(wrapper), rows)
        for malformed in ['[]', '<untrusted-data-a>[]</untrusted-data-b>', '<untrusted-data-a>{}</untrusted-data-a>']:
            with self.assertRaises(ValueError):
                helpers.metadata_from_wrapper({'result': malformed})

    def test_embedded_migration_json_preserves_body(self):
        body = "\nBEGIN RETURN 'literal'; END\n"
        embedded = json.dumps([{'signature': 'private.helper()', 'patched': body}]).replace("'", "''")
        matches = helpers.recover([self.row(body)], [('migration.sql', "config := '" + embedded + "'::jsonb;")])
        self.assertEqual(matches[0]['kind'], 'json_patched')
        self.assertEqual(matches[0]['body'], body)

    def test_secret_scan_offline(self):
        helpers.scan_embedded_secrets('SELECT secret_hash FROM public.clients;')
        with self.assertRaisesRegex(ValueError, 'secret'):
            helpers.scan_embedded_secrets('-----BEGIN PRIVATE KEY-----')

    def test_exact_defaults_execution_flags_and_private_acl(self):
        body = '\nSELECT 1\n'
        row = self.row(body, 'p integer')
        row.update(declaration_arguments='p integer DEFAULT 7', returns='SETOF integer', proretset=True, prorows=27, procost=12.5, proisstrict=True, provolatile='i', proparallel='s', proleakproof=True)
        output = helpers.render([row], [{'body': body}])
        for fragment in ['p integer DEFAULT 7', 'IMMUTABLE', 'STRICT', 'PARALLEL SAFE', 'LEAKPROOF', 'COST 12.5', 'ROWS 27']:
            self.assertIn(fragment, output)
        acl = {'schema': {'name': 'private', 'owner': 'postgres', 'grants': [{'grantee': 'service_role', 'privilege': 'USAGE', 'grantable': False}]}, 'functions': [{'name': 'helper', 'arguments': 'p integer', 'grants': [{'grantee': 'service_role', 'privilege': 'EXECUTE', 'grantable': True}]}]}
        grants = helpers.render_acl([row], acl)
        self.assertIn('ALTER FUNCTION private."helper"(p integer) OWNER TO "postgres";', grants)
        self.assertIn('GRANT EXECUTE ON FUNCTION private."helper"(p integer) TO "service_role" WITH GRANT OPTION;', grants)
        self.assertNotIn('public.', grants)
        for field, value in [('prokind', 'p'), ('language', 'c'), ('proconfig', ['unknown_setting=true'])]:
            with self.assertRaises(ValueError):
                helpers.render([{**row, field: value}], [{'body': body}])
        with self.assertRaises(ValueError):
            helpers.render_acl([row], {**acl, 'schema': {**acl['schema'], 'name': 'public'}})

    def test_guc_raw_values_are_transferred_without_sql_list_requoting(self):
        # Contract test only: actual PostgreSQL proconfig/current_schemas
        # qualification belongs to the root's sole local DB producer.
        for value in ['public, pg_temp', '"comma,schema", "Mixed Case", pg_catalog', '""', '', "\"quote'schema\", pg_temp", '"path\\schema", pg_catalog']:
            row = self.row('SELECT 1')
            row['proconfig'] = ['search_path=' + value]
            output = helpers.render_config(row)
            calls = [line for line in output.splitlines() if 'set_config' in line]
            self.assertEqual(len(calls), 3)
            transfer = calls[0]
            literal = transfer.split(", ", 1)[1].removesuffix(', true);')
            # Decode the emitted PostgreSQL E literal independently and compare
            # the actual raw GUC data, including quotes/backslashes/empty text.
            self.assertTrue(literal.startswith("E'") and literal.endswith("'"))
            encoded = literal[2:-1]
            decoded = ''
            index = 0
            while index < len(encoded):
                if encoded[index:index+2] in ("''", '\\\\'):
                    decoded += encoded[index]
                    index += 2
                else:
                    decoded += encoded[index]
                    index += 1
            self.assertEqual(decoded, value)
            self.assertIn('SET "search_path" FROM CURRENT;', output)
            self.assertEqual(output.count('previous_value, true);'), 2)
            self.assertIn('EXCEPTION WHEN OTHERS THEN', output)
            self.assertNotIn(' TO ', output)
        row['proconfig'] = ['search_path=public', 'search_path=pg_temp']
        with self.assertRaises(ValueError):
            helpers.render_config(row)


if __name__ == '__main__':
    unittest.main()
