# PR368 — corrected reader and final acceptance checkpoint

Status: IMPLEMENTED_NOT_VERIFIED for the complete delivery. This documentation-only child of a33176be2e189ea57ad1f4711d53ad9da6734bb8 changes no code, test, dependency, source manifest, workflow or schema. Fetch its actual published head for the final CI and review. Accepted main remains PR367 / 5dc072d3127f386fb8a0a81ad5fbb34af290b4cf, with acceptance comment 5765219627.

## Corrections to the initial implementation and evidence

The initial 2d7ba744 implementation was not acceptable. Independent review 5766153924 identified an accidentally changed shared calendar month table and the mandatory no-control-regex lint error. The current date module restores the original twelve-month table; its only final production delta from main is the opt-in strict prodatMarketMinuteToUtc inverse. Three added calendar tests cover November 31 rejection, December 31 acceptance and month ends across ordinary and century leap years. These tests were published before the calendar correction; no separate pre-correction execution result is claimed here.

The identifier check now iterates character codes instead of using the lint-forbidden control-character regular expression. It preserves the same exclusions for codes below 32 and code 127, plus the existing exact-string, trim and length checks. No lint suppression or acceptance relaxation was added.

One newly introduced multi-message test originally concatenated a second UNA. That input raises edifact_dangling_release_character in the existing upstream parser before reaching the reader. The earlier blanket statement that all 77 failures were reader-boundary behavioral failures is therefore withdrawn. The fixture now concatenates two physical messages with one shared service advice, preserving its no-query/not_requested assertions. A separate added test retains the original repeated-UNA input and explicitly requires the upstream exception and no query/status/event/persistence/ACK/ingestion side effects. The production tokenizer and its rejection behavior are unchanged. The other published test assertions and all 5,222 pre-existing cases remain intact.

## Actually executed corrected-code CI

Ordinary CI on a33176be2e189ea57ad1f4711d53ad9da6734bb8 is terminal and successful: OPS 35644081641, PR E2E 35644081625, browser 35644081621 and Ediel regressions 35644081640. OPS quality job 106480162480 was read through final cleanup. Its npm test result is 5,303/5,303 tests in 330/330 files. The executed new inventory is 49 reader cases, 26 boundary/outcome cases, 3 deadline/cutoff cases and 3 calendar cases: 81 new plus 5,222 prior cases. The test result finished at 2026-09-21T19:22:15.834Z. The 45 quality tests, typechecks, API/RBAC, build and bundle checks also pass. Lint has 101 existing warnings and zero errors; it is not warning-free. OPS verify 106480162500 and clean-migration-replay 106480162618 are successful. Conditional production/staging checks are not promoted to certification.

These results establish the corrected code, not acceptance of this new documentation head or of an actual merge commit. No local repository-wide execution is asserted. Final independent rereview must inspect the corrected calendar, equivalent identifier predicate, fixture amendment and remaining reader/tenant behavior, rather than infer approval from green CI or the earlier source review.

## Preserved delivery boundary

The actual individual UTILTS processor obtains one batched tenantDb query of linked, received PRODAT candidates before transaction persistence. Stored byte hashes, legal parties, raw object/agency identities, strict PRODAT effective minutes and microsecond receipt cutoffs are checked. Query count, row budget and timeout prevent treating a truncated or late result as a complete candidate set. Diagnostics use existing normalized status/event/ingestion surfaces; national ACK/runtime and existing transaction RPC inputs are unchanged.

Every report still states universe=linked_received_sources, authorityStatus=not_established and selection=not_performed. Candidate acceptance is not_checked. Source hashing does not establish accepted context, complete discovery, completeness, supersession, transport authenticity or expected inventory. No E61/E62 comparison is enabled. The next unit must qualify accepted source context and complete dated source discovery/timeline before choosing authoritative structure.

## Finish and resume

Require unchanged ordinary CI and completed independent TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-PR review on the final head. Then expected-head guarded merge, fresh actual-main full 73/73 plus OPS, and inspect report rows, JUnit, hashes and actual merge binding. Save the final acceptance and continuation in this same PR; that receipt supersedes this pre-merge checkpoint without a receipt-only PR.

Skill routing retained: execution plan, TDD, direct root-cause and differential review, calendar variant/property controls, independent review and verification-before-completion. No UI, database migration, infrastructure, unrelated broad audit or deployment task. D110/110 plus parents10/10 remain accepted; full E035/F3/masterplan remain incomplete. PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, untouched and excluded. No live operations.
