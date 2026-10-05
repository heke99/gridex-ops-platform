# Independent TR-10 / AT-TR-10 review

Verdict: APPROVE complete TR-10 and AT-TR-10 code/database behavior at
`05c6e8b7e8a4399ec0e5e50358eb6d9e2231f72e`, tree
`8c75872a750318fc90e45145116c99d4e42f5b93`. No material remaining predicate
gap found within this card. This is independent review evidence, not a source,
coverage or merge mutation.

Frozen scope: `registers/rules.json:1443–1455`,
`registers/acceptance_tests.json:2394–2405`, SC-063:904–915, and the TR-10
transport transitions ST-T02, ST-T04 and ST-T05 in
`registers/state_transitions.json:20–79`. SC-064 belongs GOV-04/OPS-01 and is
not included in this approval.

Exact-head native evidence independently verified from run37239978374,
artifact11317501378:

- ZIP `/workspace/attachments/6ff2294f-61d5-47ed-8ed7-16fecbb65639/tr05-tr10-private-guard-native.zip`
  SHA256 `94fd879e312d78853dba28c65803d02b142a4a849f6b0d61c94c697dbd8e26e1`.
- `/tmp/masterplan503-native05/receipt.json` matches exact Git commit/tree;
  all nine declared input SHA256 values match the committed blobs.
- Extracted receipt, JUnit and log match ZIP contents byte for byte.
- JUnit SHA256 `56ff1bbe042ddfb7fa1e05eb193dc16de2c3d4527c3b64fc5866a05bfa4c0642`;
  log SHA256 `74161fbac184fe90f0ae4fd999fb7c59b3018c074f1a73692c54315822625510`.
- Overall 28 total /23 PASS /5 FAIL /0 ERROR /0 SKIP. All nine dedicated
  TR-10 native cases PASS. Shared worker/recovery cases below also PASS.
  The five failing tests are fresh TR-05 correction/source/denial assertions;
  none supplies evidence for a passing TR-10 predicate here.

| Complete-card predicate | Actual path and asserting native proof |
| --- | --- |
| Valid lease and fencing before provider entry; invalid identity/lease causes no external send | Public claim -> `sendOutboxItem.ts:85–116` -> actual worker dispatch owner -> native generic/sealed prepare/enter owners. `20261004204256...sql:12–21` acquires the original identity row lock and then rechecks the database clock. Recovery native:345–359,411–420 prove stale and unswept expiry refusal;421–510 proves a genuine provider-entry RPC waits while the claim is current, is released after actual DB-clock expiry, returns P0001 worker_fence_lost, preserves its prepared attempt, creates no case and calls SMTP zero times. |
| Stable correlation to the same original; fresh attempt and current authority on permitted retry | Recovery native:166–191 produces the original through real source/canonical/archive/transport owners, observes actual pre_connect_negative, uses the public recovery authority and real worker for exactly one further SMTP call, and preserves the old attempt, old archives/readback bytes and original hash. Recovery native:192–212 withdraws actual network authority after queueing and proves no new provider call or retry consumption. |
| Unknown-after-submission is distinct from known acceptance and pre-entry expiry | Reconciliation native:46–62 commits actual generic entry/unknown observation and one case;84–90 proves a never-entered expired claim has no submission-unknown case;92–99 proves known accepted journal plus public projection failure creates no invented unknown-provider case. Recovery native:389–410 repairs that frozen accepted receipt without another SMTP call. |
| Atomic tracking case with unknown outcome; no private invented authority | `20261004204835...sql:47–106,109–152` qualifies the genuine entered attempt, original hash, exact archive and source origin before atomically creating the immutable case/opening. Reconciliation native:46–62 proves binding and unique opening;101–113 injects a scoped opening CHECK failure, proves observation/opening rollback with committed entry retained, then actual stale sweep publishes tracking without re-entry. |
| Crash/restart and timeout cannot blindly resend | Actual `processEdielOutbox.ts:14–36` and `sendOutboxItem` re-entry are exercised by reconciliation native:41–81 and173–192, recovery native:252–314,327–388. Generic and sealed pending entry remain fenced across stale sweep, restart processes zero jobs, direct old worker is blocked and SMTP call count stays one. Expired SLA and accepted/foreign-mixed/unknown/unobserved outcomes grant no recovery authority. |
| Late same-attempt result reconciles history without new provider entry | Reconciliation native:64–82 and173–192 prove generic/sealed actual late acceptance derives outcome_observed, preserves immutable opening, protected sources and same attempt, and grants authorizesResend=false/deliveryProven=false. Sealed committed entry/result witnesses are read through their actual owner. |
| Tracking scope, archives and immutable history remain protected | Reconciliation native:115–147 proves foreign/revoked reads deny, held archive still exposes only its qualified case, forced RLS/no app table/helper access and append-only UPDATE/DELETE/TRUNCATE refusal.149–171 proves the sealed case has actual witnesses, archive hash/length and verified readback, preserves all old archive rows/bytes/raw hash/source history, and suppresses attempted re-entry. |
| No SMTP exactly-once delivery promise, recursive blind retry or business-acceptance inference | Actual generic/sealed reservation owners return immutable observations rather than entry permission; `outboundAttempt.ts:63–94` and `correctionOutboundDispatch.ts:70–117` make one gated provider call and retain an ambiguous entered fence. `copy.ts:20–59` validates authorizesResend=false/deliveryProven=false and projects bounded case fields. Actual native reads/restarts above assert these flags and provider counts. No business retry or acceptance is created from an unknown transport outcome. |

Fixture boundaries remain explicit: external SMTP responses, synthetic tenants
and legal/source-policy inputs, declared public clock and scoped database CHECK
faults. Native PostgreSQL, GoTrue/JWT source session, canonical origination,
MIME archive/readback, public claims, private journals, case publishers,
witnesses and scoped readers are actual production paths. Real remote SMTP
delivery and market certification are not established by these fixtures.

The exact-head native run remains red due to five separate TR-05 assertions.
This approval neither approves TR-05/AT-TR-05/SC-040 nor clears PR503 merge,
ordinary mandatory CI, current schema/type capture, browser, upgrade/parity or
market activation gates. No repository source, tests, coverage or memory was
edited during this review; only this external reviewer checkpoint was written.
