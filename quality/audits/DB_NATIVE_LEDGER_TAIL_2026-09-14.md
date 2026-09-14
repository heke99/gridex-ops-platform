# Native historical ledger EOF correction — 2026-09-14

Status: IMPLEMENTED, native result pending. No full replay or release acceptance.
Base: b3c371c852be3d1838e093bb7fd5698bbd56063a.

The saved first43 patch was already published in1250a544/59313510. The latest
logging-route fix b3c371c reaches the first historical ledger comparison. OPS
run34848295774 artifact10349061715 reports PrefixError at ordinal1/command50,
zero verified historical inputs, and verified resource/private-input disposal.
It does not contain the specific PrefixError code.

## Reproduced cause and minimal correction

Official Supabase CLI2.101.0 source apps/cli-go/pkg/parser/token.go retains a
nonempty comment-only EOF token in SplitAndTrim. pkg/migration/file.go stores
all those fragments in the migration ledger. The pinned first Gridex source
contains93 executable statements and a final separator comment, yielding94 CLI
fragments. The old verifier rejects that final exact comment as non-SQL.

The correction requires the exact suffix from the pinned source bytes, at the
final position, then compares every executable statement as before. Missing,
changed, extra, reordered or executable replacement tails fail. The original
SQL, CLI programs, transaction boundaries and source hashes are unchanged.

The parent now reports only finite allowlisted codes from the exact loaded
PrefixError class. Arbitrary exception values, subclasses and multi-argument
payloads remain private. Failure, cleanup and acceptance behavior are unchanged.

## Verification

Red regressions reproduced the missing errorCode and the actual first source's
comment-tail rejection before implementation. After correction:30 prefix,
15 lifecycle,14 bootstrap and8 new ledger/error regressions pass (67 tests).
All601 migration files/505 version groups pass immutable checksum verification.
Git diff whitespace checks pass. Database/CLI calls in these local fixtures are
simulated; they are NOT evidence that any historical SQL executed natively.

Primary upstream source blobs at supabase/cli tag v2.101.0:
parser/token.go db008434246be335b9f7abaf0cb66a99a2b40378;
migration/file.go540c129e3311f7602553218f9fcfe566aaee3a84.
Native proof must come from the new ordinary OPS clean-migration-replay artifact.
Even successful first43 remains blocked at
NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED until the later source groups,
full schema/ledger/types and all mandatory release checks pass.

## Skill routing and scope

Systematic debugging, test-driven development, differential review and
verification-before-completion apply to this bounded verifier repair. Supabase
skill governs genuine CLI ledger and private isolated runtime checks. Variant
analysis covers EOF presence, absent final semicolon and tampered fragments.
No application authorization, hosted schema, deployment, UI or API mutation;
UI/performance/production migration skill groups are not triggered. Merge review
becomes relevant only after full release verification. No temporary publisher.
