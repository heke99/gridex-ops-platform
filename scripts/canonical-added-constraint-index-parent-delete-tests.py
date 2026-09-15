#!/usr/bin/env python3
"""Offline source/selection controls; no PostgreSQL execution claim."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('parent_delete', ROOT / 'scripts/canonical-added-constraint-index-parent-delete-selftest.py')
subject = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(subject)


class ParentDeleteSelectionTests(unittest.TestCase):
    def test_seventh_forward_predicate_requires_real_expected_database_answer(self):
        for expected in (False,True):
            with patch.object(subject.fixture,'sql',return_value='t' if expected else 'f'):
                subject.verify_forward_postcondition(expected)
            for wrong in ('','null','t' if not expected else 'f'):
                with patch.object(subject.fixture,'sql',return_value=wrong),self.assertRaisesRegex(
                        ValueError,'SEVENTH_FORWARD_POSTCONDITION_REQUIRED'):
                    subject.verify_forward_postcondition(expected)
    def test_reset_replays_source_configuration_before_comparing_final_function_rows(self):
        selected = subject.selection()
        calls = []
        source = (ROOT / 'supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql').read_text()
        exact = subject.fixture.exactly_one(r'-- Function search_path: every public function.*?\n(do \$\$.*?end \$\$;)', source)
        def sql(query):
            calls.append(query)
            if query.startswith('select jsonb_agg(jsonb_build_object(\'nspname\',n.nspname'):
                return json.dumps(selected['fks'])
            if query.startswith('select jsonb_object_agg(proname,md5'):
                return json.dumps(subject.FUNCTION_MD5 if exact in calls else {
                    'gridex_assert_company_operational_for_write':'87009076a9749a47238fb784e90355e7',
                    'gridex_audit_critical_row_change':'f19fc1247acd96f0f15f9284ebad6ef0'})
            if "'identity_arguments'" in query:
                return json.dumps(sorted(selected['functionRows'],key=lambda r:r['proname']))
            if "'tgname'" in query:
                return json.dumps(sorted(selected['triggers'],key=lambda r:(r['relname'],r['tgname'])))
            return ''
        with patch.object(subject.fixture,'sql',side_effect=sql):
            subject.reset(selected,False)
        self.assertEqual(calls.count(exact),1)
        self.assertLess(calls.index('\n'.join(selected['functions'])),calls.index(exact))

    def test_exact_coexisting_fk_set(self):
        selected = subject.selection()
        self.assertEqual(len(selected['fks']), 18)
        self.assertEqual({t: sum(r['relname'] == t for r in selected['fks']) for t in subject.TABLES},
                         dict(zip(subject.TABLES, (4, 5, 1, 4, 4))))
        self.assertEqual(len(selected['triggers']), 3)
        self.assertEqual(len(selected['functions']), 2)

    def test_real_trigger_source_is_retained(self):
        selected = subject.selection()
        functions = '\n'.join(selected['functions'])
        self.assertIn("if new.company_id is null then", functions)
        self.assertIn("v_new ->> 'paused_by'", functions)
        self.assertIn('old_values,', functions)
        self.assertNotIn('synthetic', functions)

    def test_final_key_nullability_is_table_specific(self):
        columns = subject.selection()['columns']
        self.assertEqual(len(columns), 10)
        self.assertEqual({r['relname'] for r in columns if r['attname'] == 'company_id' and r['is_nullable']},
                         {'customer_sync_events', 'data_quality_findings'})
        self.assertTrue(all(r['is_nullable'] for r in columns if r['attname'] == 'customer_id'))

    def test_repair_changes_only_delete_target(self):
        selected = subject.selection()
        changed = subject.repaired_rows(selected['fks'])
        self.assertEqual(sum(a != b for a, b in zip(selected['fks'], changed)), 5)
        for before, after in zip(selected['fks'], changed):
            if before != after:
                self.assertEqual({k: v for k, v in before.items() if k != 'definition'},
                                 {k: v for k, v in after.items() if k != 'definition'})
                self.assertTrue(after['definition'].endswith('ON UPDATE CASCADE ON DELETE SET NULL (customer_id)'))

    def test_both_coexisting_creation_orders(self):
        selected = subject.selection()
        for table in subject.TABLES:
            original = subject.ordered_fks(selected['fks'], table, False)
            reversed_order = subject.ordered_fks(selected['fks'], table, True)
            self.assertEqual(sorted(original), sorted(reversed_order))
            if table != 'customer_sync_events':
                simple = next(i for i, sql in enumerate(original) if table + '_customer_id_fkey ' in sql)
                composite = next(i for i, sql in enumerate(original) if table + '_customer_company_fk ' in sql)
                self.assertLess(simple, composite)
                self.assertIn(table + '_customer_company_fk ', reversed_order[0])

    def test_mutated_row_or_incomplete_set_rejected(self):
        selected = subject.selection()
        for mutation in ('missing', 'action', 'validation'):
            rows = copy.deepcopy(selected['fks'])
            if mutation == 'missing':
                rows.pop()
            elif mutation == 'action':
                rows[0]['definition'] += ' NOT VALID'
            else:
                rows[0]['convalidated'] = False
            with self.assertRaises(ValueError):
                subject.validate_fk_rows(rows)

    def test_exact_delta_rejects_unrelated_change(self):
        rows = subject.selection()['fks']
        before = {'data': ['keep'], 'catalog': {'constraints': [], 'triggers': []}}
        for i, row in enumerate(rows, 1):
            before['catalog']['constraints'].append([i, row['relname'], row['conname'], row['definition'], True, False, False, 'comment'])
            before['catalog']['triggers'].append([i + 100, 'trigger', 'O', i])
        after = copy.deepcopy(before)
        for row in after['catalog']['constraints']:
            if row[2].endswith('_customer_company_fk'):
                old_id = row[0]
                row[0] += 500
                row[3] = row[3].split(' ON DELETE ')[0] + ' ON DELETE SET NULL (customer_id)'
                trigger = next(t for t in after['catalog']['triggers'] if t[3] == old_id)
                trigger[0] += 500
                trigger[3] = row[0]
        subject.verify_candidate_delta(before, after)
        for mutation in ('data', 'comment', 'unrelated_fk'):
            changed = copy.deepcopy(after)
            if mutation == 'data':
                changed['data'].append('unexpected')
            elif mutation == 'comment':
                changed['catalog']['constraints'][0][-1] = 'lost comment'
            else:
                changed['catalog']['constraints'][0][3] += ' NOT VALID'
            with self.assertRaises(ValueError):
                subject.verify_candidate_delta(before, changed)


if __name__ == '__main__':
    unittest.main()
