# R2 checkpoint — epoch gridex-five-agent-20261012

- Agent: claude-r2-session_01We9W3ZyxCkKCwiL5WTBfqc · slot R2 · packet 8edfe61d-c7b2-4fd7-a2af-345a99aca9ee
- Branch: claude/charming-euler-xca299 · base main 028d2d65d6dfa670474d48adb1b97bf99c959b74
- IDs: OPS-04, TR-08 · files: lib/ediel/transport/controlledLiveReadiness.ts, __tests__/ediel-ops-04-controlled-live-readiness.test.ts, this checkpoint
- Receipt commit (main tree, parent main): 7d1e523adceb784eaabb21b969ee40690acb0310

## Claim status (active custody)
- Actual refs, created by codex-coordination-proxy-20261012 on owner request ([#766 6124857032](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6124857032)),
  verified by R2 with `git ls-remote` (GET_MATCH): `slot-R2` → `b7831933cf2fd6a696665997e5da4a7a4a6df64f`;
  `id-OPS-04`, `id-TR-08` and the five `file-*` refs (the 3 files above + `lib/ediel/mailReadiness.ts`,
  `__tests__/ediel-tr-08-mail-readiness-relay.test.ts`) → packet receipt `563cf956fd6da8ceb4f72ed7354e212c37b6686c`.
- History only: the first local receipt `7d1e523a` was never published (tag push returned 403); it is superseded and holds no custody.

## Done
- OPS-04 fail-closed controlled-live readiness evaluator: incident (corrected), route, certificate (validity/revocation),
  profile, tenant + environment consistency, agreed counterparty test bound to route, LIVE mandate bound to incident,
  rejects bulk reference import / multi-reference / blind resend; composes the #761 TR-08 relay verdict
  (reachable port never verifies transport). `productionApproved` is always false.
- Verification: `npx vitest run __tests__/ediel-ops-04-controlled-live-readiness.test.ts __tests__/ediel-tr-08-relay-trace.test.ts` → 72 passed; tsc clean for the new files.

## Done (2) — PR #774
- Review codex-extra-review-a93c P2×3 fixed in a757c0f8 (invalid dates, route certificate scope, relay evidence context); 81 tests.
- TR-08 callsite: `lib/ediel/mailReadiness.ts` gains `relay_transport` status (unknown without trace; error unless verified) +
  `__tests__/ediel-tr-08-mail-readiness-relay.test.ts`; file scope extended on #766. 89 tests passed, tsc clean.

## Blockers (external — coverage rows NOT changed)
- TR-08: genuine operator-owned provider/relay/TLS/SPF trace + provider policy (owner: operator). Resume: run evaluateRelayTrace on that trace.
- OPS-04: agreed real counterparty test, existing LIVE mandate, real incident/route/cert/profile (owner: operator/counterparty). #310 stays PAUSED.

## Done (3) — PR #774
- Coordinator P2 (blank counterparty IDs) fixed in 32235b02, plus `permittedCertificateFingerprints ?? []`; 87 tests, tsc clean.
- Helper candidate 8f45597f declined (withdrawn by its author; subset of the same fixes).

## Delivered
- PR #774 MERGED 2026-10-12: merge `057c664d5e549e706734b4536bba0b2a1c9773ce`, parents `028d2d65` (main) + `2889be29` (head),
  tree identical to the head; coverage.json unchanged (314/352). CI on `2889be29`: 22 passed, 11 skipped by event conditions, 0 failed.
- Reviews by non-coauthors: codex-extra-review-a93c and the extra reviewer (source PASS at `749af6f3`), and the coordinator
  (P2 found, then verified fixed at `32235b02`; product source identical to `2889be29`).

## Packet 2 — TR-08 whole-ID (genuine STRATO trace)
- Input: two genuine operator-owned read-back traces from ediel@gridex.se via STRATO to Gmail (2026-10-12), committed masked in
  `quality/audits/ediel-masterplan-v2/evidence/tr-08-strato-genuine-traces-20261012.json`.
- Finding: main's evaluator rejected the genuine traces because Gmail's internal `by <ip> with SMTP` hand-off was treated as a relay hop
  and SPF was read only above it. Fix: receiver boundary (exact `by ...` lines after a TLS hop whose host authored
  Authentication-Results) and an operator-declared provider hand-off (both hops TLS, both hosts inside providerDomains, non-blank policyRef).
- Result: authenticated-submission trace (iPhone Mail -> smtp.strato.com ESMTPSA TLSv1.3 -> rzone.de -> mx.google.com ESMTPS TLS1_3,
  spf=pass) verified; webmail trace stays unverified (internal host smtp-ox.front outside provider domains). Forged variants fail.
- Verification: 101 tests across 5 files PASS; tsc and eslint clean; `ediel:masterplan-v2:test-coverage -- --check` exit 0, approved 315/352.
- Coverage: review 5493996486 (coordinator + peer A, non-coauthors) — TR-08 row kept NOT_VERIFIED: the STRATO submission -> outbound
  hand-off has no Received TLS line and no published STRATO TLS policy; adjacent TLS hops do not prove that segment. `AT-TR-08` stays with C3.
- Review P2 fixed: a `by`-first line with a late `from` is no longer receiver-internal; only plaintext/sender_missing/by_missing are cleared.
- Gap stated openly: STRATO publishes its SPF policy but no TLS policy for its own internal submission -> outbound hand-off.
- Refs for the 4 packet files created by the proxy (#766 6129038358).
- OWNER DECISION 2026-10-12 (option 1): STRATO-internal hand-off accepted as provider risk (evidence `ownerDecision`); TR-08 -> VERIFIED.
- Superseded remaining item: STRATO's own statement/policy that its submission -> outbound relay hand-off is TLS (or a trace that records it).

## Next
- PR #785: final source reviews PASS at d4b462e6 (review 5494462593: root + peer A, non-coauthors). Late-from (d34ccdc1) and
  unbound Received-SPF in the receiver band (d4b462e6) fixed. Proposed ledger: TR-08 VERIFIED under the recorded ownerDecision
  (provider-internal hand-off only; recorded-hop TLS, receiver-bound SPF and port-not-proof still enforced) -> 315/352.
- Deliver after CI is green on the final head: normal expected-head merge, verify main/tree/coverage, #766 MERGED receipt,
  then release the packet file refs via the proxy. AT-TR-08 stays with C3; OPS-04 still needs counterparty/LIVE input.
