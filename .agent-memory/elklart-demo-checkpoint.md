# Elklart systemdemo — eget sidospår

2026-11-10. User mandate: complete existing demo according to uploaded Swedish plan. Existing source identified: OPS PR1048 (266537758), Web PR66 (8069791); checked out both existing branches without unrelated edits. Actual OPS main f23c1dc0c.

Implemented continuation: RLS-scoped read-only portfolio, exact fixture bindings, live supply-boundary gating with prepared demo forecast/purchase profiles, current metering and corrections, missing-data handling, DST, day totals, quarter selector and customer drilldown. Existing example exercise retained and linked separately. No schema, API, Ediel writes, provider effects or deployments.

Infrastructure blocker: no dedicated demo Supabase project among relevant linked accounts; Vercel search demo returned no projects. Existing staging is not assumed disposable. Asked user for existing dedicated project names/URLs. Creating new billed projects requires selecting organization and cost confirmation via Supabase tools. Do not touch OPS production piidsfebjqjmnepdpnas or Web production ayiuxjlfazkjmmtlvhsl.

Next action: obtain isolated project targets; provision/replay dedicated databases, configure deployments, use ordinary customer/contract intake and test integrations for fixtures, verify portal/OPS same references, prepare whole-environment reset and run twice. Full demo not complete. No fake acceptance of billing, role checks or rehearsals.

Verification and independent reviews are recorded in quality/elklart-demo/verification.md. Shared Ediel current-task/checkpoint/handover remain owned by their campaign.
