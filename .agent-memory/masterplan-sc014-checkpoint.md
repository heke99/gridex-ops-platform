# SC-014 intake qualification — 2026-10-05

Status: FROZEN — four actual intake/admission qualification cases PASS. Bounded held-source result, not whole-scenario approval or a confirmed normative violation. No tag, coverage row, production change, commit, push, native/full execution or traffic.

## Isolation and ownership

- Branch: `codex/ediel-sc014-intake-qualification-20261005`.
- Exact base/HEAD: `9dc4a783a0c5e926596e3054a958c64e43efd490`.
- Worktree: `/workspace/gridex-masterplan-sc014`; existing node_modules linked from SC022. Parent explicitly requested this new isolation.
- Parent owns coordination/promotion/publication. SC014 qualification is reserved in #530 comment5986591063; SC055 is the other technical lane. Existing intake/P/SQL owners are retained.
- Current authorization: this checkpoint and, only after a genuine schema/trigger/admission path is identified, new `__tests__/ediel-sc-014-unattributed-reception.test.ts`. No existing product, SQL, helper or owner test edits.

## Instructions and skill routing

Read AGENTS.md, repository memory order, relevant Ediel memory and decisions/known-failures searches. The historical shared-memory baseline is superseded by the parent's precise current task; do not resume historical work or mutate shared memory.

- `using-git-worktrees`: isolated checkout at the explicitly authorized path; no native worktree tool exposed. Broad baseline tests are excluded by the parent's bounded/no-repeat instruction.
- `verification-before-completion`: exact read/source hashes and any executed result only; no inferred approval or green test claim.
- `spec-to-code-compliance`: full frozen literal compared with the actual producer/consumer paths; no broad audit or delegated workflow under this bounded assignment.
- `using-superpowers`: read; its SUBAGENT-STOP applies.
- `fp-check`: a violation must survive actual authority/caller/trigger qualification and direct reproduction before classification. TDD activates only if a genuine authorized behavior test is possible; no product repair is authorized.
- `supabase`: read the installed cloud skill for the finite Supabase transport/current PostgreSQL schema qualification. Read its current changelog index; no Supabase feature/API, remote DB, schema, advisor or deployment change was made. The relevant minor-release item concerns legacy encryption/index changes, not this existing SHA256 admission path. Native RLS remains source-reviewed, not claimed as exercised by the finite harness.
- UI/performance/cloud/deployment/broad scanners/refactors are outside this read-only intake qualification. No database performance, remote Supabase operation or deployment is requested.

## Entire frozen scenario

SC-014, Oattribuerbar mottagning:

- Given: Teknisk mottagning lyckas men legal/tenantkontext är oklar.
- When: MIME/EDI behandlas.
- Expected: Skyddad staging och källstödd teknisk fel-/kvittenshantering där säkert möjlig.
- Prohibited: Gissa inte tenant från första kundträffen; fabricera inte objektsfel på egen konfigbrist.
- Linked rules TEN-06/TEN-11 are context, not new whole-rule takeover. TEN-06 requires protected quarantine on unclear attribution; TEN-11 preserves prescribed technical ACK where safely possible and forbids E10/42/209 solely for local tenant/configuration failure.

Frozen inputs SHA256:

| File | SHA256 |
| --- | --- |
| `docs/ediel/masterplan-v2/registers/acceptance_tests.json` | `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10` |
| `docs/ediel/masterplan-v2/registers/rules.json` | `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8` |
| `AGENTS.md` | `9f1b78b4b99a7b1dfad26649ced506fd72667d5f619b113cac354b8ccad0fa96` |

## Retained owner reconciliation — completed atomic result

- Published primary full SHA: `0796a57181657d0c2b55dc4437f3ad5c6c8d88c3`.
- #491 owner comment5986326712 identifies unpublished `8490c349` as unresolved mailbox_message_id. No local object exists (`git cat-file -t 8490c349` failed); direct GitHub commits API returned HTTP422 "No commit found". No fetch by an ambiguous/shared FETCH_HEAD was used.
- Parent already queried the actual owner in #491 comment5986601894; do not duplicate that public question.
- Owner's direct reply5986603379, updated 2026-10-05 01:33:18Z: **8490c349 does not cover SC014**. It is one mailbox_message_id binding line in `lib/inbound-mail/inboundStatusUpdater.ts` plus a selector unit test, preventing a new unresolved mail being misclassified as protocol_duplicate. It changes neither null-company/no-environment intake, contract trigger nor technical ACK. SC014 is outside their unpublished scope; our lane owns qualification/any separately authorized seam fix. Preserve that one-line overlap when future integration follows491/side-branch merge.
- This is owner-attested scope, not byte-reviewed unpublished commit evidence. No full SHA/diff for8490 is available here. No new public comment was posted.
- `git diff --stat 9dc4a783... 0796a571... --` the eight listed intake/contract paths below was empty. The investigated bytes are identical at both exact public heads.

## Actual paths and qualification limits

- `storeInboundEmail` (`edielMailboxPoller.part-2.ts`) persists the actual MIME/EDI original, mailbox/environment, attachments and queued processing job. `processQueuedInboundProcessingJobs` runs `processInboundEmailMessage` and persists manual_review for a held result.
- `edielInboundProcessor.ts` resolves actual family-specific legal attribution before business matchers. Its unresolved branch calls `createUnresolvedInboundEdielMessage`, records manual_review and returns before outbound/point/customer matching.
- `inboundStatusUpdater.ts::createUnresolvedInboundEdielMessage` attempts a canonical message with company_id null; environment is not in that insert payload. On DB error it logs and returns null before source-linked unresolved/event inserts. This is a static seam fact, not alone a SC014 defect: raw-mail/parse/job staging remains.
- Current original `gridex_validate_ediel_message_contract` (`20260921224255`) explicitly rejects null company for canonical families. The later233000/234900 migrations alter only protected outbound reply basis requirements, not this inbound clause.
- `runInboundEdielMailEngine` runs the mail queue, lists actual created message IDs and then calls `processInboundEdielMessage`. The latter may use an independently qualified technical source endpoint, actual syntax and CONTRL before legal attribution; unresolved legal routing then returns before runtime/business work.
- Technical authority is source/message-bound: `gridex_ediel_technical_ack.capture_source` observes actual UNB receiver/environment against assigned technical identifiers/representation, and the V2 reader checks current actor/phase. It does not grant legal business attribution. Need now qualify whether the real mailbox/raw/parse path can safely obtain this authority without an admitted canonical source; do not accept a synthetic null-company DB row to bridge it.
- Existing `ediel-prodat-unresolved-tenant-matching.test.ts` calls actual staging/parser and asserts zero masterdata queries for null-tenant inputs, retained raw/message identity and tenant-scoped positive controls. It is not the full mailbox→current-contract admission chain.
- Existing `ediel-technical-syntax-basis-sql-regression.mjs` proves the actual technical owner with finite schema/legal/transport adapters, including a null-company source. It does not establish that the current full canonical contract admitted that source; no inference from its component positive.
- Parent-owned published OPS05 evidence already proves legal-identity read failure after actual technical authorization and the real mailbox catch's platform poll warning while preserving original/ACK. Reuse that result/scope; do not duplicate its test.

## Exact source SHA256

| File | SHA256 |
| --- | --- |
| `lib/inbound-mail/inboundStatusUpdater.ts` | `afa6c446e79913fa0925083938ee94e341d679aa93a0cfabb95997217a18523e` |
| `lib/inbound-mail/edielInboundProcessor.ts` | `3c8ffa29cd3faaffa7f1d51d2946f396a7e930471d7322912cb0943e38406c81` |
| `lib/inbound-mail/edielMailboxPoller.part-2.ts` | `28dca910c2051a5f4ee724395b8b4e929dfc07abebd693a57222e8e26b45a366` |
| `lib/inbound-mail/edielMailboxPoller.part-3.ts` | `a74090c31e69ed0e1fbeac3d4b8ec4011f1e7e8fc3f123af8438a9209c4cc07e` |
| `lib/ediel/flows/inboundProcessing.ts` | `8ea6ffc72ff5d2bcfab1e89979afd4f35f1d103ce09247578a5cf34c99f502b2` |
| `supabase/migrations/20260921224255_ediel_inbound_prodat_receive_context.sql` | `6a959ebee1af9759aeb224de4bc3a488116befd42a0208454b6dfe4e05022e2d` |
| `supabase/migrations/20261002233000_ediel_outbound_reply_creation_repairs.sql` | `61d8480a42364720a431c2f98a9d5cfd79c9cc6df7c18dcbe70f3721e239b738` |
| `supabase/migrations/20261002234900_ediel_contract_reply_basis_definer_port.sql` | `6144c7752e7b58cd4b8f62c32b101e077f8d8c92d24e581856b8a9f8fbab8c5d` |
| `__tests__/ediel-prodat-unresolved-tenant-matching.test.ts` | `d971ccf2cabe5eec9512afd4ebd6f3a1e7c3d0c53b59309720801162f67d8388` |
| `scripts/ediel-technical-syntax-basis-sql-regression.mjs` | `f06ea218c5bd0a40b3b807f388d6068e5e0f9b5e73d59f1c0192f3aa39dd1e5a` |
| `supabase/schema.sql` | `7f5b50a6d944dc32e176defddcff49f221d378a10565beba8eebb817ece51f51` |
| `lib/ediel/ack/technicalSyntaxAuthority.ts` | `fcebf7cddaa4652968f5a31887bbace2e44ae82befc6bb460894ee6078addd0e` |
| `lib/ediel/tenant/resolveInboundTenant.ts` | `0a4fee017c2633d8b34efbb59d3b06e45aede744d3ff9da6296a21a1ea8f29e8` |
| `20260930184410_ediel_protected_technical_contrl_source_basis.sql` | `c20ebe2fbc913c12ac3e007b99e575915ca1b61718c144f33aab03578445639b` |
| `20261001142520_ediel_technical_syntax_ports_current_actor_phase.sql` | `7ef393bb1a39f9d8378b27e26801f2e871a640a3608e5d64af48fcdbf334dce0` |

## Actual execution and effect/authority matrix

New owned file: `__tests__/ediel-sc-014-unattributed-reception.test.ts`, SHA256 `661bc59c2888b857f4582a5f13d09ca016ceaddc93a6c0d5ea8e779e933aa638`.

| Effect or contrast | Actual code/SQL and asserting result | Qualification |
| --- | --- | --- |
| Technical reception and unclear legal NAD | Real `storeMailboxFetchMessage` takes finite fetched MIME; actual store/parser/resolver processes source-owner Z04 wire with only NAD DO changed 54321→98765. Actual syntax is `ok:true`, directory grammar `qualified`. | Known technical UNB 12345:14→54321:14, production indicator; legal receiver98765 has no actual identifier rows. No parser/routing/classifier verdict stub. |
| Protected raw staging before admission | Actual writers persist MIME/EDI original, mailbox/environment, queued job and null-company parse; processing result/manual-review source retains complete raw bytes. Actual mailbox row remains byte/value identical. | Current source RLS enables both raw-mail/parse tables; parse policies are platform-admin-only and raw-mail authenticated restrictive select requires current session plus platform admin or tenant company. Those policies were read, not executed in this finite harness. |
| Current canonical admission barrier | Actual complete current `gridex_validate_ediel_message_contract` BEFORE trigger rejects the unresolved writer's company_id:null with PostgreSQL23502 `canonical_ediel_company_required`. Actual AFTER technical-capture trigger therefore creates no source. | Not a synthetic null-company success port, not a parser/protocol error. Writer's omitted environment would also use actual table default test; the company failure occurs first. |
| Engine source selector and raw/parse alternatives | Actual `listEdielMessageIdsForInboundEmails` returns[]; actual V2 technical endpoint reader returns null for both stored raw-mail UUID and real parse UUID. | The actual engine's downstream technical processor has no admitted message ID. Current protected reader has no raw/parse input path. |
| No first-customer guess or fabricated object error | Actual resolver returns company:null; actual parsed errorCodes=[]; no customer/site/point/permission/outbox query occurs. All five explicit finite business snapshots remain exact; no canonical/ACK row exists. | Business tables are finite external ports that throw if accessed. They are not native persistence or approval evidence. |
| Raw original has real distinguishable technical facts | Actual SQL envelope decoder returns production, original UNB sender/receiver/reference; its full tuple equals the positive known-company wire. Actual identity table contains one current54321 endpoint owned by the declared mailbox company/actor, no representation rows. | These are finite seeded actual-schema facts. They support a uniquely assigned technical receiver despite legal uncertainty; they are not an admitted immutable technical source or an authorization grant for the raw-mail UUID. |
| Positive endpoint control | Actual SQL insert of known-company Z04 with legal NAD54321 passes the same current contract, produces real database_insert receivedProdatContext and actual ready technical-capture row. Actual V2 reader returns technical_endpoint_only, authorizesBusinessEffect:false, current actor/prepare echo. | Direct actual insert of a declared known-company source; not the full resolved mailbox business path, ACK builder/send or native mandate. |
| Missing endpoint control | Remove only actual technical identifier; same actual positive source admission produces technical source held/ediel_technical_endpoint_unqualified; V2 returns null. | Refusal is caused by missing technical endpoint, not unrelated outbound/registry/syntax readiness. |
| Missing actor control | Same actual ready endpoint, actor999 absent from current profile/membership/finite permission service: actual require_actor rejects42501 `ediel_technical_ack_current_actor_required`. | Current company/profile/membership production checks execute. Only named permission service is finite; no live actor grant claimed. |

The suite executes extracted bytes from the committed current schema: actual full table DDL for intake, canonical message, identity, mailbox and actor tables; current canonical BEFORE trigger and technical AFTER trigger; existing lexer/envelope/capture/read/current-actor functions. It also loads the actual retention helper and its actual table/content function so current production trigger expressions resolve without replacing a verdict. Unrelated native triggers/FKs, all RLS policies and full schema are intentionally not installed: this is current admission/source qualification, not native/full database validation.

The ONLY declared SQL function ports are SHA256 digest (`extensions.digest(bytea,text)` uses actual PostgreSQL sha256; no admission logic) and `gridex_actor_has_company_permission` (true only for declared actor/company/communication.write). The TS Supabase adapter executes actual SQL for all declared accesses. Plain unencrypted MIME takes the actual existing S/MIME no-encryption branch; no IMAP connection, transport, SMTP, ACK builder or external contact executes.

All seven decisive executed function definitions are byte-identical to published primary0796a571:

| Function | Extracted byte SHA256 |
| --- | --- |
| `public.gridex_validate_ediel_message_contract` | `6473d330799cb3b59b42e12b8b25c9617e30b557decde8e5e39b8e4ec08595a8` |
| `gridex_ediel_technical_ack.capture_source` | `225074c8ab5074dccaf4b65a60290e025d1068cfde43d7f93c1d2a2d6fdd9d7a` |
| `gridex_ediel_technical_ack.envelope` | `ac94394a304fcf02a252ae3c0b528d048e98e8e4c501a5f0791ec3daa95720cc` |
| `gridex_ediel_technical_ack.read_endpoint_v1` | `2eabb09149b65b40b17755e296d0db121d98244088e2c88735ee649911935ca3` |
| `gridex_ediel_technical_ack.require_actor_v1` | `3d57b81f4b850a56dbbccc441f0aa9a9e2413bfcc105f5291d16257133c88406` |
| `public.ediel_read_technical_source_endpoint_v2` | `c5ae48f49a997da3a74f1c8145dfdad84dace1a6abc33e14654176e698a316c8` |
| `gridex_utilts_binding.wire_tokens_v1` | `515e76d92c3e50875c6ee6b06c22a6b2d32a46a4dc5f3037eb0a52da85985270` |

## Commands, results, false positives and exact next action

- Created only the requested isolated worktree/branch from9dc and symlinked dependencies; initial status clean. Final status has exactly own new test/checkpoint.
- GitHub read: `gh api repos/heke99/gridex-ops-platform/commits/8490c349`→422; comments and paginated491 history→owner reply above. First default-network read failed; permitted network read succeeded. No external post/mutation.
- First three new-suite runs failed in fixture setup: missing actual company default function; finite column regex did not allow sha256 digits plus actual current retention helper unresolved; then missing actual retention helper relation. Loaded actual definitions/allowed real column identifiers. **None is product RED.** No production byte was changed.
- Fourth run:4/4 PASS; then meaningful syntax/no-error and exact physical original/identity assertions added:4/4 PASS, exit0,6.43s. Parent found the finite DB access ledger was recorded only after whitelist admission, so a caught undeclared lookup could disappear from the zero-access assertion. Own test now logs every `from` attempt immediately and every executed query before whitelist rejection; it explicitly asserts zero forbidden/business attempts. Unexpected queries still throw. Final reviewed freeze:4/4 PASS, exit0,6.02s. No failed behavior was repaired in product.
- Exact final behavior command: `PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH NODE_OPTIONS='--max-old-space-size=6144 --require=./scripts/lib/unit-loopback-network-boundary.cjs' node --experimental-vm-modules node_modules/vitest/vitest.mjs run __tests__/ediel-sc-014-unattributed-reception.test.ts --maxWorkers=1`.
- Final reviewed log `/tmp/masterplan-sc014-admission-reviewed.log`, SHA256 `2bd6660a1ddadc51dc2a53d7c0b756a05f9062597702efb8b959042912945316`.
- Final reviewed tests types: Node22 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json` with max-old-space-size6144, exit0; `/tmp/masterplan-sc014-tests-types-reviewed.log` empty.
- Final reviewed scoped lint: Node22 `node node_modules/eslint/bin/eslint.js __tests__/ediel-sc-014-unattributed-reception.test.ts`, exit0; `/tmp/masterplan-sc014-scoped-lint-reviewed.log` empty. Both empty-log SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `git diff --check` exit0; no existing source/schema/shared-memory/tag/coverage/Git changes. Frozen OPS05 legal-attribution exception/actual mailbox warning proofs were read and reused as prior evidence, not copied/rerun.

Bounded verdict: **current source is technically held by the genuine canonical admission/source-ID boundary; no confirmed whole-contract violation and no whole SC014 approval.** The null-company raw original nevertheless has uniquely assigned finite technical UNB/environment and the same current actor that qualifies the actual positive source. Missing canonical ID alone must not be used to conclude the normative "where safely possible" is fulfilled. Parent is reviewing TEN11/original source and the intended independent technical-source authority before any scenario verdict.

If that review establishes prescribed ACK is safely possible here, the causal boundary is `createUnresolvedInboundEdielMessage` input/environment/source identity plus `gridex_validate_ediel_message_contract` null-company admission BEFORE actual `capture_source`; V2 reader/source selector can only consume an admitted source. The owner8490 receipt grants SC014 qualification outside their one mailbox-ID hunk, but does not authorize duplicating their unpublished line or bypassing the contract. **Do not set company_id from mailbox as legal/business attribution and do not synthesize a receivedProdatContext or ACK admission.** No safe one-line repair is approved; any exact protected admission correction still needs parent's normative/source-owner reconciliation.

Next action: parent independently reviews this frozen two-file qualification and literal/authority distinction. No SC014 mutations unless precise feedback arrives. Once requested, perform independent SC055 literal/current caller/finite-native-port cross-review without duplicating SQL/native execution.
