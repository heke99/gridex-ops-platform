# Remediation handover

Status: **POST-#97 HEALTH RESIDUALS ON BRANCH**

Branch: `cursor/codebase-health-and-stability-026e`
Base main SHA: `725b024af9d0c4f8d50ec8cf85ab203afccd4d55` (PR #97 BL-001)

## What this branch closes

1. **GRIDEX-OPS-V3-BUG-001** — controlled portal input errors no longer collapse to 500 on legacy sync; same-class variants on customer sync and portal-bundle POST wrapped.
2. **GRIDEX-OPS-O-008 PUBLIC residual** — forward migration `20260809151500` revokes PUBLIC grants on readiness surfaces while keeping authenticated SELECT on `actor_readiness_status`.
3. **GRIDEX-OPS-V3-BUG-007** — reserved local `module` binding renamed to `legalModule` in `tenantSync.ts`.

## Verification executed

- V3-BUG-001 static + vitest PASS
- O-008 PUBLIC static + manifest checksum PASS
- BL-001 static still PASS
- Logging redaction vitest PASS
- GitHub Actions not used (owner-authorized blocked runner path)

## Still not code-remediable here

- GitHub `main` protection / rulesets
- Supabase Leaked Password Protection
- 35 platform grid owners without OPS counterparts
- 2 Ediel routes missing receiver IDs
- Recipient-certificate onboarding via secret-protected actor-readiness path
- Full empty-database replay evidence gap

Resume from `.agent-memory/current-task.md` and the open PR for this branch.
