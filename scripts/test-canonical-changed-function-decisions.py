import copy
import unittest
from unittest.mock import patch

import canonical_changed_function_decisions as m


class Tests(unittest.TestCase):
    def test_two_explicit_decisions_reconstruct_independent_review_hashes(self):
        rows = m.approved()
        self.assertEqual(len(rows), 2)
        self.assertEqual([(r['referenceSha256'], r['replaySha256']) for r in rows], [
            ('d0eefa1c185c314d4be901f7d078558d51e1b178325daa8c54cc2c3e99297b2c',
             '57d302862488cd06fc2e824055907c9e86d910df5947a5f04620b000413f7c46'),
            ('f46ab7dd1f81f7277cba046358e56f3ae4d0283cda300f84312029d8f170eeb0',
             '7ba39f7eb46226646c8a02696cdfc89f9363d74cf6e6eb858121936360473695'),
        ])
        self.assertTrue(all(r['section'] == 'functions' and r['change'] == 'changed'
                            and r['fields'] == ['body_md5'] and r['witness'] == m.KEY
                            for r in rows))
        self.assertNotIn('EQUIVALENT', rows[1]['decision'])

    def test_native_actor_receipt_is_mandatory_not_portable_or_partial(self):
        receipt = m.witness.expected_receipt(native=True)
        self.assertEqual(m.validate_execution_receipt(receipt, native=True), receipt)
        for native in (False, 1, None):
            with self.subTest(native=native), self.assertRaises(ValueError):
                m.validate_execution_receipt(receipt, native=native)
        with self.assertRaises(ValueError):
            m.validate_execution_receipt(m.witness.expected_receipt(native=False), native=True)
        with self.assertRaises(ValueError):
            m.validate_execution_receipt(None, native=True)

    def test_no_relabelled_or_incomplete_receipt_can_accept_the_changes(self):
        for key, value in (
            ('verified', False), ('caseCount', 23), ('nativeTarget', False),
            ('permissionOverridesVerified', False), ('fixturesRolledBack', False),
            ('catalogAndRowsPreserved', False), ('ledgerUnchanged', False),
            ('sqlSha256', '0' * 64), ('schemaAccepted', True),
            ('sourcePins', {}),
        ):
            receipt = copy.deepcopy(m.witness.expected_receipt(native=True))
            receipt[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.validate_execution_receipt(receipt, native=True)

    def test_source_audit_and_actor_definitions_cannot_drift(self):
        with patch.object(m, 'AUDIT_SHA', '0' * 64), self.assertRaises(ValueError):
            m.approved()
        with patch.object(m.witness, 'CAN_MD5', '0' * 32), self.assertRaises(ValueError):
            m.approved()
        with patch.object(m.witness, 'CAPABILITY_MD5', '0' * 32), self.assertRaises(ValueError):
            m.approved()
        with patch.object(m.witness, 'retain', side_effect=ValueError('source changed')):
            with self.assertRaises(ValueError):
                m.approved()

    def test_privilege_signature_return_type_and_body_change_the_catalog_hash(self):
        name, args, _, body, _ = m.SPECS[0]
        base = m.catalog_row(name, args, body)
        for field, value in (('security_definer', True), ('arguments', args + ' DEFAULT NULL'),
                             ('return_type', 'text'), ('body_md5', '0' * 32),
                             ('volatility', 'v'), ('kind', 'p')):
            mutated = dict(base, **{field: value})
            self.assertNotEqual(m.sha(mutated), m.sha(base), field)


if __name__ == '__main__':
    unittest.main()
