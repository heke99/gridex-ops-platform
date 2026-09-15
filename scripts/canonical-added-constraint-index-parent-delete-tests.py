#!/usr/bin/env python3
"""Offline source/selection controls; no PostgreSQL execution claim."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('parent_delete', ROOT / 'scripts/canonical-added-constraint-index-parent-delete-selftest.py')
subject = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(subject)


class ParentDeleteSelectionTests(unittest.TestCase):
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
