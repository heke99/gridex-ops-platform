#!/usr/bin/env python3
"""One-shot, pinned main -> PR310 integration. Never pushes or changes main."""
import json
import os
from pathlib import Path
import subprocess

MAIN = 'de098106c26d90069758cf1f753a94b073789ef2'
BASE = 'eb9a25bc989c6de808903f41c2314d5465e9c07b'
PRIOR = '8c943b61b5d329045a7d1eec00bec002e406e337'
PINS = {
    '.agent-memory/checkpoint.json': ('edf971f1b6d7318c59c5b2feb6eb718eba5e475d', '96f356db510c0a2da65f7639ee7eb92109888da9'),
    '.agent-memory/completed-work.md': ('47496a460d50b44ef60d897e25874f4fd2f7953f', 'afe4e539e3ff8764b7d63d96a7a19d25ef656e46'),
    '.agent-memory/current-state.md': ('6f703a887cfe725cd001ca49f27c12655b4b4cd3', '0d7aa6115cc3934826199e171c7a92dc8eb7e380'),
    '.agent-memory/session-log.md': ('3c461f4981fa63dce89ee8067d024e1cd2bbbd05', 'f5b6ea05907cfc754e119dbb1e05362e5bba6351'),
    '.agent-memory/verification-matrix.md': ('44322b3e3c30ece0c15c3b0b7323b61838119507', '70f34bde54b96268cf50c2b7af26286c8397fa08'),
    'lib/ediel/core/messagePolicy.ts': ('87390eb946a792a30331e91a1cfe7776031e3583', '58d5bfd861f4d2000e06e36acbe30caac3a7e187'),
}
REPAIRS = {
    'scripts/canonical_permission_full_seed.py': 'a3823a59cc195976e70f44f8d1e4f1850218f6ac',
    'scripts/test-canonical-permission-full-seed.py': '46c57ee8f4b373be6ca11e1e4c6610f80dd7b9b5',
    'scripts/canonical-full-permission-clone-qualification.py': '33e891240543d2524556e747bf521067db358bab',
    'scripts/test-canonical-full-permission-clone.py': '5b15194836a5899db6a1cf2a0a5bf9fc0a305ce2',
}
AUDIT = 'quality/audits/ediel-masterplan-v2/partial-main-merge.md'
ARCHIVES = {
    '.agent-memory/archive/pr310-pre-main-reconciliation-8c943b61.md': PINS['.agent-memory/current-state.md'][0],
    '.agent-memory/archive/pr312-partial-main-state-de098106.md': PINS['.agent-memory/current-state.md'][1],
}
NOTE = '''\n2026-09-15: User resumed full PR310 remediation. Continuation8c943b61 was fast-forwarded into PR310; the F05-F12 full-clone roster adapter now checks exact tenant members and retains foreign/global/write denials. Offline tests: full seed8, clone boundary10, original native fixture10 PASS (28 total). Main de098106 is integrated into the PR branch, not vice versa. Historical state is archived; no historical migration, candidate SQL or live database changed. Full permission database run35025303437 was launched but its result is not assumed here. Native replay, reviewed schema, genuine generated types and final CI remain release gates.\n'''
CURRENT = '''# Current state\n\nUpdated: 2026-09-15\n\nActive task: finish PR310 and merge to main only after the required verification. This supersedes the earlier instruction to defer database work.\n\n## Published and preserved\n\n- PR310: codex/gridex-parity-remediation-20260905. The 20 continuation commits through8c943b61 are preserved by fast-forward. PR312 independent Ediel work is already on main de098106. This reconciliation merges that main into PR310, not PR310 into main.\n- F05-F12 full permission fixture now checks exact company membership/role rosters under the retained August26 policy, plus zero foreign and global rows. All original write/column-ACL/SQLSTATE denials and rollback checks remain. No RLS grants or production permissions were broadened.\n- Offline tests:8 full-seed +10 clone-boundary +10 original native-fixture PASS. Full database qualification run35025303437 on a27d4329 was started; inspect its actual result before promotion.\n- Both pre-reconciliation current-state documents are retained verbatim under .agent-memory/archive/. Appended historical evidence from both branches is preserved.\n\n## Remaining gates\n\nThe permission candidate has not been promoted. Require complete129-case clone qualification and24 behavior cases; then a genuine new forward identity, source/provenance updates, full native replay, explicit schema review, genuine generated types and all required CI. A portable replay pass is not native/schema/type release acceptance. Do not mark these gates green from an offline fixture pass.\n\nPR310 is not merged to main. No live database mutation, production deployment or market message is authorized by this integration receipt or was performed by its script.\n'''


def git(*args, ok=True):
    result = subprocess.run(['git', *args], capture_output=True, check=False)
    if ok and result.returncode:
        raise RuntimeError('GIT_OPERATION_FAILED:' + args[0])
    return result


def text(*args):
    return git(*args).stdout.decode().strip()


def append_history(base, ours, theirs):
    if not theirs.startswith(base):
        raise ValueError('APPEND_ONLY_HISTORY_REQUIRED')
    tail = theirs[len(base):]
    return ours + (tail if tail and not ours.endswith(tail) else b'') + NOTE.encode()


def require(condition, label):
    if not condition:
        raise ValueError(label)


def run():
    head = text('rev-parse', 'HEAD')
    require(os.environ.get('PR310_SOURCE_SHA') == head, 'EXACT_HEAD_REQUIRED')
    require(not text('status', '--porcelain'), 'CLEAN_CHECKOUT_REQUIRED')
    require(text('rev-parse', 'refs/remotes/origin/main') == MAIN, 'PINNED_MAIN_REQUIRED')
    require(git('merge-base', '--is-ancestor', PRIOR, head, ok=False).returncode == 0, 'CONTINUATION_REQUIRED')
    require(git('merge-base', '--is-ancestor', MAIN, head, ok=False).returncode == 1, 'INTEGRATION_ALREADY_PRESENT_OR_INVALID')
    require(text('merge-base', head, MAIN) == BASE, 'PINNED_ANCESTRY_REQUIRED')
    for path, (ours, theirs) in PINS.items():
        require(text('rev-parse', head + ':' + path) == ours, 'SOURCE_BLOB_CHANGED')
        require(text('rev-parse', MAIN + ':' + path) == theirs, 'MAIN_BLOB_CHANGED')
    for path, blob in REPAIRS.items():
        require(text('rev-parse', head + ':' + path) == blob, 'REPAIR_BLOB_CHANGED')
    for path in ARCHIVES:
        require(not Path(path).exists(), 'ARCHIVE_MUST_BE_NEW')
    source_migrations = text('rev-parse', head + ':supabase/migrations')
    source_scripts = text('rev-parse', head + ':scripts')
    result = git('merge', '--no-commit', '--no-ff', MAIN, ok=False)
    require(result.returncode == 1, 'EXPECTED_CONFLICTED_MERGE_REQUIRED')
    require(text('rev-parse', 'MERGE_HEAD') == MAIN, 'EXACT_MERGE_PARENT_REQUIRED')
    conflicts = set(text('diff', '--name-only', '--diff-filter=U').splitlines())
    require(conflicts == set(PINS), 'EXACT_SIX_CONFLICTS_REQUIRED')
    for path, blob in ARCHIVES.items():
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(git('cat-file', 'blob', blob).stdout)
    for path in ('.agent-memory/completed-work.md', '.agent-memory/session-log.md', '.agent-memory/verification-matrix.md'):
        base = git('show', BASE + ':' + path).stdout
        ours = git('cat-file', 'blob', PINS[path][0]).stdout
        theirs = git('cat-file', 'blob', PINS[path][1]).stdout
        Path(path).write_bytes(append_history(base, ours, theirs))
    Path('.agent-memory/current-state.md').write_text(CURRENT)
    Path('.agent-memory/checkpoint.json').write_text(json.dumps(dict(
        project='gridex-ops-platform', updated_at='2026-09-15', status='IN_PROGRESS',
        current_state='.agent-memory/current-state.md', main_merged=False,
        next_action='Inspect full permission clone run35025303437; satisfy native/schema/generated-type/final CI gates before PR310 main merge.'), indent=2) + '\n')
    path = 'lib/ediel/core/messagePolicy.ts'
    ours = git('cat-file', 'blob', PINS[path][0]).stdout
    theirs = git('cat-file', 'blob', PINS[path][1]).stdout
    require(ours == theirs + b'\n', 'CODE_MUST_DIFFER_ONLY_BY_TRAILING_NEWLINE')
    Path(path).write_bytes(theirs)
    git('add', '--', *PINS, *ARCHIVES)
    require(not text('diff', '--name-only', '--diff-filter=U'), 'UNRESOLVED_CONFLICTS')
    tree = text('write-tree')
    require(text('rev-parse', tree + ':supabase/migrations') == source_migrations, 'MIGRATIONS_MUST_BE_UNCHANGED')
    require(text('rev-parse', tree + ':scripts') == source_scripts, 'SCRIPTS_MUST_BE_UNCHANGED')
    require(text('rev-parse', tree + ':' + AUDIT) == text('rev-parse', MAIN + ':' + AUDIT), 'MAIN_DELIVERY_AUDIT_REQUIRED')
    changed = set(text('diff', '--cached', '--name-only', head).splitlines())
    require(changed == set(PINS) | set(ARCHIVES) | {AUDIT}, 'MERGE_SCOPE_CHANGED')
    git('diff', '--cached', '--check')
    for path in ('scripts/test-canonical-permission-full-seed.py', 'scripts/test-canonical-full-permission-clone.py', 'scripts/test-canonical-permission-native-fixture.py'):
        subprocess.run(['python3', '-B', path], check=True)
    git('commit', '-m', 'merge: reconcile pinned main into PR310 without discarding remediation history')
    require(text('show', '-s', '--format=%P', 'HEAD').split() == [head, MAIN], 'TWO_EXACT_PARENTS_REQUIRED')
    require(not text('status', '--porcelain'), 'CLEAN_MERGE_REQUIRED')
    print(json.dumps(dict(outcome='MAIN_INTO_FEATURE_ONLY', source=head, main=MAIN, merge=text('rev-parse', 'HEAD'),
                         migrationsUnchanged=True, sourceScriptsUnchanged=True, offlineTests=28, mainModified=False,
                         fullReleaseAccepted=False, productionModified=False)), flush=True)


if __name__ == '__main__':
    run()
