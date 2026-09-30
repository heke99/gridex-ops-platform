# DSN source observation packet — code phase

Scope: TR-04, AT-TR-04 and SC-062, with transport attempt identity from TR-02/TR-03. Frozen requirements and acceptance statuses are unchanged.

The actual inbound mail consumer classifies multipart/report and delivery-status before EDIFACT or AI extraction, including attachment paths. It passes the fetched, unchanged MIME source and actual attachment ID to the shared DSN parser and a native source owner. The owner rechecks current tenant/read permission, immutable mail and attachment hashes, actual mailbox/environment and exactly one entered attempt across both transport journals. A prospective attempt's mailbox is resolved from the configured sender address by the native journal, rather than accepted from returned headers. Missing, other or ambiguous mailboxes cannot establish a match. Historical attempts receive no inferred mailbox.

Matched observations append reported Final-Recipient, Action, Status, Diagnostic-Code and original identity to that attempt. A repeated exact source returns the same observation. Original mail scope/source and observed attachment bytes cannot subsequently change. The private journal grants no direct service-role edits. The current actor may read a bounded safe projection through the message API and delivery-report panel; raw MIME is not returned there.

These are source-matched, **unverified reports**. They prove neither delivery nor sender authenticity, and authorize no resend, ACK, supply activation or other business effect. Authentic provider/mailbox sender trust remains an external requirement before any verified transfer-loss decision. Embedded original files remain quarantined. No production traffic or external trial ran.

Executed quick checks:

- Focused DSN/source-consumer TypeScript regressions: 49 passing assertions in five files (parser, classification, candidates, physical source and immutable observation adapter).
- `EDIEL_PGLITE_MODULE=/tmp/ediel-service-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/ediel-dsn-source-observation-sql-regression.mjs`: 23 checks pass. Fixtures are explicitly synthetic; this checks native function bodies mechanically, not native replay or authentic DSN evidence. Includes absent/other/ambiguous mailbox, current actor, exact source hash, entered-only candidate, cross-journal ambiguity, immutable source and observation, safe read projection and ACL.
- ESLint on all packet TypeScript/React/test/script files: no errors or warnings.
- Independent actor/tenant/source review: prior mailbox and actor lock findings corrected; no open Critical/Important in the bounded packet. Profile→membership SHARE lock order matches the other current actor owners.

Final fixed-candidate tests remain unrun: native clean/upgrade replay, real concurrent actor/source mutation, schema/type generation parity, browser/API paths, real archive/readback and authentic DSN sender trust. Their expected and forbidden effects remain in the all-ID matrix and `FINAL_TEST_PHASE.md`. No formal contract is marked PASSED by this packet.
