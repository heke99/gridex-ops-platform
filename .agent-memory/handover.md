# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-4764` closes post-`73936c7c`
(#145) second-order residuals.

Main tip `#145` invented review metadata on `manual_review` entry and synced
Processa om for non-terminal jobs, but:

1. Sync excluded terminal `done`/`failed` rows. After resolve→done (or failed),
   Processa om could leave the message in `manual_review` without an open
   review job/form, or leave a stale terminal job after a successful reprocess.
2. Worker/Processa om set `review_reason` from the status token `manual_review`
   and wiped `error_message`, so the UI (which prefers `review_reason`) showed
   an opaque reason instead of the processor's actionable text.
3. Successful Processa om marked `done` without stamping resolution metadata.

This branch:

1. Extends `processInboundEmailMessage` to return `reason` and forwards it
   through the worker finish path and Processa om sync.
2. Updates `syncActiveInboundProcessingJobForMessage` to target the newest job
   of any status and stamp `review_resolution=reprocessed` on done.
3. Refuses inventing `review_reason` from the literal `manual_review` token.
4. Adds forward `20260814210000` to repair open opaque reasons from message
   `error_message` / `match_status`.
5. Advances types manifest tip (data-only migration; hash unchanged).

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814210000` was not observed in this run.
