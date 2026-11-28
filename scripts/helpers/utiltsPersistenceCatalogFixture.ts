// Discovery omits only confirmed SQL comments; literals still carry late-bound names.
export function nativeCatalogDiscoverySource(source: string): string {
  const view = source.split(''), word = /[A-Za-z0-9_$\u0080-\uFFFF]/
  const mask = (i: number) => { if (source[i] !== '\r' && source[i] !== '\n') view[i] = ' ' }
  for (let i = 0; i < source.length;) {
    if (source.startsWith('--', i)) { while (i < source.length && !/[\r\n]/.test(source[i])) mask(i++); continue }
    if (source.startsWith('/*', i)) {
      let depth = 1; mask(i++); mask(i++)
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; mask(i++); mask(i++) }
        else if (source.startsWith('*/', i)) { depth--; mask(i++); mask(i++) }
        else mask(i++)
      }
      if (depth) return source
      continue
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++], escaped = quote === "'" && /[Ee]/.test(source[i - 2] ?? '') && (i < 3 || !word.test(source[i - 3]))
      let closed = false
      while (i < source.length) {
        if (source[i] === '\\' && quote === "'") { if (!escaped) return source; i += 2; continue }
        if (source[i++] !== quote) continue
        if (source[i] === quote) { i++; continue }
        closed = true; break
      }
      if (!closed) return source
      continue
    }
    if (source[i] === '$' && (i === 0 || !word.test(source[i - 1]))) {
      const tag = /^(?:\$\$|\$[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*\$)/.exec(source.slice(i))?.[0]
      if (tag) { const end = source.indexOf(tag, i + tag.length); if (end < 0) return source; i = end + tag.length; continue }
    }
    i++
  }
  return view.join('')
}

export const persistenceCatalogOwners = [
  ['public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)', '20261001110500_ediel_utilts_current_execution_actor.sql', 'public.gridex_persist_utilts_consumption_v1'],
  ['gridex_utilts_binding.require_execution_actor_v1(uuid,uuid)', '20261001110500_ediel_utilts_current_execution_actor.sql', 'gridex_utilts_binding.require_execution_actor_v1'],
  ['gridex_utilts_binding.persist_consumption_before_actor_v1(uuid,text,uuid,text,text,jsonb)', '20261001051410_ediel_utilts_persist_reading_followup_owner.sql', 'public.gridex_persist_utilts_consumption_v1'],
  ['gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)', '20261001053437_ediel_utilts_rejected_reference_diagnostic_v3.sql', 'gridex_utilts_binding.persist_consumption_before_precision_v1'],
  ['gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb)', '20261001010230_ediel_utilts_lossless_transaction_reference_v2.sql', 'gridex_utilts_binding.persist_series_v1'],
  ['gridex_utilts_binding.persist_series_legacy_v1(uuid,text,uuid,text,jsonb)', '20260928181500_utilts_held_retry_stable_reservation.sql', 'gridex_utilts_binding.persist_series_v1'],
  ['gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)', '20261001010230_ediel_utilts_lossless_transaction_reference_v2.sql', 'gridex_utilts_binding.persist_series_v2'],
  ['public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb)', '20260923135706_ediel_utilts_consumption_binding_v1.sql', 'public.gridex_persist_utilts_transactions_v1'],
] as const

export const scannerCases: [string, string, boolean][] = [
  ['real call', 'PERFORM gridex_utilts_binding.persist_series_v2();', true],
  ['line comment', '-- persist_series_v2\r\nSELECT 1;', false],
  ['line comment EOF', '-- persist_series_v2', false],
  ['nested blocks', '/* outer /* persist_series_v2 */ outer */ SELECT 1;', false],
  ['comment then call', '/* ignored */ SELECT persist_series_v2();', true],
  ['commented name then call', '/* persist_series_v2 */ SELECT persist_series_v2();', true],
  ['nested comment then quoted call', '/* outer /* persist_series_v2 */ outer */ SELECT "persist_series_v2"();', true],
  ['single literal', "EXECUTE '-- persist_series_v2 /* marker */';", true],
  ['doubled single', "EXECUTE 'it''s -- persist_series_v2';", true],
  ['escape single', String.raw`EXECUTE E'it\'s -- persist_series_v2';`, true],
  ['escape backslash', String.raw`EXECUTE e'path\\' || 'persist_series_v2';`, true],
  ['double identifier', 'SELECT "a""--persist_series_v2";', true],
  ['dollar body', 'EXECUTE $$-- persist_series_v2 /* marker */$$;', true],
  ['tagged dollar', 'EXECUTE $body_1$-- persist_series_v2$body_1$;', true],
  ['unicode dollar', 'EXECUTE $å_1$-- persist_series_v2$å_1$;', true],
  ['identifier dollars', 'SELECT foo$tag$; -- persist_series_v2\n', false],
  ['positional parameter', 'SELECT $1; -- persist_series_v2\n', false],
  ['CRLF blocks', '/* persist_series_v2\r\n*/\r\nSELECT 1;', false],
  ['unclosed single', "SELECT 'unterminated -- persist_series_v2", true],
  ['unclosed identifier', 'SELECT "unterminated -- persist_series_v2', true],
  ['unclosed dollar', 'SELECT $body$unterminated -- persist_series_v2', true],
  ['unclosed block', '/* unterminated persist_series_v2', true],
  ['ordinary backslash ambiguity', String.raw`SELECT 'path\' -- persist_series_v2`, true],
]

// 20261003150200 (U-04) rewrites persist_series_v2 by guarded needle/replace.
export const persistenceCatalogBodyPatches: Record<string, [string, string]> = {
  'gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)': ['20261003150200_ediel_utilts_late_version_and_err_ack_dispatcher.sql', 'u04'],
}

export function createUtiltsPersistenceCatalogFixture() {
  const signatures = persistenceCatalogOwners.map(([signature]) => signature)
  const publicEntry = signatures[0]
  const ownedPersistence = 'gridex_e66_intake.persist_owned_utilts_v1(uuid,text,uuid,text,text,jsonb,uuid)'
  const ownedMetering = 'gridex_e66_intake.consume_owned_e66_meter_v1(uuid,uuid,text,integer,uuid,jsonb)'
  const scopedMetering = 'gridex_e66_intake.consume_owned_e66_meter_scoped_v1(uuid,uuid,text,integer,uuid,jsonb,uuid[])'
  const mixedQualification = 'gridex_e66_intake.commit_mixed_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,jsonb)'
  const mixedSeal = 'gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(uuid,uuid,uuid)'
  const durableOwners = [ownedPersistence, ownedMetering]
  const privateE66Owners = [...durableOwners, scopedMetering, mixedQualification]
  // Each new callsite is paired with the committed migration that defines it.
  const actorCheck = 'require_execution_actor_v1'
  const writer = 'persist_owned_utilts_v1'
  const meter = 'consume_owned_e66_meter_v1'
  const scopedMeter = 'consume_owned_e66_meter_scoped_v1'
  const mixedWriter = 'commit_mixed_qualification_v1'
  const mixedQualificationMigration = '20261124152310_qualify_mixed_e66_per_ide.sql'
  const mixedMeteringMigration = '20261124152320_normalize_mixed_e66_per_ide.sql'
  const mixedReplyMigration = '20261124152330_verify_mixed_e66_e73_reply_basis.sql'
  const laterCallers = [
    [ownedMetering, mixedMeteringMigration, scopedMeter],
    [mixedQualification, mixedQualificationMigration, writer],
    [scopedMetering, mixedMeteringMigration, actorCheck],
    ['gridex_e66_metering_stage.consume_mixed_chunk_v1(uuid,text,uuid,uuid,uuid,text,integer,integer)', mixedMeteringMigration, scopedMeter],
    ['public.gridex_commit_mixed_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,jsonb)', mixedQualificationMigration, mixedWriter],
    ['gridex_e66_intake.mixed_billing_admission_v1(uuid,uuid,uuid)', '20261124152402_prepare_mixed_e66_billing_in_test.sql', actorCheck],
    ['gridex_e66_intake.mixed_billing_admission_v2(uuid,uuid,uuid,uuid)', '20261125100112_restore_legacy_mixed_e66_correction_replacement.sql', actorCheck],
    ['gridex_e66_intake.prepare_mixed_billing_v2(uuid,uuid,uuid)', '20261125100110_project_mixed_e66_multisource_billing_underlays.sql', actorCheck],
    ['gridex_e66_intake.read_mixed_e73_coverage_v1(uuid,text,uuid,uuid)', mixedReplyMigration, actorCheck],
    ['gridex_e66_intake.read_mixed_e73_ide_readiness_v1(uuid,text,uuid,uuid,text)', mixedReplyMigration, actorCheck],
    [mixedSeal, '20261125100109_seal_mixed_e66_multisource_billing_coverage.sql', actorCheck],
    ['public.gridex_commit_e66_e50_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)', '20261125100106_complete_durable_e66_e50_utilts_err.sql', writer],
    ['public.gridex_read_mixed_e66_billing_readiness_batch_v1(uuid,uuid,uuid,integer,integer)', '20261125100111_read_mixed_e66_billing_readiness_batch.sql', actorCheck],
    ['public.gridex_requalify_planned_move_out_metering_value_v1(uuid,uuid,text,uuid)', '20261125100129_requalify_single_planned_move_out_metering.sql', actorCheck, 'migration-history-manifest.runtime.additions.json'],
  ] as const
  const serviceEntries = new Set<string>([publicEntry, ...laterCallers.map(([signature]) => signature).filter(signature => signature.startsWith('public.'))])
  const baselineOwners = new Set<string>(signatures)
  const allowed = new Set<string>([...signatures, ...durableOwners, ...laterCallers.map(([signature]) => signature)])
  const privateOwners = [...signatures.filter(signature => signature.startsWith('gridex_utilts_binding.')), ...privateE66Owners]
  // Keep actor checks and persistence calls explicit for every reviewed E66 caller.
  const reviewedE66Calls = new Map<string, string[]>([
    [publicEntry, [actorCheck, writer]],
    [ownedPersistence, [actorCheck, 'persist_consumption_before_actor_v1']],
    ['gridex_e66_intake.require_dispatch_scope(uuid,text,uuid,uuid)', [actorCheck]],
    ['gridex_e66_request_retry.require_terminal_lease(uuid,text,uuid,uuid,uuid,uuid)', [actorCheck]],
    ['public.gridex_claim_e66_terminal_handoff_v1(uuid,text,uuid,uuid)', [actorCheck]],
    ['public.gridex_discover_e66_terminal_handoff_v1(uuid,text,uuid,uuid)', [actorCheck]],
    ['public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)', [actorCheck]],
    ['public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)', [writer]],
    ['public.gridex_commit_e66_matched_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb,jsonb)', [writer]],
    ['public.gridex_commit_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)', [writer]],
    ['public.gridex_consume_dispatched_e66_metering_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)', [meter]],
    ['public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)', [meter]],
    ...laterCallers.map(([signature, , callee]): [string, string[]] => [signature, [callee]]),
  ])
  return {
    signatures, publicEntry, ownedPersistence, ownedMetering, mixedSeal, durableOwners, privateE66Owners,
    laterCallers, serviceEntries, baselineOwners, allowed, privateOwners, reviewedE66Calls,
    durableProducerNames: [writer, meter, scopedMeter, mixedWriter],
  }
}
