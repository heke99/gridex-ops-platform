# SECURITY DEFINER report

## Remote observations before convergence migration

- Principal canonical lifecycle/production/profile functions have fixed `search_path=public, pg_temp` and are executable by `service_role` only.
- `ediel_configuration_change_snapshot_trigger()` was executable by PUBLIC, `anon`, `authenticated` and `service_role`.
- `prevent_ediel_configuration_snapshot_mutation()` was executable by the same broad roles.
- Canonical table ACLs were broader than their policies; several included full `anon`/`authenticated` privileges.

## Forward repair

Migration `20260802170000_canonical_security_convergence.sql`:

- revokes direct execution of trigger/internal functions;
- retains fixed search paths;
- keeps public command RPCs service-role only;
- verifies active Auth user, active profile, global platform role or tenant permission inside the database;
- requires global `user_roles.company_id IS NULL` for a platform-admin role;
- renames prior implementations to non-executable `_v1_unchecked` functions and exposes verified wrappers;
- removes broad anon ACLs and four explicitly inventoried anon membership policies.

Static inspection: **PASS**. Applied-schema and JWT verification: **NOT VERIFIED**.
