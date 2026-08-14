# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-996c` closes post-`15ef6bf6`
(#143 inbound manual review status/binding) second-order residual.

Main tip `15ef6bf6` made resolve persist canonical `done`, accept legacy
`completed`, and bind job ↔ inbound_email_message_id. Default UI action is
still **Köa om** (`queued`). The resolve RPC always stamps
`review_resolved_at`. When the worker later returns the same job to
`manual_review`, it did not clear that stamp, so:

1. Detail page open-review filter (`status=manual_review && review_resolved_at
   is null`) hid the form.
2. `canonical_resolve_inbound_manual_review` rejected with
   `inbound_processing_job_not_open_for_manual_review`.

This branch:

1. Clears `review_resolved_at` / `review_resolution` in
   `markInboundProcessingJobFinished` when status becomes `manual_review`.
2. Adds forward `20260814193000` to normalize legacy `completed` → `done`,
   unstick sticky manual_review rows, and backfill missing review metadata.
3. Surfaces known Swedish action-layer errors in the UI action wrapper.
4. Advances types manifest tip (data-only migration; hash unchanged).

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814193000` was not observed in this run.
