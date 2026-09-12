# Internal invoice and Ediel JSON contracts

Status: IMPLEMENTED, local targeted verification PASS; hosted CI and independent review pending.
Base:85d8c22a095a495f01bfc0dfb9e5de22e073b1e8/tree8006ea67ad53768976bca488cdaf7c0b8e11b98b.
Scope: Task10b2b / masterplan84. No database migration, provider invocation or main merge.

The actual six route handlers, canonical company guard, invoice purchase payload builder and existing company-authority tests were read. The seven-route shared bounded reader is reused. Closed schemas now protect invoice create/retry/send/dispute/purchase and inbound Ediel automation. Explicit company aliases must agree; valid body-selected company goes through the unchanged canonical authority guard before domain/provider I/O. Missing bodies remain valid only for retry/send/dispute/purchase, whose input fields are all optional; malformed JSON and non-object JSON do not gain that exception. Financing enums no longer silently default on invalid input, recourse days must be a safe nonnegative integer or null, and Ediel forceManualReview must be an actual boolean. Actor, approval and provider environment cannot be supplied through unknown fields.

Existing empty-body defaults, opaque IDs, explicit platform authority, provider payloads and invoice business behavior are preserved. Dispute continues to accept its existing companyId spelling only. No fixes to the separately tracked atomic invoice event/financial dispatch lifecycle are inferred from request validation.

Verification (Node22.16.0, existing dependency snapshot):
-111 new tests on the original six route bodies:39 PASS/72 expected failures.
-Fixed six-route tests plus previous seven-route165 and real canonical-company47+71 controls:394/394 PASS.
-`npm run typecheck:tests`:PASS.
-Targeted ESLint on changed/new TypeScript:PASS.
-`git diff --check`:PASS.

Skill routing continues executing-plans, systematic-debugging, TDD, complete-path contract review and verification-before-completion. These results are self-reviewed, not an independent approval. Remaining five platform schemas, partner idempotency, move-out contract and all recorded full replay/native/database/job gates remain OPEN.
