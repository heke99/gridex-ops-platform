# F3-F — publication and actual-module qualification

Date: 2026-09-17. Status: final ordinary PR CI required, NOT merged here.
PR326 branch `codex/ediel-v2-prodat-party-fields-20260917` is based on main
`2d65dc9fdc66738cc66984ec91350adace34eb0d`. Initial published head
`aadcd597ba59817d6396900f5e8409ed1efeaa09` exactly matches reviewed tree
`e3b2a640bc65ce492109ebcba714149e9ff95aa5`. The earlier f3-party-fields.md
is a historical prepublication snapshot, not current CI/merge status.

## Publication and dependency provenance

Initial transfer35221393608 validated exact source but GitHub rejected the
workflow-changing push because Actions lacks workflows permission. No rights
were expanded: the retry retained the existing workflow, published code only,
and the authorized GitHub connector then added the reviewed permanent NAD step.
This produced the exact reviewed full tree. All transfer files/workflows remain
on an isolated helper branch; none are in PR326/main. Their status is not a
qualification certificate.

Ordinary initial OPS35221728741 passed application/script/test types, lint,
mechanical and quality tests, migrations, service-role/RBAC-related regressions
and existing-main clean replay, then failed the full application tests.
Ediel35221728844 stopped in the actual characteristic consumer step. FullE2E
smoke artifact10497432393 independently reports15/15pass; ZIP SHA256
`5e88440d24cba5013e797bc8f895875009e886cb3a472c78630b6a6500da725c`
was downloaded and verified. The initial full PR was NOT approved.

For exact local reproduction, read-only dependency run35221766282 installed
`npm ci --ignore-scripts` at the initial head and retained dependency bytes.
Artifact10496783500 ZIP SHA256
`9efe8762508b0ff6e80c95b1a16d7d744f4d104f745bd3d510d2479462424dd2`
and its inner SHA256SUMS were verified before safe extraction. Its package-lock
bytes exactly match this repository (SHA256
`88f4f36c97b4896442c3ce9cb837ea7f93a0fee55e6b63b477421b33b4b73d6b`).
No credentials, DB or external market service were involved. Dependency
installation itself is not a test result.

## Actual failures and corrections

Full actual-module Vitest on the exact initial tree produced1334pass/6fail of
1340 tests in209 files (local JSON SHA256 `f3518f4764f270939344b25a28cc70066f5ddbd7b30862a9b941fd15b14ea1e2`).
The causes were investigated rather than suppressed:

1. The characteristic consumer fixture still expected a cached customer name
   despite nonempty wire with no UD. Its product assertions are unchanged;
   source absence now remains null, with an additional independent positive
   wire-party case and explicit structured-only legacy fallback assertions.
2. The new policy test omitted the existing mandatory inbound application
   reference and a required NAD+Z02. The positive fixture now supplies the
   source party and passes the actual parsed reference into the real policy.
   No policy requirement was removed. This exposed an actual reader defect:
   with alternate UNA syntax the canonical parser lost technical UNB parties,
   application reference and UNH version. Two cases reproduced that loss before
   the code correction. PRODAT now reads these values from raw structured
   components exactly once using its UNA, separate from legal NAD FR/DO.
   Three additional route-component tests and three missing/composite-reference
   negative tests cover each syntax. Other families' selection semantics remain.
3. The new compatibility-builder fixture omitted existing required CCI data.
   It now explicitly supplies reasonZ22; all original NAD assertions remain.
4. The older *synthetic* customer-journey fixture passed unsupported customer
   qualifierZ01 for a personal number and omitted available installation data.
   It now uses explicit SE2 and copies site fields from its validated synthetic
   application, never from UD. Existing journey assertions remain; exact UD/IT
   assertions were added. The invalid Z01 input is explicitly rejected in the
   actual renderer test. No original normative or TGT fixture was changed.

The permission mock now records source-company, environment and reverse
sender/receiver filters and supplies opposite-direction candidate metadata.
It remains an explicit in-memory database boundary, not a live tenant test.

## Executed final local evidence

- Full application Vitest:1347/1347pass in209 files, including50 actual-module
  NAD consumer cases (included in the total, not additional). Local JSON SHA256
  `dde057236960093233024123e49a9902642c192e8a15bb5e20d796b55cc79640`.
- Source regressions848/848pass (264NAD +584 retained); original final unchanged-
  base264-case reproduction30pass/234fail remains in the preceding audit.
- Immutable specification33files/121rules/231contracts, unchanged large-source
  budget and diff checks pass. Final local application/script/test TypeScript
  and changed-file ESLint pass with exit0. The synthetic application includes an
  explicit required-site guard; optional schema fields are not blindly asserted.

These results do not substitute for final ordinary exact-head OPS, Ediel,
Browser/Quality and FullE2E checks, including build/security/budgets/replay.
Keep the PR draft until those checks and source/review inspection pass; merge
only with the expected head guard and reread actual main/PR state.

## Scope and remaining gates

This qualifies only the20 mapped NAD fields and identified consumer corrections.
The earlier source-backed BGM/RFF/characteristic rules are preserved. Raw party
projection is evidence, not a legal-ID/actor-registry assertion; admin-reviewed
staging application and live market acceptance remain outside this unit.
Full74fields,110D, register2+, full grammar, F0/F2/F4–F7 and whole-plan approval
are not asserted. PR310 remains paused/e9611351; no SQL/generated types/provider
proof machinery, grants, production mutation, explicit deployment or external
message was included. Next independent item after qualified merge is DTM.
