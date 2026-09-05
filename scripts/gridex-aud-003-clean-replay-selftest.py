#!/usr/bin/env python3
"""Exercise replay failure cleanup in disposable fixtures; never connect to a DB."""
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which('bash')
REAL_CP = shutil.which('cp')


class ReplayCleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gridex-replay-cleanup-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.tmp = self.root / 'tmp'
        self.tmp.mkdir()
        for command in ('dirname', 'mktemp', 'rm', 'cp', 'sha256sum', 'awk'):
            (self.bin / command).symlink_to(shutil.which(command))
        (self.root / 'scripts').mkdir()
        self.script = self.root / 'scripts' / 'gridex-aud-003-clean-replay.sh'
        shutil.copyfile(ROOT / 'scripts' / self.script.name, self.script)
        self.migrations = self.root / 'supabase' / 'migrations'
        self.migrations.mkdir(parents=True)
        (self.migrations / '20260101000000_first.sql').write_text('-- original one\n')
        (self.migrations / '20260101000001_second.sql').write_text('-- original two\n')
        (self.migrations / 'README.txt').write_text('preserve non-SQL files\n')
        self.seed = self.root / 'supabase' / 'seed.sql'
        self.seed.write_text('-- original seed\n')
        shutil.copytree(ROOT / 'supabase' / 'bootstrap', self.root / 'supabase' / 'bootstrap')
        for name in ('gridex-aud-003-schema-fingerprint.sql',
                     'gridex-aud-003-foundation-order.json',
                     'gridex-aud-003-noncanonical-artifacts.json'):
            shutil.copyfile(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        self.stub('psql', 'exit 99')  # Database execution must never be reached.
        self.stub('supabase', 'exit 99')
        self.stub('python3', '''
[[ ! -e "$FIXTURE/supabase/migrations/20260101000000_first.sql" ]] || exit 90
[[ ! -s "$FIXTURE/supabase/seed.sql" ]] || exit 91
printf 'temporary replay marker\\n' > "$FIXTURE/supabase/migrations/20260101000002_marker.sql"
exit 73
''')
        self.originals = self.snapshot()

    def stub(self, name, body):
        path = self.bin / name
        path.unlink(missing_ok=True)
        path.write_text(f'#!{BASH}\nset -eu\n{body}\n')
        path.chmod(0o755)

    def snapshot(self):
        return {str(p.relative_to(self.root / 'supabase')): p.read_bytes()
                for p in [*self.migrations.rglob('*'), self.seed] if p.is_file()}

    def execute_replay(self):
        env = {'PATH': str(self.bin), 'TMPDIR': str(self.tmp), 'FIXTURE': str(self.root)}
        result = subprocess.run([BASH, str(self.script)], cwd=self.root,
                                env=env, capture_output=True, text=True, timeout=10)
        return result

    def run_replay(self, expected_status):
        result = self.execute_replay()
        self.assertEqual(result.returncode, expected_status, result.stderr)
        self.assertEqual(self.snapshot(), self.originals,
                         'failed replay changed original migrations or seed')
        self.assertEqual(list(self.tmp.iterdir()), [], 'successful cleanup leaked temporary files')
        return result

    def test_missing_supabase_preserves_originals(self):
        (self.bin / 'supabase').unlink()
        self.run_replay(1)

    def test_missing_psql_preserves_originals(self):
        (self.bin / 'psql').unlink()
        self.run_replay(1)

    def test_missing_provenance_preserves_originals(self):
        (self.root / 'scripts' / 'gridex-aud-003-foundation-order.json').unlink()
        self.assertIn('missing replay provenance input', self.run_replay(1).stderr)

    def test_checksum_drift_preserves_originals(self):
        prerequisite = self.root / 'supabase/bootstrap/20260824_powers_of_attorney_legal_bundle_version_document_prerequisite.sql'
        prerequisite.write_text('-- wrong checksum\n')
        self.assertIn('checksum drift', self.run_replay(1).stderr)

    def test_partial_migration_backup_preserves_unbacked_originals(self):
        self.stub('cp', f'''
if [[ "$1" == '-a' && "$2" == "$FIXTURE/supabase/migrations/." ]]; then
  {shlex.quote(REAL_CP)} "$FIXTURE/supabase/migrations/20260101000000_first.sql" "$3"
  exit 74
fi
exec {shlex.quote(REAL_CP)} "$@"
''')
        self.run_replay(74)

    def test_partial_seed_backup_preserves_originals(self):
        self.stub('cp', f'''
if [[ "$1" == "$FIXTURE/supabase/seed.sql" ]]; then
  printf 'partial' > "$2"
  exit 75
fi
exec {shlex.quote(REAL_CP)} "$@"
''')
        self.run_replay(75)

    def test_missing_seed_stays_missing(self):
        self.seed.unlink()
        self.originals = self.snapshot()
        self.run_replay(1)
        self.assertFalse(self.seed.exists())

    def test_failed_restore_retains_migration_recovery_copy(self):
        self.stub('cp', f'''
if [[ "$1" == '-a' && "$3" == "$FIXTURE/supabase/migrations/" ]]; then
  exit 76
fi
exec {shlex.quote(REAL_CP)} "$@"
''')
        result = self.execute_replay()
        self.assertEqual(result.returncode, 73)
        backups = list(self.tmp.rglob('20260101000000_first.sql'))
        self.assertEqual(len(backups), 1, 'cleanup destroyed the only recovery copy')
        self.assertEqual(backups[0].read_bytes(), b'-- original one\n')
        self.assertIn(str(backups[0].parent), result.stderr)
        self.assertEqual(self.seed.read_bytes(), b'-- original seed\n')

    def test_failed_restore_retains_seed_recovery_copy(self):
        self.stub('cp', f'''
if [[ "$2" == "$FIXTURE/supabase/seed.sql" ]]; then
  exit 77
fi
exec {shlex.quote(REAL_CP)} "$@"
''')
        result = self.execute_replay()
        self.assertEqual(result.returncode, 73)
        backups = [p for p in self.tmp.iterdir() if p.is_file()
                   and p.read_bytes() == b'-- original seed\n']
        self.assertEqual(len(backups), 1, 'cleanup destroyed the only seed recovery copy')
        self.assertIn(str(backups[0]), result.stderr)
        self.assertEqual((self.migrations / '20260101000000_first.sql').read_bytes(),
                         b'-- original one\n')

    def test_failure_after_mutation_restores_originals_and_failure_status(self):
        self.run_replay(73)


if __name__ == '__main__':
    unittest.main(verbosity=2)
