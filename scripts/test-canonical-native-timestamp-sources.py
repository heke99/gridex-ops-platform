#!/usr/bin/env python3
"""Compiler contracts only; these tests never execute SQL or certify replay."""
import dataclasses
import hashlib
from pathlib import Path
import sys
from types import MappingProxyType
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import canonical_native_timestamp_sources as compiler


class TimestampSourcesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = compiler.prepare()

    def test_complete_source_and_boundary_accounting(self):
        self.assertEqual(len(self.plan.selected), 514)
        self.assertEqual(len(self.plan.units), 522)
        self.assertEqual(len({u.name for u in self.plan.units}), 522)
        self.assertEqual(sum(u.kind == 'timestamp' for u in self.plan.units), 516)
        self.assertEqual(sum(u.kind == 'prerequisite' for u in self.plan.units), 5)
        self.assertEqual(sum(u.kind == 'cleanup' for u in self.plan.units), 1)
        self.assertTrue(all(len(u.name) <= 63 for u in self.plan.units))

    def test_compile_from_retained_sources_never_reopens_sql(self):
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('source reopened')):
            replay = compiler.compile_retained(self.plan.selected, self.plan.prerequisites, self.plan.retained)
        self.assertEqual(replay.units, self.plan.units)

    def test_mutated_reordered_missing_and_forged_sources_fail_closed(self):
        selected = list(self.plan.selected)
        cases = [selected[:-1], list(reversed(selected)), selected + [selected[0]]]
        altered = selected.copy()
        path, digest = altered[0]
        altered[0] = (path, '0' * 64)
        cases.append(altered)
        for rows in cases:
            with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                compiler.compile_retained(rows, self.plan.prerequisites, self.plan.retained)
        for retained in (dict(self.plan.retained),
                         MappingProxyType({k:v for k,v in self.plan.retained.items() if k != path}),
                         MappingProxyType({**self.plan.retained, path:self.plan.retained[path]+b'\n'})):
            with self.assertRaises(ValueError):
                compiler.compile_retained(self.plan.selected, self.plan.prerequisites, retained)

    def test_two_phase_sources_preserve_every_original_byte_and_commit_order(self):
        for ordinal in (201, 202):
            units = [u for u in self.plan.units if u.ordinal == ordinal and u.kind == 'timestamp']
            self.assertEqual([u.phase for u in units], [1, 2])
            self.assertEqual([u.phase_count for u in units], [2, 2])
            original = self.plan.retained[units[0].source]
            self.assertEqual(b''.join(u.source_sql for u in units), original)
            first = compiler.prefix.statements(units[0].source_sql.decode())
            self.assertEqual(first[0][0][0].upper(), 'BEGIN')
            self.assertEqual(first[-1][0][0].upper(), 'COMMIT')
            self.assertIn(b'gridex_backfill_contract_lifecycle(null)', units[1].sql)
            self.assertNotEqual(units[0].name, units[1].name)
            for u in units:
                self.assertIn('COMMITTED_PHASES', u.qualifications)
                self.assertFalse(any(s[0][0].upper() in ('BEGIN','COMMIT')
                                     for s in compiler.prefix.statements(u.sql.decode())))

    def test_lock_adaptation_keeps_statement_bytes_location_and_settings(self):
        for ordinal in (221, 222, 224, 225):
            u = next(u for u in self.plan.units if u.kind == 'timestamp' and u.ordinal == ordinal)
            plain, _ = compiler.transfer_outer(u.source_sql)
            self.assertEqual(u.sql.replace(compiler.LOCK_OPEN, b'').replace(compiler.LOCK_CLOSE, b''), plain)
            self.assertEqual(u.sql.count(compiler.LOCK_OPEN), 1)
            self.assertIn('LOCK_LIFETIME', u.qualifications)
        u = next(u for u in self.plan.units if u.kind == 'timestamp' and u.ordinal == 225)
        self.assertIn(b'set local search_path = public, extensions, pg_catalog, pg_temp;', u.sql)

    def test_unrecognized_controls_and_lock_sources_rejected(self):
        for raw in (b'BEGIN; SELECT 1; COMMIT; SELECT 2;', b'SAVEPOINT x;',
                    b'PREPARE TRANSACTION \'x\';', b'ALTER SYSTEM SET log_statement=\'all\';',
                    b'RESET ALL;', b'SET log_statement=\'all\';'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                compiler.transfer_outer(raw)
        with self.assertRaises(ValueError):
            compiler.adapt_locks(b'LOCK TABLE public.x IN ACCESS EXCLUSIVE MODE;', b'LOCK TABLE public.x IN ACCESS EXCLUSIVE MODE;', 221)

    def test_quoted_transaction_words_and_comments_are_never_rewritten(self):
        raw = b"-- COMMIT; stays\nBEGIN;\nDO $body$ BEGIN PERFORM 'COMMIT; LOCK TABLE private.x'; END $body$;\nCOMMIT;\n-- trailing comment\n"
        program, transferred = compiler.transfer_outer(raw)
        self.assertTrue(transferred)
        self.assertEqual(program, b"-- COMMIT; stays\n\nDO $body$ BEGIN PERFORM 'COMMIT; LOCK TABLE private.x'; END $body$;\n\n-- trailing comment\n")

    def test_changed_split_and_lock_source_hashes_are_never_adapted(self):
        for ordinal in (201, 202):
            raw = self.plan.retained[self.plan.selected[ordinal-1][0]]
            with self.assertRaises(ValueError):
                compiler.split_phases(raw+b'\n', ordinal)
        for ordinal in compiler.LOCK_PINS:
            raw = self.plan.retained[self.plan.selected[ordinal-1][0]]
            plain = compiler.transfer_outer(raw)[0]
            with self.assertRaises(ValueError):
                compiler.adapt_locks(raw+b'\n', plain, ordinal)
            with self.assertRaises(ValueError):
                compiler.adapt_locks(raw, plain+b'SELECT 123;\n', ordinal)

    def test_missing_live_sync_authority_or_changed_prerequisite_is_rejected(self):
        fix = compiler.load_tail().load_live_sync_proof().fix
        for name in (fix.ORIGINAL, fix.FORWARD, fix.HARDENING):
            bundle = MappingProxyType({p:raw for p,raw in self.plan.retained.items() if p != name})
            with self.subTest(name=name), self.assertRaises(ValueError):
                compiler.compile_retained(self.plan.selected, self.plan.prerequisites, bundle)
        prerequisites = dict(self.plan.prerequisites)
        stamp = next(iter(prerequisites))
        prerequisites[stamp] = (prerequisites[stamp][0], '0'*64)
        with self.assertRaises(ValueError):
            compiler.compile_retained(self.plan.selected, prerequisites, self.plan.retained)

    def test_prerequisite_order_and_shim_cleanup_are_explicit(self):
        for ordinal in (430, 482, 487, 488, 490):
            at = [u for u in self.plan.units if u.ordinal == ordinal]
            self.assertEqual([u.kind for u in at], ['prerequisite','timestamp','cleanup'] if ordinal == 490 else ['prerequisite','timestamp'])
            self.assertEqual(at[1].condition, 'always')
            if ordinal == 490:
                self.assertEqual(at[0].condition, 'white_label_shim_created')
                self.assertEqual(at[2].condition, 'white_label_shim_created')
                self.assertEqual(at[2].sql, compiler.WHITE_LABEL_DROP.encode())
                self.assertIn('WHITE_LABEL_CONDITIONAL', at[0].qualifications)

    def test_live_sync_candidate_uses_complete_existing_reconstruction(self):
        u = next(u for u in self.plan.units if u.kind == 'timestamp' and u.ordinal == 232)
        fix = compiler.load_tail().load_live_sync_proof().fix
        candidate, evidence = fix.reconstruct(compiler.ROOT, u.source_sql.decode(), retained=self.plan.retained)
        self.assertEqual(u.sql, compiler.transfer_outer(candidate.encode())[0])
        self.assertEqual(evidence['sourceSha256'], u.source_sha256)
        self.assertIn('LIVE_SYNC', u.qualifications)
        self.assertNotEqual(u.source_sql, u.sql)

    def test_ledger_sensitive_sources_remain_unmodified_and_uncertified(self):
        for ordinal in (257, 262, 275, 351):
            u = next(u for u in self.plan.units if u.kind == 'timestamp' and u.ordinal == ordinal)
            self.assertEqual(u.sql, compiler.transfer_outer(u.source_sql)[0])
            self.assertIn('LEDGER_DEPENDENT_READINESS', u.qualifications)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.plan.units[0].phase = 99
        with self.assertRaises(TypeError):
            self.plan.retained['fake'] = b'SELECT 1;'
        for changes in ({'ordinal':0}, {'phase':3}, {'kind':'historical'}, {'condition':'skip'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                dataclasses.replace(self.plan.units[0], **changes)


if __name__ == '__main__':
    unittest.main(verbosity=2)
