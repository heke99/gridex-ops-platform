# Native historical ledger EOF correction — 2026-09-14

Status: PUBLISHED AND NATIVE-VERIFIED THROUGH26. Prefix43/full replay remain blocked.
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

## Genuine native result after publication

Code30e5404ceeb73313e41dc906d7a8f415632f4813, exact tree
07cf86ee69718b605fc4563fce9c809b9e7fecdf, was published directly through Git data
with no temporary publisher or forced ref. Ordinary OPS run34855261138,
clean job104013056268, artifact10353410024. Downloaded ZIP SHA256:
2403774ea03858aca576b6d313d60087e826ed98107485546fa1c8ebe40c0005.

The genuine CLI run verifies original source/program/ledger statements for
foundation ordinals1 through26. The comment-tail defect is no longer blocking
ordinal1 or2. Safe diagnostic reporting now preserves NATIVE_HISTORICAL_SQL_FAILED.
The original synthetic ledger, idempotence and failed-migration rollback also
pass; owned cleanup, historical private-input disposal and workspace removal
are all true. No hosted database was used or changed.

Next actual stop: ordinal27,
migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql,
original SHA256 b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6.
The derived program transfers its outer BEGIN/COMMIT to CLI batch transaction
handling, but contains a top-level LOCK TABLE. Native PostgreSQL returns25P01
(no active SQL transaction). The failed unit leaves the preceding genuine
ledger unchanged; it is NOT counted as executed or verified. Its intended
transactional locking/timeout semantics must be qualified before changing this
execution boundary. Do not remove the lock or put COMMIT ahead of ledger
registration merely to pass. This repair is NOT implemented by this commit.

Additional offline differential test across all43 programs accepts only the
three intended comment-tail cases (ordinals1,2,35) relative to the original
verifier;330 missing/replaced/duplicated-fragment mutations are rejected.
These are offline fixtures, separate from the26 genuinely executed units.

First43 ledger acceptance remains false, full144/514 replay is false, generated
types remain unverified and the ordinary OPS job remains a FAILURE. Existing
schema/auth-email/type/E2E blockers are not waived. Continue from ordinal27's
native transaction boundary, not from the old publication or logging blockers.
