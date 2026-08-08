# Open blockers

Last updated: 2026-08-08T15:26:00Z

`GRIDEX-REM-002` clean replay remains the only active release blocker in the current CI run.

Current HEAD `bc3479574904ae886916aed28209bf68dfc76264`: verify/provenance/typecheck/regressions/security PASS. Replay passes the former Energy Resolver/platform-grid-owner failure and now fails at `20260615203000_platform_go_live_route_resolver_message_center.sql:248` because `public.legal_text_versions` is absent.

The missing relation belongs to the checksum-pinned `20260613090000_batch_m_ops_master_legal_readiness.sql`. Its complete source was skipped because `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql` uses it as a derived source. The current fix preserves normal source replay while retaining the early narrow prerequisite.

PR #90 remains draft/unmerged until REM-002, the bounded final release rescan and all final same-HEAD release gates are green.
