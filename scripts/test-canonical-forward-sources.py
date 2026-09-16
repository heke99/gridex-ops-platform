#!/usr/bin/env python3
"""Offline admission tests; no SQL execution or schema acceptance."""
import dataclasses
import hashlib
import copy
import json
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
try:
    import canonical_forward_sources as forward
except ModuleNotFoundError:
    forward = None

ROOT = Path(__file__).resolve().parents[1]


class ForwardSourcesTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(forward, 'pinned forward source admission is required')

    def historical(self):
        import canonical_native_timestamp_sources as historical
        return historical.prepare().selected

    def test_exact_timestamp_suffix_preserves_historical_authority(self):
        historical = self.historical()
        before, after = forward.partition_timestamps((*historical, *forward.FORWARD_SOURCES))
        self.assertEqual(before, historical)
        self.assertEqual(after, forward.FORWARD_SOURCES)
        self.assertEqual(len(before), 514)

    def test_seventh_retained_source_is_the_actually_qualified_cli_named_candidate(self):
        retained = forward.retain(ROOT)
        source = retained[6]
        self.assertEqual(len(retained), 12)
        self.assertEqual(source.source, 'migrations/20260915172543_preserve_retained_customer_history_on_delete.sql')
        self.assertEqual(source.source_sha256, '00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734')
        self.assertEqual(source.sql, (ROOT/'scripts/sql/forward-candidates/preserve-retained-customer-history-on-delete.sql').read_bytes())
        with self.assertRaisesRegex(ValueError,'FORWARD_RETAINED_SOURCES_REQUIRED'):
            forward.validate_retained((*retained[:6],dataclasses.replace(source,sql=source.sql+b'\n'),*retained[7:]))

    def test_later_qualified_candidates_are_exact_ordered_suffix(self):
        retained=forward.retain(ROOT)
        expected=(('20260915174610_expand_auth_email_event_action_domain.sql','expand-auth-email-event-action-domain.sql'),
                  ('20260915174614_restrict_access_table_capabilities.sql','restrict-canonical-access-table-capabilities.sql'),
                  ('20260915183840_drop_inert_inbound_client_policies.sql','drop-inert-inbound-client-policies-preserve-platform.sql'))
        for index,(filename,candidate) in enumerate(expected,7):
            source=retained[index]
            self.assertEqual(source.source,'migrations/'+filename)
            self.assertEqual(source.sql,(ROOT/'scripts/sql/forward-candidates'/candidate).read_bytes())
            with self.assertRaisesRegex(ValueError,'FORWARD_RETAINED_SOURCES_REQUIRED'):
                forward.validate_retained((*retained[:index],dataclasses.replace(source,sql=source.sql+b'changed'),*retained[index+1:]))

    def test_timestamp_changes_fail_closed(self):
        historical = self.historical()
        selected = (*historical, *forward.FORWARD_SOURCES)
        cases = [historical, selected[:-1], selected + (selected[-1],),
                 (*historical, *reversed(forward.FORWARD_SOURCES)),
                 (historical[1], historical[0], *selected[2:]),
                 ((historical[0][0], '0' * 64), *selected[1:]),
                 (*selected[:-1], (selected[-1][0], '0' * 64)),
                 (*selected[:-1], ('migrations/20990101000000_unknown.sql', '0' * 64))]
        for case in cases:
            with self.subTest(size=len(case)), self.assertRaises(ValueError):
                forward.partition_timestamps(case)

    def inventory(self):
        suffix = {p for p, _ in forward.FORWARD_SOURCES}
        return sorted((p.relative_to(ROOT / 'supabase').as_posix(),
                       hashlib.sha256(p.read_bytes()).hexdigest())
                      for p in (ROOT / 'supabase/migrations').rglob('*.sql')
                      if p.relative_to(ROOT / 'supabase').as_posix() not in suffix)

    def test_inventory_preserves_every_historical_checksum(self):
        inventory = self.inventory()
        before, after = forward.partition_inventory(inventory + list(forward.FORWARD_SOURCES))
        self.assertEqual(before, tuple(inventory))
        self.assertEqual(len(before), 601)
        self.assertEqual(after, forward.FORWARD_SOURCES)
        changed = inventory.copy()
        changed[0] = (changed[0][0], '0' * 64)
        for rows in (inventory, inventory[:-1] + list(forward.FORWARD_SOURCES),
                     changed + list(forward.FORWARD_SOURCES),
                     inventory + list(forward.FORWARD_SOURCES) + [inventory[0]]):
            with self.subTest(size=len(rows)), self.assertRaises(ValueError):
                forward.partition_inventory(rows)

    def test_historical_auth_group_preserves_exact_old_scope_and_rejects_bad_suffix(self):
        result = subprocess.run([sys.executable, 'scripts/gridex-replay-review-groups.py',
                                 '--group', 'auth_membership_tenant'], cwd=ROOT,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        report = json.loads(result.stdout)
        self.assertEqual(len(report['inputs']), 352)
        original = copy.deepcopy(report)
        converted = forward.historical_fixture_review_group(report)
        self.assertEqual(report, original)
        self.assertEqual(len(converted['inputs']), 347)
        self.assertEqual(sum(r['classification']=='FULL_FILE_SELECTED' for r in converted['inputs']), 335)
        suffix = [r for r in report['inputs'] if r['path'] in dict(forward.FORWARD_SOURCES)]
        self.assertEqual(len(suffix), 5)  # Lexical group includes five of the twelve forwards.
        self.assertEqual(suffix[0]['execution'], [dict(ordinal=518, stage='timestamp')])
        for field, value in [('sha256', '0'*64), ('classification', 'SUBSTITUTED'),
                             ('execution', [dict(ordinal=514,stage='timestamp')])]:
            changed = copy.deepcopy(report)
            next(r for r in changed['inputs'] if r['path']==suffix[0]['path'])[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                forward.historical_fixture_review_group(changed)
        changed = copy.deepcopy(report)
        changed['inputs'].append(copy.deepcopy(suffix[0]))
        with self.assertRaises(ValueError):
            forward.historical_fixture_review_group(changed)

    def install(self, root):
        for name, _ in forward.FORWARD_SOURCES:
            source = ROOT / 'supabase' / name
            if not source.exists():
                candidate = ('restrict-retained-operational-table-privileges.sql'
                             if 'operational' in name else Path(name).name)
                source = ROOT / 'scripts/sql/forward-candidates' / candidate
            target = root / 'supabase' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())

    def test_retained_bytes_survive_original_source_removal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.install(root)
            retained = forward.retain(root)
            for name, _ in forward.FORWARD_SOURCES:
                (root / 'supabase' / name).unlink()
            self.assertEqual(forward.validate_retained(retained), retained)
            with self.assertRaises(dataclasses.FrozenInstanceError):
                retained[0].sql = b'changed'
            altered = (dataclasses.replace(retained[0], sql=retained[0].sql + b'\n'), *retained[1:])
            for invalid in (retained[:-1], tuple(reversed(retained)), altered):
                with self.assertRaises(ValueError):
                    forward.validate_retained(invalid)

    def test_missing_changed_and_symlink_sources_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(ValueError):
                forward.retain(root)
            self.install(root)
            source = root / 'supabase' / forward.FORWARD_SOURCES[0][0]
            raw = source.read_bytes()
            source.write_bytes(raw + b'\n')
            with self.assertRaises(ValueError):
                forward.retain(root)
            source.unlink()
            outside = root / 'outside.sql'
            outside.write_bytes(raw)
            source.symlink_to(outside)
            with self.assertRaises(ValueError):
                forward.retain(root)
            source.unlink()
            source.write_bytes(raw)
            migrations = source.parent
            moved = root / 'moved'
            migrations.rename(moved)
            migrations.symlink_to(moved, target_is_directory=True)
            with self.assertRaises(ValueError):
                forward.retain(root)

    def test_historical_fixture_adapter_preserves_current_evidence_and_rejects_drift(self):
        import copy,json,subprocess
        current=json.loads(subprocess.run([sys.executable,'scripts/gridex-replay-input-accounting.py'],
                          cwd=ROOT,capture_output=True,text=True).stdout)
        original=copy.deepcopy(current)
        historical=forward.historical_fixture_accounting(current)
        self.assertEqual(current,original)
        self.assertEqual((historical['totalMigrations'],historical['currentInventoryTotal']),(601,613))
        self.assertEqual(historical['selectedInputCounts'],dict(foundation=144,timestamp=514))
        self.assertEqual(historical['counts']['FULL_FILE_SELECTED'],589)
        mutations=[]
        for field,value in [('totalMigrations',601),('counts',{}),('errors',['changed'])]:
            changed=copy.deepcopy(current);changed[field]=value;mutations.append(changed)
        for path in (current['migrations'][0]['path'],forward.FORWARD_SOURCES[0][0]):
            changed=copy.deepcopy(current)
            next(r for r in changed['migrations'] if r['path']==path)['sha256']='0'*64
            mutations.append(changed)
        changed=copy.deepcopy(current)
        next(r for r in changed['migrations'] if r['path']==forward.FORWARD_SOURCES[0][0])['execution']=[]
        mutations.append(changed)
        for changed in mutations:
            with self.assertRaises(ValueError): forward.historical_fixture_accounting(changed)


if __name__ == '__main__':
    unittest.main()
