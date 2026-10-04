import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = readFileSync(
  `${root}/supabase/migrations/20260725120000_billing_readiness_and_supply_activation_v1.sql`,
  'utf8',
)
const stateMachineFacade = readFileSync(
  `${root}/lib/ediel/flows/inboundBusinessStateMachine.ts`,
  'utf8',
)
const stateMachineImplementation = readFileSync(
  `${root}/lib/ediel/flows/inboundBusinessStateMachineLegacy.ts`,
  'utf8',
)
const supplyConsumer = readFileSync(`${root}/lib/ediel/flows/supplyMarketTransition.ts`, 'utf8')
const normalSourceOwner = readFileSync(`${root}/supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql`, 'utf8')

describe('atomic customer supply activation', () => {
  it('moves every committed lifecycle write into one idempotent RPC', () => {
    expect(migration).toContain('activate_customer_supply_v1')
    expect(migration).toContain('customer_supply_periods')
    expect(migration).toContain('supplier_switch_requests')
    expect(migration).toContain('customer_contracts')
    expect(migration).toContain('customer_application_workflows')
    expect(migration).toContain('website_customer_applications')
    expect(migration).toContain("'supply.started'")
    expect(migration).toContain('customer_operation_jobs')
    expect(migration).toContain('webhook_deliveries')
    expect(migration).toContain('on conflict')
  })

  it('keeps the policy facade and confirms through the source owner before a separate due activation', () => {
    expect(stateMachineFacade).toContain('resolveCanonicalEdielPolicy')
    expect(stateMachineFacade).toContain('applyLegacyInboundBusinessStateMachine')
    expect(stateMachineImplementation).toContain('await applySupplyMarketSource(')
    expect(stateMachineImplementation).not.toContain("supabaseService.rpc('activate_customer_supply_v1'")
    expect(supplyConsumer).toContain("rpc()('ediel_apply_supply_source_v1'")
    expect(normalSourceOwner).toContain('normal_supply_activation_not_due')
    expect(normalSourceOwner).toContain('normal_switch_coverage_is_current_v1')
    const completionBranch = stateMachineImplementation.slice(
      stateMachineImplementation.indexOf("if (outcome === 'supplier_switch_completed'"),
      stateMachineImplementation.indexOf("if (outcome === 'supplier_switch_review_required'"),
    )
    expect(completionBranch).not.toContain("strictUpdate('supplier_switch_requests'")
    expect(completionBranch).not.toContain('ensureSupplyPeriodFromSwitch')
  })

  it('keeps ready billing configuration snapshots immutable', () => {
    expect(migration).toContain('billing_configuration_snapshot_sha256')
    expect(migration).toContain('gridex_reject_billing_configuration_snapshot_mutation')
    expect(migration).toContain('billing_configuration_snapshot_is_immutable')
  })
})
