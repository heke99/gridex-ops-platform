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
        for command in ('dirname', 'mktemp', 'mkdir', 'rm', 'cp', 'sha256sum', 'awk', 'stat', 'touch'):
            (self.bin / command).symlink_to(shutil.which(command))
        (self.root / 'scripts').mkdir()
        self.script = self.root / 'scripts' / 'gridex-aud-003-clean-replay.sh'
        shutil.copyfile(ROOT / 'scripts' / self.script.name, self.script)
        self.migrations = self.root / 'supabase' / 'migrations'
        self.migrations.mkdir(parents=True)
        self.migrations.chmod(0o755)
        self.migration_mode=self.migrations.stat().st_mode & 0o7777
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
        (self.root / 'scripts/sql').mkdir()
        shutil.copyfile(ROOT / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql', self.root / 'scripts/sql/gridex-supabase-compatible-bootstrap.sql')
        self.context=True
        self.stub('psql', 'exit 99')  # Database execution must never be reached.
        self.calls = self.root / 'supabase-calls'
        self.stub('supabase', '''
printf '%s\\n' "$*" >> "$FIXTURE/supabase-calls"
exit 99
''')
        self.stub('python3', '''
if [[ "$1" == */canonical-auth-provisioning-replay.py ]]; then exit 0; fi
if [[ "$1" == */gridex-replay-input-accounting.py ]]; then
  [[ "$*" == *--require-full-effects* ]] || exit 92
  exit 0
fi
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

    def execute_replay(self, *arguments):
        self.migration_mtime_ns=self.migrations.stat().st_mtime_ns
        env = {'PATH': str(self.bin), 'TMPDIR': str(self.tmp), 'FIXTURE': str(self.root)}
        if self.context:
            env.update(GRIDEX_REPLAY_DB_URL='owned-compatible', GRIDEX_REPLAY_OWNED_SOCKET=str(self.root / 'synthetic-context'))
        result = subprocess.run([BASH, str(self.script), *arguments], cwd=self.root,
                                env=env, capture_output=True, text=True, timeout=10)
        return result

    def run_replay(self, expected_status, *arguments):
        result = self.execute_replay(*arguments)
        self.assertEqual(result.returncode, expected_status, result.stderr)
        self.assertEqual(self.snapshot(), self.originals,
                         'failed replay changed original migrations or seed')
        self.assertEqual(self.migrations.stat().st_mode & 0o7777, self.migration_mode,
                         'replay changed the original migrations-directory mode')
        self.assertEqual(self.migrations.stat().st_mtime_ns,self.migration_mtime_ns,
                         'replay changed the original migrations-directory mtime')
        self.assertEqual(list(self.tmp.iterdir()), [], 'successful cleanup leaked temporary files')
        return result

    def supabase_calls(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def test_invalid_scope_allocates_no_temporary_paths(self):
        for arguments in (('--unsupported',), ('--foundation-prefix-proof', 'extra')):
            with self.subTest(arguments=arguments):
                result=self.run_replay(1,*arguments)
                self.assertIn('unsupported replay scope',result.stderr)
                self.assertEqual(self.supabase_calls(),[])

    def test_real_staging_keeps_hold_private_and_retains_hidden_entries(self):
        (self.migrations / '.hidden-source.sql').write_text('-- hidden synthetic source\n')
        (self.migrations / '.metadata').mkdir(mode=0o750)
        (self.migrations / '.metadata' / 'retained').write_text('synthetic nested metadata\n')
        (self.migrations / '.link').symlink_to('README.txt')
        self.originals=self.snapshot()
        self.stub('python3', '''
if [[ "$1" == */gridex-replay-input-accounting.py ]]; then exit 0; fi
if [[ "$1" == */canonical-auth-provisioning-replay.py ]]; then exit 0; fi
# This is the actual shell's generated-plan call, after its real entry copy.
[[ "$1" == - && "$#" == 12 ]] || exit 92
[[ "$(stat -c %a "${10}")" == 700 ]] || exit 93
[[ "$(stat -c %a "$FIXTURE/supabase/migrations")" == 755 ]] || exit 94
[[ -f "${10}/.hidden-source.sql" && -f "${10}/.metadata/retained" && -L "${10}/.link" ]] || exit 95
[[ "$(stat -c %a "${10}/.metadata")" == 750 ]] || exit 96
exit 73
''')
        self.run_replay(73)
        self.assertEqual((self.migrations / '.metadata').stat().st_mode & 0o777,0o750)
        self.assertTrue((self.migrations / '.link').is_symlink())
        self.assertEqual(self.supabase_calls(),[])

    def test_early_accounting_failure_never_stops_supabase(self):
        self.stub('python3', 'exit 2')
        self.run_replay(2)
        self.assertEqual(self.supabase_calls(), [])

    def test_early_failure_preserves_preexisting_stack(self):
        existing = self.root / 'preexisting-stack'
        existing.write_text('running before replay')
        self.stub('supabase', '''
printf '%s\\n' "$*" >> "$FIXTURE/supabase-calls"
if [[ "$1" == stop ]]; then rm "$FIXTURE/preexisting-stack"; fi
exit 0
''')
        self.stub('python3', 'exit 2')
        self.run_replay(2)
        self.assertTrue(existing.exists(), 'preflight stopped a preexisting local stack')
        self.assertEqual(self.supabase_calls(), [])

    def test_failed_start_attempt_is_cleaned_and_preserves_failure_status(self):
        # Former attempted-start cleanup was not proof of stack ownership.
        # This same failure path must now reject before touching any stack.
        self.context=False
        existing=self.root / 'attempted-stack';existing.write_text('preexisting partial stack')
        result=self.run_replay(1)
        self.assertIn('unsupported replay target',result.stderr)
        self.assertEqual(self.supabase_calls(),[])
        self.assertTrue(existing.exists())

    def test_unowned_socket_rejected_before_staging(self):
        self.stub('python3', '''
if [[ "$1" == */gridex-replay-input-accounting.py ]]; then exit 0; fi
if [[ "$1" == */canonical-auth-provisioning-replay.py ]]; then exit 79; fi
exit 98
''')
        self.run_replay(79)
        self.assertEqual(self.supabase_calls(),[])

    def test_missing_supabase_preserves_originals(self):
        (self.bin / 'supabase').unlink()
        self.context=False
        self.run_replay(1)

    def test_input_accounting_failure_preserves_originals(self):
        self.stub('python3', 'exit 2')
        self.run_replay(2)

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
if [[ "$1" == '-a' && "$2" == -- && "$3" == "$FIXTURE/supabase/migrations/"* ]]; then
  {shlex.quote(REAL_CP)} "$FIXTURE/supabase/migrations/20260101000000_first.sql" "${{@: -1}}"
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
if [[ "$1" == '-a' && "${{@: -1}}" == "$FIXTURE/supabase/migrations/" ]]; then
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
