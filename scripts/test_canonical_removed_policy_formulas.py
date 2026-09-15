"""Offline formula proofs; no database or duplicate actor/DML fixture."""
import copy
import json
from pathlib import Path
import unittest

import canonical_removed_policy_formulas as q


ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT / 'quality/audits/PR310_REMOVED_POLICY_DISPOSITIONS_2026-09-15.json'
A = '( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)'
W = 'gridex_can_write_company(company_id)'
R = 'gridex_can_read_company(company_id)'
S = "(( SELECT auth.role() AS role)) = 'service_role'::text"
G = ('( SELECT gridex_is_current_session_allowed() AS gridex_is_current_session_allowed)'
     ' AND (' + A + ' OR company_id IN '
     '( SELECT gridex_user_company_ids() AS gridex_user_company_ids))')


def policy(name, command, using='', check='', permissive=True):
    return dict(nspname='public', relname='customer_addresses', polname=name,
                command=command, permissive=permissive, roles=['authenticated'],
                using_expression=using, check_expression=check)


def writes():
    return [policy('tenant', 'w', A + ' OR ' + R, A + ' OR ' + W),
            policy('guard', 'w', W, W, False)]


class FormulaTests(unittest.TestCase):
    def test_actual_register_all_57_rows_and_two_explicit_nonproofs(self):
        receipt = q.prove_replacements(json.loads(REGISTER.read_text()))
        self.assertEqual(receipt['fullRowsProved'], 57)
        self.assertEqual(receipt['componentProofs'], 75)
        self.assertEqual(receipt['commandCounts'], {'r': 20, 'a': 18, 'w': 18, 'd': 1})
        self.assertEqual(receipt['aclOnlyRows'], 2)
        self.assertFalse(receipt['schemaAccepted'])
        self.assertFalse(receipt['liveCompositionProved'])

    def test_register_missing_extra_duplicate_mutated_and_boolean_confusion(self):
        original = json.loads(REGISTER.read_text())
        mutations = []
        for edit in ('missing', 'duplicate', 'changed', 'proof_flag', 'accepted'):
            r = copy.deepcopy(original)
            if edit == 'missing':
                r['replacementPolicies'].pop()
            elif edit == 'duplicate':
                r['replacementPolicies'].append(copy.deepcopy(r['replacementPolicies'][0]))
            elif edit == 'changed':
                next(p for p in r['replacementPolicies'] if p['row'] and
                     p['row']['command'] == 'a')['row']['check_expression'] = 'true'
            elif edit == 'proof_flag':
                next(p for p in r['replacementPolicies'] if p['row'])['rowHashVerified'] = 1
            else:
                r['schemaAccepted'] = True
            mutations.append(r)
        for bad in mutations:
            with self.subTest(bad=bad['replacementPolicies'][0]['identity']):
                with self.assertRaises(ValueError):
                    q.prove_replacements(bad)

    def test_complete_compositions_and_update_components(self):
        proof = q.prove_component(writes(), 'w', 'tenant_write')
        self.assertEqual(set(proof['components']), {'using', 'check'})
        self.assertTrue(proof['formulaProved'])
        self.assertGreater(proof['valuations']['threeValued'], proof['valuations']['twoValued'])
        self.assertTrue(q.prove_component([
            policy('read', 'r', 'true'), policy('guard', 'r', G, permissive=False)
        ], 'r', 'tenant_read')['formulaProved'])
        self.assertTrue(q.prove_component([
            policy('delete', 'd', S), policy('guard', 'd', W, permissive=False)
        ], 'd', 'service_only')['formulaProved'])

    def test_all_command_fallback_and_full_restrictive_conjunction(self):
        # PostgreSQL uses ALL/UPDATE USING as a missing WITH CHECK fallback.
        rows = [policy('all_write', '*', W), policy('guard', '*', W, permissive=False)]
        self.assertTrue(q.prove_component(rows, 'a', 'tenant_write')['formulaProved'])
        self.assertTrue(q.prove_component(rows, 'w', 'tenant_write')['formulaProved'])
        rows.append(policy('extra_false_restriction', 'w', 'false', 'false', False))
        with self.assertRaises(ValueError):
            q.prove_component(rows, 'w', 'tenant_write')

    def test_read_and_service_delete_do_not_accept_broader_live_compositions(self):
        with self.assertRaises(ValueError):
            q.prove_component([policy('read', 'r', 'true'),
                               policy('guard', 'r', 'true', permissive=False)], 'r', 'tenant_read')
        with self.assertRaises(ValueError):
            q.prove_component([policy('delete', 'd', S + ' OR ' + A),
                               policy('guard', 'd', W, permissive=False)], 'd', 'service_only')

    def test_missing_guard_and_weakened_guard_fail_even_when_permissive_limits(self):
        cases = [writes()[:1]]
        weak = writes()
        weak[0]['using_expression'] = W
        weak[0]['check_expression'] = W
        weak[1]['using_expression'] = 'true'
        cases.append(weak)
        for rows in cases:
            with self.assertRaises(ValueError):
                q.prove_component(rows, 'w', 'tenant_write')

    def test_true_write_unknown_additional_branch_and_cross_product_fail(self):
        cases = []
        rows = writes()
        rows.append(policy('extra_true', 'w', 'true', 'true'))
        cases.append(rows)
        rows = writes()
        rows.append(policy('unknown', 'w', 'evil(company_id)', W))
        cases.append(rows)
        rows = writes()
        rows[1]['check_expression'] = 'true'
        rows[0]['check_expression'] = A + ' OR ' + R
        cases.append(rows)
        for rows in cases:
            with self.assertRaises(ValueError):
                q.prove_component(rows, 'w', 'tenant_write')

    def test_sql_grammar_precedence_null_and_strict_rejection(self):
        self.assertEqual(q.normalize('true OR false AND false'),
                         ('or', ('const', True), ('and', ('const', False), ('const', False))))
        self.assertEqual(q.normalize(A), q.normalize('gridex_user_is_platform_admin()'))
        for bad in ('', 'true; SELECT 1', 'true -- comment', 'NOT true',
                    'gridex_can_write_company(other_id)', 'true OR', '(true',
                    'true false', "auth.role() = 'service_role'", 'null',
                    'true OR evil()', 'false /* ignored */ OR true'):
            with self.subTest(expression=bad), self.assertRaises(ValueError):
                q.normalize(bad)
        self.assertIsNone(q.evaluate(q.normalize('true AND ' + W), {'W': None}))
        self.assertIs(q.evaluate(q.normalize('false AND ' + W), {'W': None}), False)
        self.assertIs(q.evaluate(q.normalize('true OR ' + W), {'W': None}), True)

    def test_metadata_mixed_tables_duplicate_ids_other_roles_and_acl_modes_reject(self):
        for field, value in [('permissive', 1), ('command', 'SELECT'),
                             ('roles', ['service_role']), ('relname', 'other_table')]:
            rows = writes()
            rows[0][field] = value
            with self.assertRaises(ValueError):
                q.prove_component(rows, 'w', 'tenant_write')
        with self.assertRaises(ValueError):
            q.prove_component(writes() + [writes()[0]], 'w', 'tenant_write')
        with self.assertRaises(ValueError):
            q.prove_component(writes(), 'w', 'acl_denied')
        with self.assertRaises(ValueError):
            q.prove_component([], 'r', 'tenant_read')


if __name__ == '__main__':
    unittest.main()
