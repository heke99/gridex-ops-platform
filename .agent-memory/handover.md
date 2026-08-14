# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-d15d` closes post-`f4ff19d2`
(#141 tip health) residuals for inbound manual review.

Main tip `f4ff19d2` fixed OpenAPI developer-docs scope wording and
`OPENAPI_RELEASED_AT`. Tip hunt after merge found that conflicting open PR
`#140` still held the inbound review fixes that never landed:

1. Admin review UI/action wrote terminal status `completed` while the inbound
   worker finishes successful jobs as `done`.
2. `canonical_resolve_inbound_manual_review` accepted unbound `job_id` without
   requiring membership with `inbound_email_message_id` from the detail page.
3. UI error mapping lacked mismatch / invalid-status operator messages.

This branch:

1. Adds forward `20260814190000` 5-arg SECURITY DEFINER command with binding +
   `completed`→`done` normalization (does not rewrite `20260814183500`).
2. Updates admin form/action to persist `done` and pre-check job↔message.
3. Syncs generated types Args + migration/types manifests.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814190000` was not observed in this run.
Prefer `d15d` over conflicting `#140`/`ea1a` after CI is green.
