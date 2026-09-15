# Transport audit — masterplan v2

Scope: sections 3–4, CALL-06/07/08, and transport requirements in section 13. Repository evidence only; no external SMTP, mailbox, database, certificate, or production observations. Source references below refer to the audit worktree. Parent explicitly authorized bounded DSN and SMTP uncertainty remediation after the evidence pass.

## Skill routing and verification boundary

Read AGENTS.md, active memory/checkpoint, integrations/canonical flows, decisions/known failures, and installed skill inventory. Applied spec-to-code compliance, direct false-positive checks, code review, systematic debugging, TDD and verification-before-completion. The using-superpowers skill explicitly exempts dispatched subagents. Repository-wide discovery, database qualification, UI/performance review, supply-chain scans and deployment workflows are outside this bounded transport stream; no independent whole-repository or live-runtime acceptance is claimed. Shared memory, migrations and external services were not changed.

## Confirmed and remediated

### T01 — High: DSN returned originals entered EDIFACT processing

Original execution path: `storeMailboxFetchMessage` in `lib/inbound-mail/edielMailboxPoller.part-2.ts:178–200` unpacked S/MIME then passed MIME to `splitMimeParts`. `lib/inbound-mail/edielMailboxPoller.part-1.ts:742–844` selected the first EDIFACT-looking text from attachments, bodies or the entire email without classifying DSN. `processInboundEmailMessage` then repeated extraction from stored raw/body/attachments before tenant resolution and business/ACK processing. Diagnostic fallback also created Ediel rows for mail without a readable payload; previously parsed rows could bypass this fallback entirely.

Proof: independent MIME fixtures containing multipart/report, message/delivery-status and returned PRODAT Z01 produced a parsed Z01; six initial behavioral tests failed for the expected defect. Nested message/rfc822, attachment-only and historical parse-result fixtures identified three further bypasses during independent review.

Fix: shared MIME-structure classifier recognizes delivery-status/global-delivery-status reports and MIME message wrappers before extraction. It does not treat plain prose containing Content-Type text, AI list text, or other report types as DSN. Parser and processor check raw/decrypted/attachment contexts. The processor archives the existing email for `manual_review` with `dsn_transport_review`, does not infer tenant from returned original, and never enters EDIFACT tenant/business/ACK processing. Both linked-message selection and diagnostic reconstruction exclude DSN source mail before reading old business parse rows. The raw envelope is retained; full structured attempt/recipient correlation remains future work, and no DSN claims business acceptance or rejection.

Owned code: `lib/inbound-mail/dsnClassifier.ts`, `edielEmailParser.ts`, `edielInboundProcessor.ts`, `edielMailboxPoller.part-1.ts`, `edielMailboxPoller.part-2.ts`.

### T02 — High: uncertain SMTP outcome was reported as definite failure

Original execution path: `lib/ediel/outbox/sendOutboxItem.ts:259–263` sets providerAccepted only after `sendEdielMessageViaSmtp` returns. The transport calls SMTP and then persists transport audit fields, message status and sent event (`lib/ediel/transport/index.part-2.ts:721–800`). A lost response after DATA or exception in these post-acceptance writes therefore reached `sendOutboxItem` with providerAccepted false and was written as failed (`301–343`). The transport audit update also discarded returned Supabase errors through warn-only handling.

Installed Nodemailer evidence: `node_modules/nodemailer/lib/smtp-connection/index.js:225,899–963,986` shows socket errors and response timeouts labelled CONN even while a transaction may be underway. `1824–1855` supplies explicit DATA negative responses as numeric responseCode. Therefore command CONN alone does not prove a connection failed before DATA.

Fix: `smtpOutcome.ts` defines typed uncertainty and distinguishes explicit 4xx/5xx rejection, DNS/auth/connect-syscall failure and ordinary preflight errors from ambiguous CONN/DATA socket loss/timeouts. Post-acceptance persistence errors propagate as typed uncertainty with SMTP Message-ID, including returned audit-update errors. Outbox uncertainty writes use the same attempt fence as ordinary writes. A failed reconciliation-state write returns uncertainty and explicit persistence failure, without overwriting a newer claim. Ambiguous CONN greeting timeouts conservatively require reconciliation because the public error lacks a reliable SMTP phase; this does not claim successful submission.

Impact refinement: automatic resend was NOT demonstrated. Latest claim definitions select prepared/queued only and convert stale sending to delivery_uncertain (`20260618200000_ops_production_hardening_resolver_queues.sql:160–175`; direct claim in `20260712110000_ediel_canonical_consolidation.sql:431–438`). Preserve those protections.

## Confirmed open gaps

### T03 — High: queued SMTP destination is not compared with current route destination

`sendOutboxItem` refreshes route contract before send; `routeContract.ts:107–158` checks active route, environment, actor/subaddress/family/code/security/certificate. It never compares `message.receiver_email` with the current route's SMTP recipient, and `readinessGuard.ts` adds actor readiness but no SMTP-address comparison. `transport/index.part-2.ts:317–325` only requires a nonblank stored email and reloads route security; actual send branches use `to: message.receiver_email` (454–456,606–609,653–656,694–697,714–717). A queue item created before an SMTP route-address change can therefore submit to the old address while using current security. This is narrower than a missing route-refresh claim.

Bounded next fix: extend the same route-contract result to require current canonical SMTP destination equality (or explicitly block for a new decision); include destination in immutable route-decision evidence. Independent regression: persist recipient A, change only route destination to B, verify zero SMTP calls, then a freshly decided item for B is accepted. Do not silently rewrite an older attempted payload/history.

### T04 — High: S/MIME archive reference is not retrievable byte evidence

`transport/index.part-2.ts:550–557` creates `smtp-smime://<message>/<hash>` and stores rawPayload null. `storeTransportPayloadSnapshot` in `index.part-1.ts:729–753` inserts that reference/hash/metadata, not the actual encrypted bytes or complete EML. It does not check the returned insert error. The raw EDIFACT snapshot caller also catches errors and continues (`part-2.ts:425–442`). This does not satisfy section 13's requirement for retrievable actual message bytes. No blob upload or dereferencer for the pseudo-URI was found in the execution path.

Next fix: persist exact generated MIME bytes in the existing approved private storage system before submission, verify durability, retain RFC Message-ID/hash/route/cert evidence per attempt, and fail before send if archival persistence fails. Independent test must read back exact bytes and compare to the bytes passed to SMTP, with storage-failure zero-send negative control. No new storage design was improvised in this bounded patch.

## False positives and unverified requirements

- “No route or certificate revalidation before send”: false. Outbox route contract/readiness refresh exists (`sendOutboxItem.ts:202–237`), and transport refreshes route/certificate security (`part-2.ts:321–349`, `part-1.ts:637–726`). Destination equality is the narrower confirmed gap.
- “Every SMTP failure automatically retries”: false/unproved; current claim SQL excludes failed/uncertain and quarantines stale sending. T02 concerns incorrect outcome semantics and reconciliation evidence.
- “Pure canonical protocol policy must contain company_id”: false under section 3.1. Execution context is separately checked.
- No end-to-end exploit that converts historical_replay/catalog_evidence into a live send was established. Policy modes exist in canonicalEdielPolicy; execution context lacks an explicit operational mode and lower SMTP inputs carry a message row, but absence of a field alone does not prove reachability through authorized commands. A dedicated execution-decision mode invariant and end-to-end zero-SMTP tests remain unverified requirements, not a claimed production incident.
- Live certificate chain/revocation/TLS/SPF evidence, actual SMTP/provider binding, historical Z01 final delivery, and production database migration acceptance remain unverified. No network request was made to external transport services.

## Executed verification

- `npx vitest run __tests__/ediel-dsn-classification.test.ts`: original RED 6 failed/3 passed; GREEN 9 passed; diagnostic RED1 then GREEN10; review-bypass RED3 then GREEN13.
- `npx vitest run __tests__/ediel-dsn-classification.test.ts __tests__/ediel-canonical-inbound-parser-v2.test.ts __tests__/ediel-inbound-ack-transport-guard.test.ts __tests__/z02-inbound-parsing-hardening.test.ts`: 4 files, 24 tests passed at this audit checkpoint.
- `npx vitest run __tests__/ediel-smtp-outcome.test.ts`: RED 3 failed/6 passed for ambiguous SMTP loss, then passed after fix. Additional typed Message-ID/fencing controls also pass.
- `npx vitest run __tests__/ediel-smtp-post-acceptance.test.ts`: real transport orchestration exercised with mocked SMTP/DB boundaries; post-acceptance status/event throws preserve uncertainty. Returned audit-error case RED1/4 pass then GREEN5 after dropping warn-only suppression.
- `npx vitest run __tests__/ediel-smtp-outcome.test.ts __tests__/ediel-smtp-post-acceptance.test.ts __tests__/ediel-post-send-source-projection.test.ts`: 3 files, 20 tests passed.
- `git diff --check`: passed. Other agents' source changes were preserved. These tests use local synthetic fixtures and mocked external boundaries; no real email/DB mutation/commit was performed.
- Final combined rerun of the seven listed DSN/SMTP/parser/ACK/Z02 test files: **7 files / 44 tests passed**, 2026-09-15 19:30 UTC; diff check remained clean.
