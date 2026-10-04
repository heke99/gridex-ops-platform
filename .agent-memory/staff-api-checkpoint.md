# Staff API S1–S5 (2026-10-04)

Status: IN_PROGRESS. Separate from the active Ediel and other support campaigns.

User-authorized scope: integration key with explicit staff scopes plus externally signed
RS256/PS256/ES256 staff assertion, company membership and current profile/overrides;
staff accounts, customer work, support cases, third OpenAPI contract; merge after green
verification, apply reviewed forward migrations, then synthetic production API checks.
No real-company staff activation, key rotation or real customer communications.

Base: main fa4147b33dd3215c150cbe91d755db30e5ae6c62. Existing draft #482 is a
different OPS-issued staff authentication model and is preserved, not taken over.

Skills: Supabase (schema/RLS/grants), Vercel API (deployment verification), repository
parallel execution, code review and verification-before-completion. Requirements already
specify the architecture; brainstorming and Ediel-specific acceptance work do not apply.
Hook installation, payments, video and unrelated platform skills are outside this task.

S1 provider purpose/replay/UI committed, context/scopes/transport under verification.
S2/S3/S4/S5 are isolated worktrees; root owns integration, generated artifacts and release.
Contact route uses masterdata.write to match the real OPS transaction permission.
Explicit staff scopes do not inherit wildcard or customer/website groups/defaults.

Verified locally: 44 context/transport/customer-assertion tests, 21 provider setup/action
tests at their respective package checkpoints, app TypeScript. Native production/replay
checks and full frozen-candidate tests remain pending. No production mutation performed.

OPS production: piidsfebjqjmnepdpnas (gridex-ops-dev), Supabase account link_6aa08570afb48191a4eb728ab8e93c81,
confirmed by the repository's current production evidence and live read-only schema query.
The project named gridex-prod belongs to Gridex Web; it is not this OPS database.

Next: integrate S1 additive native staff authentication gate, register immutable checksums,
publish S1 PR and obtain authentic clean-replay types/schema capture. Continue S2–S5;
run all mandatory exact-head gates before merge/production migration.
