# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-e76c` closes post-`1dfc3559`
(#144 reopen after requeue) second-order residuals.

Main tip `#144` cleared sticky `review_resolved_at` when returning to
`manual_review`, but:

1. Worker still did not invent `review_owner` / `review_priority` /
   `review_reason` / `review_sla_due_at` on entry. Architecture finding
   `manual-review-without-owner-or-sla` treats missing fields as critical.
   Reopen also left a sticky previous `review_reason` while the UI prefers
   that field over `error_message`.
2. Detail-page **Processa om** processed the inbound email without updating
   the related `inbound_processing_jobs` row, so an open-review form could
   remain after a successful direct reprocess.

This branch:

1. Extends `markInboundProcessingJobFinished` to set operational review
   metadata when status becomes `manual_review`.
2. Adds `syncActiveInboundProcessingJobForMessage` and calls it from
   `reprocessInboundEmailAction`.
3. Adds forward `20260814200000` to backfill any open rows still missing
   metadata.
4. Advances types manifest tip (data-only migration; hash unchanged).

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814200000` was not observed in this run.
