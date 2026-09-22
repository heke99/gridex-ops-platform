"""Recover only byte-verified E035 database work; never replace application code."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

BASE = 'bc6085e192bbab4da50b9db9d47bb27b73178b87'
PREP = '4a502344e3fce5824eee52aee6d744e4abc3fde9'
MIGRATIONS = ['20260922144906_ediel_source_object_decisions.sql',
              '20260922150922_ediel_source_decision_snapshots.sql',
              '20260922152602_ediel_register_message_line_scope.sql']
AUDIT = 'quality/audits/ediel-masterplan-v2/e035-source-ledger/resume-db-qualification-20260922.md'
NEXT = ('Qualify and publish recovered database continuation in existing PR370; '
        'complete exact-head ordinary CI and independent whole-PR review. '
        'Recover or implement missing runtime tenant/party/business disposition owners, '
        'then timeline/supersession/E61/E62. Preserve existing facets. No checkpoint merge.')
STATUS = '''# E035 recovered database continuation — 2026-09-22

PARTIAL / NOT MERGE-READY. Active PR370, codex/e035-durable-source-ledger-20260922.
Resolve the current candidate from the containing Git commit and live PR metadata.
Last verified published baseline: bc6085e192bbab4da50b9db9d47bb27b73178b87,
ordinary OPS run35741940986, all three jobs PASS. Main/accepted PR369 remains
 eb2b8693130af8fa7976a93891b95973bc473b50.

Preserved implementations: immutable received originals/discovery/canonical evidence,
actual per-object register validation and explicit-time tenant identity provenance.
Recovered database work: immutable owner assessments, committed-availability witnesses,
bounded immutable decision snapshots and message-local LIN uniqueness via a forward
migration. This does NOT deliver full runtime source approval or E61/E62 selection.

Native run35747547629 at4a502344: 71 owner SQL checks, 61 register SQL checks,
retained suites and real concurrency/snapshot/role/budget probes PASS. The valid
multi-message LIN case failed before the correction and passed afterward. Repeated
schema/type bytes and artifact checksums were independently checked by the implementing
assistant, not an independent reviewer. New regressions are wired into ordinary replay.

The previously reported 5758-tests/347-files TypeScript continuation was not recovered
in this session. Neither pinned preparation source nor its native artifact contains it.
Do not claim those results were reproduced or that missing runtime code is published.
Application and test source from the 5565-test published baseline stays unchanged.
Full tenant/legal-party/business runtime dispositions, source approval,
timeline/supersession/E61/E62 remain incomplete. Exact-head final CI and independent
whole-PR/requirement/tenant-boundary review are mandatory. Green CI alone is not merge approval.

PR310 stays OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.
No PR310 source/proof infrastructure, hosted database, deployment or market message.
Native advisors retain the existing public.gridex_grid_owner_name_key mutable
search_path warning; this is not a globally clean advisor result.
'''


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    if len(sys.argv) != 3:
        raise SystemExit('usage: assemble_resume.py REPOSITORY VERIFIED_NATIVE_DIRECTORY')
    root, native = (Path(x).resolve() for x in sys.argv[1:])
    assert (native / 'source-commit.txt').read_text().strip() == PREP
    for line in (native / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        path = (native / name.lstrip('*')).resolve()
        assert path.is_relative_to(native)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    for a, b in [('database.types.ts', 'database.types.repeat.ts'),
                 ('schema/schema.sql', 'schema-repeat/schema.sql'),
                 ('schema/schema.fingerprint.json', 'schema-repeat/schema.fingerprint.json')]:
        assert (native / a).read_bytes() == (native / b).read_bytes()
    for name in MIGRATIONS:
        target = root / 'supabase/migrations' / name
        assert not target.exists(), 'refusing to rewrite existing migration'
        shutil.copyfile(native / name, target)
    for a, b in [('database.types.ts', 'supabase/database.types.ts'),
                 ('schema/schema.sql', 'supabase/schema.sql'),
                 ('schema/schema.fingerprint.json', 'supabase/schema.fingerprint.json')]:
        shutil.copyfile(native / a, root / b)
    path = root / 'scripts/migration-history-manifest.runtime.additions.json'
    manifest = json.loads(path.read_text())
    for name in MIGRATIONS:
        assert name not in manifest['files']
        manifest['files'][name] = hashlib.sha256((native / name).read_bytes()).hexdigest()
    manifest['files'] = dict(sorted(manifest['files'].items()))
    write_json(path, manifest)
    path = root / 'scripts/supabase-types-manifest.json'
    manifest = json.loads(path.read_text())
    manifest.update(generated_at='2026-09-22T15:31:41Z',
                    generated_with='supabase-cli-2.101.0-repeated-isolated-native-run35747547629',
                    sha256=hashlib.sha256((native / 'database.types.ts').read_bytes()).hexdigest(),
                    latest_migration=MIGRATIONS[-1],
                    latest_migration_schema_effect='Recovered E035 owner assessments, committed availability and bounded snapshots; forward message-local LIN correction. Runtime owner integration remains incomplete.')
    write_json(path, manifest)
    path = root / 'scripts/manual-inbound-tenant-graph-regression.sql'
    old = path.read_text()
    assert 'ediel-source-object-decisions-regression.sql' not in old
    path.write_text(old + '''
-- E035 recovered immutable owner decisions; independent rollback, synthetic data only.
\\ir ediel-source-object-decisions-regression.sql

-- Fixed disposable localhost only; real committed-owner visibility and bounded snapshots.
\\! python3 scripts/ediel-source-object-concurrency-regression.py
\\if :SHELL_ERROR
  do $$ begin raise exception 'SOURCE_OBJECT_CONCURRENCY_FAILURE'; end $$;
\\endif
''')
    for name in ['current-state.md', 'current-task.md', 'handover.md', 'open-blockers.md', 'work-plan.md']:
        path = root / '.agent-memory' / name
        old = path.read_text()
        path.write_text(STATUS + '\nNext action: ' + NEXT + '\n\nSee ' + AUDIT +
                        '\n\n## Historical records — superseded where contradicted above\n\n' + old)
    path = root / '.agent-memory/checkpoint.json'
    checkpoint = json.loads(path.read_text())
    checkpoint.update(updated_at='2026-09-22', status='PARTIAL', current_audit=AUDIT,
                      next_action=NEXT, last_verified_pr_head=BASE,
                      ordinary_final_head_ci='PENDING_EXACT_CURRENT_CANDIDATE',
                      independent_review='PENDING_CURRENT_WHOLE_PR_REVIEW',
                      full_source_disposition='INCOMPLETE_RUNTIME_OWNER_INTEGRATION')
    checkpoint['source_state'] = {'baseline_git_sha': BASE, 'candidate_sha': 'RESOLVE_CURRENT_GIT_HEAD',
                                 'scope': 'RECOVERED_DATABASE_ONLY_RUNTIME_UNCHANGED'}
    checkpoint['ordinary_baseline_ci'] = {'head': BASE, 'ops': 35741940986, 'status': 'SUCCESS'}
    checkpoint['recovered_database_continuation'] = {
        'source_head': PREP, 'native_run': 35747547629, 'artifact': 10704336133,
        'artifact_sha256': '08632ba2f85b11a1b13e0b9e5bffee09797f049bf058e5f40003b08ce41d44f7',
        'native_result': 'PASS_NOT_FINAL_PR_CI', 'object_sql_checks': 71, 'register_sql_checks': 61,
        'new_migrations': MIGRATIONS, 'reported_5758_runtime': 'NOT_RECOVERED_NOT_REVERIFIED',
        'repeated_native_contracts': 'BYTE_IDENTICAL',
        'known_advisor': 'existing public.gridex_grid_owner_name_key mutable search_path'}
    write_json(path, checkpoint)
    evidence = '''
Native artifact10704336133 ZIP SHA256:
08632ba2f85b11a1b13e0b9e5bffee09797f049bf058e5f40003b08ce41d44f7.
Source4a502344e3fce5824eee52aee6d744e4abc3fde9. Native source-commit,
SHA256SUMS and repeated generated outputs match actual downloaded bytes.
Register red: 60 PASS / 1 deliberate FAIL (two-unh-local-line-zero-stored-unavailable).
After the authentic forward: 61 PASS, including same-message and global segment
negative cases. Owner SQL: 71 PASS. Retained suites: 62 received-PRODAT,
84 context, 105 ledger, 64 discovery-shape; three real context upgrade probes.
Real concurrency proves blocking, immutable predecessors, distinct committed
availability, saved snapshot membership, tenant/role rejection and 128/129 budget.
Tenant invariants, schema-parity drift probes and private-schema lint PASS.

All three migration filenames came from the actual pinned CLI preparation; native
artifact bytes are reused, not handwritten filenames or rewritten historical SQL.
Only scoped runtime manifest additions and authentic schema/type output are adopted.
Full runtime source/party/business owner integration is NOT established here.
The isolated resume workflow must verify the assembled candidate; its terminal run
and artifact receipts are recorded in PR370 discussion. Ordinary exact-published-head
CI and independent full review are still required. No checkpoint-only merge.
'''
    path = root / AUDIT
    assert not path.exists()
    path.write_text(STATUS + '\n## Provenance and evidence limits\n' + evidence)
    for name in ['verification-matrix.md', 'session-log.md']:
        path = root / '.agent-memory' / name
        path.write_text(path.read_text() + '\n\n## Recovered E035 database continuation — 2026-09-22\n' +
                        'Native run35747547629: 71 owner / 61 register SQL PASS, real concurrency, repeated contracts.\n' +
                        'This is not full runtime approval or final-head CI. See ' + AUDIT + '.\n')


if __name__ == '__main__':
    main()
