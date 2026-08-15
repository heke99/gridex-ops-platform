# Handover

Updated: 2026-08-15

Branch `fix/e2e-ediel-approval-20260815`, PR `#149`, closes the remaining production requirement:

1. Lock the generated Supabase TypeScript contract and migration checksums.
2. Remove implicit/unscoped Ediel test role fallbacks.
3. Keep supplier and ESCO runtime identities isolated across tenants.
4. Preserve Gridex El production approval and website/API contract readiness.
5. Restore ordinary CI diagnostics and require full hosted clean replay.
6. Restrict the newly introduced privileged restoration and integrity RPCs to `service_role` after Supabase advisor review.

Production evidence observed before deployment: Gridex El is active/live with production Ediel ID `21660`, the tenant website API client is active and launch ready, published website offers are available, and prior external contract intakes have produced customer/contract chains. Ediel ID `92825` is reserved for new system tests and is not substituted for the tenant production actor.

Local workflow and focused multi-tenant/contract/Ediel gates pass. Complete the final rerun, push, hosted CI/clean replay, merge, Vercel READY verification, and post-deploy API/runtime smoke checks.
