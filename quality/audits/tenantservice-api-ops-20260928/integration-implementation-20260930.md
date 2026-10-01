# Tenantservice integration implementation — 2026-09-30

Status: IN_PROGRESS. No whole T/U requirement or masterplan phase is accepted.

## Verified starting state

Remote main 53bf989b0ad402bb2ce151c186eea31f1ec9cf03; draft #418 7afb3dcac62376edc5cab24c83ebcce80cb06e9a; draft #422 cc90678d45602d37db7f8edf9713597c66fee28a. Latest applicable workflows succeeded on both draft heads; crawler/staging skips are not executions. Event-v2 exact-head HTTP/native receipt is #422 comment5911733693 and is retained as regression coverage.

All older checkouts and dirty/unpushed work remain untouched. Local continuation 0a7c6e04 is merged with published #422 ancestry in 6cc12d01; conflicts only in memory selected the newer qualified receipt/plan, with older published notes retained below it. Current root tree is isolated from original checkouts. Ownership comments #4185913321051 and #4225913321345 coordinate a single publisher.

## Ownership and locked interfaces

A: additive notification migration, notification SQL/native tests. B: notification adapter, profile/sync bypass corrections and non-fatal telemetry. C: OPS shell/navigation/customer card and guarded edit components. D: support domain command, additive support schema, OPS cases, portal and four explicit customer case API routes. E: effective billing resolver, profile command, readiness/preparation and provider export integration. F: legal/metering/notification HTTP fixtures, public generator/guide/client. Root: shared registry, workflows, versions, generated database artifacts, memory, integration and publication. Workers neither commit nor reset shared databases.

Notification RPC: public.gridex_mark_customer_notifications_read_v1(p_command jsonb) returns {statusCode,body,replayed}; strict command {companyId,customerId,clientId,subject,idempotencyKey,notificationReferences}. The verified guard supplies subject. DB checks current tenant/client/scopes/customer relation before replay; namespace and compact ordered payload hash remain unchanged. Canonical reference derivation is exactly publicReference('notification', companyId, id). Old completed responses replay exactly; old failed/processing claims stay safely blocked.

Support scopes customer_cases.read/write are explicit, separately enrolled and are not added to old portal alias expansion. Root registers GET/POST /customer/cases and GET/POST /customer/cases/{reference}/messages. D supplies strict public shapes and current actor checks; internal notes are never automatically projected.

## Skill routing

Activated: using-superpowers, using-git-worktrees (isolated clone; authorization already in user request), writing-plans (reuse prepared notification/native plan plus this wider ownership record), dispatching-parallel-agents, acquire-codebase-knowledge, specification tracing, TDD/systematic-debugging for reproduced defects, Supabase/Postgres/security boundary review, relevant installed Next16.3.5 docs, UI web-design-guidelines/React review, code-review and verification-before-completion. Relevant specialist skills are read by their file owners. Conditional: variant-analysis after confirmed writer bypass; property testing where useful, secret/static scans if binaries configured; final differential review and completion workflow. Full Quality Playbook regeneration is skipped because this is implementation against an existing evidence inventory, not a new baseline audit. Skill-authoring/hooks/provider activation are absent; no hooks/skills/providers are changed. Performance work is limited to requested measured indexed notification lookup; no invented speed claims.

## Execution and evidence

Existing inventory:147 pages,3439 lexical UI candidates,121 API routes,101 server-action files. Candidates are not unique verified actions. All75 T/U meanings stay in requirements.csv. New action evidence is supplemental rather than replacing original rows.

Local Node22 exists and installed dependencies are reused without mutation. docker, psql and supabase CLI are absent; no local native success is claimed. Additive migrations and real seed/HTTP/postcheck fixtures will run in the established CI disposable stack. Supabase changelog markdown retrieval failed unsupported content-type; installed schema/SDK/Next docs and official SQL docs provide applicable version boundaries. No hosted database access is used.

First targeted root checks: explicit support capability registration2/2 PASS. B reproduced the existing notification update-before-completion gap using its current regression. New code requires its own final native/browser/CI evidence; previous green heads do not qualify it.

## Final integration gates

Freeze runtime, check owned diffs, run targeted and consolidated checks, produce a new paired release preserving historical bytes/modes, wire new genuine seed/HTTP/native/browser checks, collect authentic generated schema/types/fingerprint, recheck branch heads/ownership and publish non-force to the existing drafts. Root will preserve #418 OPS ownership and #422 API-specific work. No main merge, production migration, customer communication, Ediel activation or #310 modification.

External issuer enrollment, real phone verification policy/issuer and attachment scanner configuration remain independently evidenced deployment boundaries; safe fail-closed behavior must remain. The combined customer journey must be genuinely executed before accepting it.
