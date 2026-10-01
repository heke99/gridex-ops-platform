# Contract permission authority continuation

Status: APPLICATION_BOUNDARY_VERIFIED; canonical database effect/rollback not executed locally. This is a bounded F7/U09 correction, not whole OPS acceptance.

## Reproduced application defect

The base admin guard reads canonical_authenticated_tenant_context and returns its authoritative isPlatformAdmin flag. The contract permission helper instead treated any platform_admin/super_admin-looking role name as global authority. With a company-scoped platform-named role and canonical isPlatformAdmin=false, the real requireContractPermissionAction skipped both the delegated-role policy and requested permission. The same helper also rejected authoritative global context when its role-name payload was empty.

The new `__tests__/contract-permission-authority.test.ts` initially produced7 assertion failures/4 passes, with no setup exception. The real archiveContractAction reached the mocked mutation boundary and success redirect instead of denying; the real previewContractDeleteAction returned ready instead of error. These demonstrate the application authorization bypass and wrong dispatch, **not an actual database mutation/exploit**: canonical base guard and resource/repository/cache/redirect boundaries were isolated with synthetic fixtures.

## Correction and outcome

`lib/contracts/permissions.ts` now accepts global authority only when context.isPlatformAdmin === true. Missing runtime authority fails closed. Delegated pricing_manager/contract_manager role plus exact requested permission remains required for other actors. Genuine global authority works even when role-name payload is empty. Existing role normalization for delegated roles remains.

After correction all11 tests pass, including company-scoped platform_admin and super_admin denials, missing authority, genuine global authority, delegated authorized roles, missing permission/nondelegatable role denials, and both real archive/preview server action boundaries. The denied archive action resolves no resource and dispatches no mutation; denied preview returns controlled error/null preview before privileged repository dispatch. Legitimate global archive reaches the boundary with the actual actor and selected company/offer, then the expected Next redirect.

## Executed checks

- Explicit Node22 Vitest run of contract-permission-authority.test.ts: initial7 RED/4 PASS; final11/11 GREEN.
- Explicit Node22 scoped ESLint covering permissions, test and both OPS inventory scripts:PASS,0 errors/warnings.
- Explicit Node22 `tsc --noEmit -p tsconfig.tests.json --incremental false --pretty false`:PASS.
- Actual Node22 PATH `npm run lint` globally after the inventory CLI variable correction:PASS exit0,0 errors/101 existing warnings. Frozen inventory evidence bytes were preserved.
- No hosted database/provider/action/browser or production operation was performed in this continuation.

## Canonical SQL remains a separate gate

Source follow-through finds the latest gridex_contract_actor_has_permission declaration in `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql`, also reflected in schema.sql. Its user_roles platform-name branch does not require company_id IS NULL. gridex_assert_contract_permission delegates to that helper, and publishing RPCs call the assert function. This SQL authority boundary was handed to root for an isolated forward migration/native regression review.

No genuine local PostgreSQL/GoTrue replay is available in this worker environment. Whether a scoped platform-named role is actually creatable under the current canonical role command, what the current native permission function returns, and whether every real publication/archive/delete RPC denies and rolls back require actual native evidence. This report does not claim a database exploit, rollback PASS, or canonical SQL fix. Application denial is verified before command dispatch; SQL scope alignment remains explicit.

## Separate CI lint repair

Actual candidate4b quality CI failed @next/next/no-assign-module-variable in the inventory script's loop variable named module. The prior scoped lint had omitted inventory scripts. Only that binding and matching references were renamed sourceModule; no discovery semantics or frozen evidence bytes changed. Global lint was then run successfully as recorded above. Original source inventory is not regenerated or relabeled as runtime evidence.
