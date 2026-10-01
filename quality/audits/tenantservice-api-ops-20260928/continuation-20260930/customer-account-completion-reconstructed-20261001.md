# Reconstructed native account completion — 2026-10-01

This is new implementation in the isolated `gridex-next10-account` worktree, based on published `0778df202b8b46d4ae92a51ffcc24cc25176edaa`. It is **RECONSTRUCTED**, not recovered unpublished bytes. The lost packet's 18/8 results and former manifest identities remain historical evidence; they are not acceptance of these files. Root alone owns schema/generated types/checksums/workflow/memory/index/publication. Nothing here is staged, committed or published, and this report is not a freeze declaration.

## Intended result and preservation

The old positive Action separately inserted an account, approved claim and event. Against the actual canonical claim table, its legacy column projection raises `42703` after the account is saved. The new positive Action calls one service-only `SECURITY INVOKER` command. It stores the native account, canonical approved claim metadata, canonical event payload and append-only completion receipt in one transaction. A failure at any of those stages rolls back the new account too.

Root chose stable effect `(company, customer, native user)` plus exact stable body/source/resource facts. `creating_session_id` is immutable provenance. Every creation and replay independently verifies the **current** session at entry and after the last potentially waiting write. A different genuinely current session of the same user may reuse the sealed effect; no old session supplies authority. The existing narrow `private.gridex_support_session_active_v1` and `private.gridex_invoice_redelivery_auth_email_v1` are reused without Auth-table grants or invented OPS membership. The current confirmed email and its confirmation timestamp are compared at entry/final.

The existing source matcher remains an outer preselection. SQL checks every actual matching normalized PN candidate in the requested slug, or globally when the slug is empty. It does not inherit customer `limit(10)` or point `limit(1)`. Current company/customer/contact/site/point facts are read under ordered row locks and hashed before evaluation and after the final write. JS-compatible NFKD normalization is reproduced without broader `unaccent` transliteration. Both non-null point-site aliases must identify the selected company/customer's site; a null point customer is accepted only through that exact stored site relation. Archived customer status/`archived_at` and selected-site `archived_at` hold the command. No active supply/contract requirement is invented.

Existing accounts are read through both aliases before status filtering. Disabled, inactive, portal-only or ambiguous relationships cannot become a new owner. Existing native billing/viewer/owner relationships without this receipt are returned unchanged, without retroactive approval/history. New native accounts preserve the published `user_id` binding and null external `portal_user_id`; existing distinct aliases are not rewritten. Only an actual account INSERT `23505` permits current exact native-row readback, with no approval or completion receipt for a competing existing relation.

Replay checks the current tuple, status, aliases, valid current role and saved verification binding, plus the current claim/event rows and their sealed hashes. A legitimate later current role change is preserved; the creation's owner role is not returned as present authority. Within-command row/cardinality changes, changed intended approval/event facts, and changed server-derived created evidence cause rollback. Saved claims use exact numeric `schemaVersion: 1`, `source: native_account_completion_reconstructed_v1`, legacy-concept metadata keys, name/email/installation facts and PN last four. The receipt contains UUID provenance and hashes, never full PN, passwords, raw Auth claims or tokens.

The receipt has SELECT/INSERT only for the existing service role, forced RLS, a unique effect tuple and an immutable UPDATE/DELETE trigger. It has no new restrictive/cascading graph/Auth/session FK, as explicitly adjudicated by root to preserve the existing test-only harddelete contract. Deleting any account/claim/event graph invalidates replay and recreation; the immutable receipt does not resurrect it. Prepared native cleanup removes its owned account/claim/event/site/customer/Auth rows, while retaining the synthetic company, any actual trigger-seeded published legal children, and ID/hash-only receipts until disposable-stack destruction. It does not delete the company through the canonical immutable published-legal cascade or disable that guard. This is a source-qualified cleanup precaution; no native cleanup has executed here.

`ClaimCustomerForm` and the Action's `{ok,message}` contract are unchanged. Root explicitly chose generic `{ok:false,message:DEFAULT_ERROR}` for known command errors. Unexpected errors and installed Next control-flow signals still propagate. Ordinary postcommit cache faults retain the saved relationship and mounted redirect.

## Fresh RED and measured GREEN

| Boundary | Actual fresh observation | Latest measured outcome |
| --- | --- | --- |
| Exported Action with controlled outer Auth/persistence/cache | Initial 6 cases: late claim/event failure and retry gave 3 RED, 3 controls | New Action/session-helper/adapter suite: **15/15 PASS** |
| Canonical PostgreSQL and actual published old Action | Actual `42703` at legacy approved-claim INSERT; account count **1**, required **0** | Preserved as one explicit old-bug characterization; it does not certify old bytes corrected |
| Actual first reconstructed SQL late receipt hook | Event changed after its RETURNING seal; account count **1**, required **0** | Common final graph seal rejects it and rolls back |
| Actual first reconstructed archived source cases | Archived customer and archived selected site each left account **1**, required **0** | Both denied without a new graph |
| Actual reconstructed BEFORE INSERT intended-fact rewrites | Claim status, event type and account role: **3 RED** | All three roll back at SQL final intended-fact checks |
| Actual reconstructed BEFORE INSERT evidence rewrites | Claim metadata, account verification snapshot and event payload: **3 RED** | All three roll back against server-derived intended evidence |
| Explicit controlled preservation mutation | Changed creation alias + omitted mounted evidence: **2 RED** | These are mutation controls of current reconstructed SQL, **not** pinned old/lost source or native evidence |
| Compiled PostgreSQL business suite | Canonical table/normalizer DDL, authentic relevant unique indexes/composite FKs and extracted unchanged current Auth helper bodies | **28/28 PASS** = 27 current business cases + 1 old published-bug characterization |
| Existing role compatibility suite | Original outer fixture had no getClaims/new RPC: **8 FAIL / 6 controls** against new caller | Root-authorized fixture adaptation: **14/14 PASS**; all role/tombstone/current-row/23505/no-history/legacy-sync assertions retained |
| Native GoTrue/PostgREST | Four functional cases prepared, not run here | **NOT_EXECUTED, 0 native PASS** |

The 28 PostgreSQL cases include late claim/event rollback and successful retry, expected evidence, sealed replay under a second current same-user session, retained original creating-session provenance, preserved legally changed current role, pre-existing billing/viewer rows, disabled/inactive/portal-only/ambiguous aliases, deleted account/claim/event no-resurrection, changed stable body/source revision, legal cross-tenant point ambiguity hidden by outer `limit(1)`, conflicting point aliases, archived source denial and an observed late receipt wait followed by final real clock expiry rollback.

The expiry case has an owned nontransactional sequence proving the receipt wait was reached, then `pg_sleep(1.3)` across a real one-second session deadline. An earlier 20-PASS/1-FAIL run did **not** reach its 0.2-second wait and was a fixture failure, not expiry acceptance. The Action module is now loaded before deadline scheduling; no database clock is overridden. Earlier provisional ambiguity proof used an impossible same-company duplicate without canonical unique indexes. That receipt was withdrawn; final proof installs the actual indexes and uses legal cross-company duplicates with empty slug. No impossible seed counts as canonical acceptance.

The local PostgreSQL harness deliberately uses small synthetic company/Auth parent tables and current extracted helper functions. It is PGlite actual PostgreSQL execution, not full Supabase replay, genuine Auth issuance, RLS/ACL acceptance, real concurrent connections or native runtime. Quiet-company source hashes are computed by PostgreSQL before JSON parsing over the installed business tables; absent financial tables in this bounded harness cannot certify a production financial graph.

## Prepared real native boundary

The exact paths use **hyphen** `-native`, not `.native`:

1. `scripts/customer-account-completion-reconstructed-20261001-native.config.ts`
2. `scripts/customer-account-completion-reconstructed-20261001-native.test.ts`

The configuration refuses non-CI/non-disposable status and requires the exact local API URL. The fixture creates an owned user through local GoTrue, signs in normally, and derives user/session from actual successful `getClaims` plus `getUser`. No raw `auth.sessions`/Auth-user row or verified result is fabricated. Only the request-cookie and cache transports are controlled; the exported Action, current session helper, existing service client, actual PostgREST RPC and installed schema/triggers execute.

The four prepared cases are late claim rollback, late event rollback, concurrent same-user/current-session completion through actual concurrent PostgREST calls, and a genuine new-login/current-session replay. An exact PostgreSQL-side text/hash snapshot covers every other public row, including all financial tables and rows without `company_id`; only the fixture's expected account/claim/event rows are excluded. All fetches are constrained to HTTP loopback port 54321 with `redirect:'error'`, including genuine Auth/service calls. No hosted provider or live Auth/storage communication is authorized by this packet.

Native expiry is **not** one of the four prepared cases; real-clock expiry is currently the bounded PostgreSQL business proof only. Genuine Auth-cookie/mounted browser execution and a real old-writer-versus-new-command INSERT race are also not executed or claimed.

## Commands and source scope

From this isolated worktree, using the existing locked Node 22/dependencies:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/customer-account-completion-reconstructed-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/customer-account-role-preservation-20261001.config.ts
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/customer-account-completion-reconstructed-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /workspace/scratch/b08749f7eca6/account-completion-reconstructed-typecheck-20261001.json --pretty false
```

Six explicit TS entrypoints plus their imported dependencies passed scoped TypeScript. TS caller/adapter/units/native/config/role-fixture lint passed; both standalone CJS files passed explicit `--no-ignore` lint and Node syntax checks. `git diff --check` passed. No broad root typecheck, native Auth/DB execution, provider traffic, staging, commit or publication is performed here. Native invocation for root wiring is `vitest run --config scripts/customer-account-completion-reconstructed-20261001-native.config.ts` with the existing disposable status/private environment.

Skill routing: applicable repository AGENTS/current memory/domain sources, systematic debugging, TDD/testing, verification, spec-to-code, planning, and Supabase/PostgreSQL least-privilege/lock guidance were read. Root's isolated ownership and publishing instructions override shared-memory/delivery defaults. UI/provider/credential/hosted-deployment workflows are outside this packet.

## Explicit remaining outcomes

- **PENDING genuine native CI:** the four prepared cases and full installed-schema/grant/concurrent runtime boundary. Local counts cannot close this.
- **OPEN internal manual/rejected writer:** the existing rejected/manual `insertClaim` still uses canonical-absent legacy columns outside this positive-completion repair. Its policy/inputs are unchanged, but actual `42703` compatibility needs a separate bounded correction rather than an external blocker.
- **OPEN in this base / separate owner:** the original admin claim/account read projections ask canonical-absent fields. Requirements peer reports a separate versioned metadata projection implementation with controlled-read/SSR results; it is not silently included in this worktree or these counts.
- **PENDING real legacy-writer race:** SQL has genuine-23505-only exact-row readback and the adapted role suite preserves the controlled competing viewer/disabled/missing outcomes. The native four cases cover new-command concurrency, not an independently executed legacy-producer collision.
- **PENDING mounted Auth-cookie/browser evidence:** native uses real GoTrue behind controlled cookie transport. Unchanged mounted Form contract and actual Action tests do not substitute for an actual mounted browser journey.
- **Qualified concurrency:** effect/matching advisory locks serialize this command, existing matching rows are locked and full candidate hashes bracket evaluation/final writes. Unrelated historical/raw writers do not share the matching advisory key; this is not a claim of predicate locking or global SERIALIZABLE isolation. A new unrelated matching resource can still be inserted after the last final resource read. No whole-masterplan or broad API/tenant/OPS acceptance is asserted from this bounded packet.
