# Final bounded CIS and operations action scope repair

Changed only the handed-off CIS private bulk-company helper and the operations control automation sweep/billing-export guard substitutions. The helper uses canonical guard selection, then retains its existing non-null company membership/lifecycle validation. Both control actions retain the action guard result and select its authorized company before their existing operational-write check and scoped queries.

Tenant missing company fails before data reads/queue mutation. A selected platform company stays selected. CIS retains its existing global platform mode without a selected company; both operations control actions retain their explicit choose-company requirement. Permission lists, actor lookup, downstream row/lifecycle/provider/Ediel behavior and CIS individual paths remain untouched. No further audit paths were added.

The new actual action runtime test covers all three CIS bulk actions and both control actions, including canonical A vs legacy B, tenant null, platform selected/global distinctions, permission refusal and retained membership/lifecycle refusal. It failed22 cases with5 preexisting permission refusals passing before the source changes, then passed27/27. Existing CIS saved-customer/failure/input regressions also pass8/8, for35/35 in the bounded combined check. The test and exact source/result hashes are recorded in `cis-control-canonical-scope-receipt.json`.

Both source modules and the new test are frozen and handed to the independent shared-scope reviewer and root. Root owns final application build and rollout; no shared helper/global test, live database, migration, generated artifact or global memory edits were made in this slice.
