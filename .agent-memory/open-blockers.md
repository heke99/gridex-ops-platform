# Open blockers

Last updated: 2026-08-08T15:20:00Z

`GRIDEX-REM-002` clean replay remains the active blocker.

Last verified HEAD `4cbea122dce56f08da67bd4b4df0798c8ad5349a`: verify/provenance/security PASS; replay reaches `20260613100000` and fails because `platform_grid_owners` is absent.

The complete checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql` is now preserved for normal chronological replay while both narrow prerequisites continue to run early. CI must prove this restores the platform Energy Resolver family.

PR #90 remains draft/unmerged until REM-002, final rescan, all remaining audit/remediation items and final same-HEAD release gates are green.
