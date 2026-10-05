# Final consumer correction wave — 2026-09-23

Implemented R1–R4; local gates pass. Native qualification and independent final acceptance remain pending. E035/F3/masterplan is PARTIAL.

- R1: forward SQL compares locked existing metering and normalized business content, exact current projection and source environment before lineage reuse, then rechecks the returned legacy result transactionally. Equal multi-source lineage and workflow/audit edits remain separate; conflicts hold without replacing existing content.
- R2: populated mutable billing response IDs no longer skip source-owned database verification. Request/message/return state receives the verified underlay ID on every accepted writable retry.
- R3: original agency9/no-issuer identity and legal-party scope are checked before policy-window/high-resolution exemptions, again before writable preparation, independently during SQL persistence and stored-contract lookup. Unsupported scope is internal review/response none; no E61/E62 fabrication. Prior-guide meter/register comparison remains explicitly deferred; comparison coverage is A4 from 2026-10-01.
- R4: non-stored writable observations raise internal failure; no positive ACK/success completion from an empty/partial failed write. Committed earlier rows survive for idempotent retry.

Focused corrected-fixture RED11 failures/41passes against original runtime, GREEN101/4. Full unit+coverage5975/370 PASS (44.76% statements,38.63% branches,51.86% functions,44.94% lines). App/tests/scripts typechecks and focused ESLint PASS. Integrity607files/511groups and static provenance514 PASS; diff check PASS. Existing experimental proxy warnings remain.

32 added native cases (31 consumer + C1) are wired into the retained source-owner suite (expected156 including retained124). Cover content/projection/attribution/environment collision with unchanged source links/completion, equal reuse, real completed/after-completion billing retries with populated foreign/stale IDs and altered business fields, both processors' agency89 holds/direct RPC denial, and real no-request permission owner drift plus committed sibling recovery. Earlier rejected-or-empty assertion is strengthened to rejection. **These SQL/HTTP cases have not been executed locally.**

Authentic pinned CLI2.101.0 forward: `20260923191510_ediel_utilts_consumer_content_identity.sql`, SHA256 `63efd369d81a1a36a29ab4e7d8b9cc63904e9dc83579d17eb585189da09266b9`. Existing migration checksums are unchanged. Public service-only execution and private function revocations retained. No generated contract hand edits, case/browser edits, hosted writes, deployments, market messages or PR310 changes.

Root owns publication, actual native/browser/postbrowser runs, authentic generated reconciliation and exact-final-head independent review before bounded merge. Full command/evidence/limitations and finding-to-test map: `.superpowers/sdd/continuation-20260923-evening/final-wave-report.md`.

C1 is a separate authentic CI finding supplied during the wave: d85815f/OPS35908723812/native107342855636 passed retained124+case1+browser2+postbrowser1/types, then F-6 rejected unclassified customer_case_events. A second CLI2.101.0 forward, `20260923192915_classify_customer_case_events.sql` (SHA256 `e4ede5308f871b77da9b008ce78aa9ec5199885ef627e9d0ce0261e2d5f65822`), registers only this tenant-owned history as `tenant`. No F-6 waiver, client grant, RLS/ownership change or data rewrite. Native assertion verifies tenant classification, RLS, NOT NULL, closed client grants and validated composite FKs. Genuine F-6/native GREEN remains pending; no second full-unit run for metadata-only C1.

## Qualification followup — reservation fixture

Actual304c284 / OPS35909983631 / native107347079558 applied both new migrations; preceding SQL owner71/discovery64 passed, but the committed-retry SQL fixture failed before native156 with unsupported original identity. Its original had no NAD/LOC identities or UNB/UNZ. Fixture-only repair adds supported legal parties, agency9 POINT for both TX-1/TX-2, complete envelope and correct UNT count. No production/migration change or guard weakening. All eight retry assertions and the executable retry body are byte-identical to the prior fixture.

New regression reads the actual SQL wire and uses the production bounded identity inspector: RED1 then focused GREEN15/2. Tests typecheck, targeted ESLint and diff check PASS. Resumed Node22 path was unavailable; these pure checks used available Node24.19.0. Actual SQL/native156 rerun remains required; no full-suite rerun/5976 claim from a fixture-only change. Root-owned memory unchanged. Full evidence in final-wave-report.md followup.

## Qualification followup 2 — source uniqueness

Actual4061db8 / OPS35917060345 / native107371193902: retained SQL retry8 PASS; native151/156 PASS. All five remaining failures were synthetic source INSERT collisions on ux_ediel_inbound_interchange before R3/R4 behavior. Central new-source fixture setup now derives a14-character reference from the new source UUID, updates both UNB/UNZ and parses row metadata from that final wire. Actual same-ID retries retain original IDs/bytes. All156 native case bodies/assertions remain byte-identical; no production/schema/migration/gate changes.

Fixture regression RED1/1pass → focused GREEN17/3 proves reference uniqueness/consistency, unchanged transaction content, runtime acceptance and same-ID retry stability. Scripts/tests typechecks, targeted lint and diff check PASS on Node24.19.0. Genuine native156 rerun still required; no full-product review reset or broad unit rerun for setup-only correction. Detailed evidence in final-wave-report.md followup2.
