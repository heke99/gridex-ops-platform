# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-ea1a` closes post-`09752455`
(#139 tip health) residuals.

Main tip `#139` forward-ported audited inbound manual review resolution and a
service-role platform release receipt writer. Tip hunt found:

1. Developer portal scope wording still joined with `eller` while portal-bundle
   `scopeMode` is `all` (docs AND/OR mismatch). `OPENAPI_RELEASED_AT` still on
   `2026-08-10` while contract day is `2026-08-14.1`. Draft `#138` had these
   fixes but had not merged before tip moved.
2. Manual review UI/RPC wrote terminal status `completed`, while the inbound
   worker persists successful jobs as `done`.
3. Resolve action accepted independent `job_id` + `inbound_email_message_id`
   without binding; RPC did not require message membership.

This branch:

1. Aligns `PUBLIC_API_ENDPOINT_ROWS` join text with `scopeMode` and sets
   `OPENAPI_RELEASED_AT` to `2026-08-14T12:00:00.000Z`.
2. Adds forward `20260814190000` that replaces the 4-arg review command with a
   5-arg command requiring message binding, normalizing `completed` → `done`,
   and clearing non-failed `error_message`.
3. Updates admin form/action/UI error mapping and generated types Args.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814190000` was not observed in this run.
