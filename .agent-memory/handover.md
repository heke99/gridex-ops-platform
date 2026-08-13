# Handover

Updated: 2026-08-13

Branch `cursor/codebase-health-and-stability-312d` is the tip-based health
vehicle after `#118` (UTILTS transactional persistence) merged to main.

It replays open `#117`/`a855` auth flash + SVK retry residuals onto the #118 tip
and hardens two UTILTS partial-success defects found in tip review:

1. Mixed guide+processability messages keep `aperakApplicationErrors` under
   message-level `functional_rejected` classification.
2. Null IDE+24 transaction ids use the same `transaction-<n>` fallback in
   TypeScript persist/ACK paths as the SQL RPC.

Prefer merging `312d` then closing `#117`/`#115` as superseded. Do not reopen
pre-#118 health branches as merge vehicles.
