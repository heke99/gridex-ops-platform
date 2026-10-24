import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { getCustomerExportContext } from '@/lib/cis/db-shared'
import { readContractInvoicee } from '@/lib/ediel/production/contractInvoicee'
import { readContractRequestedMethodSource } from '@/lib/ediel/production/contractRequestedMethodSource'
import { resolveSwedishProdatEndUserExport } from '@/lib/ediel/prodat/customerIdentity'
import { prodatDate203, prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'

/**
 * FINDINGS F87/F88: a new agreement's Z03 carries a dependent invoicee group (NAD+IV, P26.A s.23/82/109). The
 * renderer only accepts it from an independently selected, server-owned source on the switch
 * (validation_snapshot.portalData.dependentConditionFacts.invoiceeObjects); a saved preview never satisfies it,
 * and nothing wrote that source, so no Z03 could be rendered. Before the Z03 is prepared, the invoicee is
 * selected from the signed contract exactly as the switch cancellation does (readContractInvoicee): the
 * contract's own billing party, compared with the end user's masterdata as of the requested start. Never blocks:
 * a source that cannot be selected keeps the Z03 held with the renderer's reason. The agreement reference
 * (RFF+ANJ, required for Z03) had no writer either (F88); it is the bound power of attorney's reference.
 */
export async function selectInvoiceeBeforeSwitch(input: { companyId: string; actorUserId: string; switchRequestId: string }) {
  const { data: row, error } = await tenantSelect(input.companyId, "supplier_switch_requests", 'id,company_id,customer_id,site_id,metering_point_id,contract_id,customer_contract_id,requested_start_date,validation_snapshot,power_of_attorney_id')
    .eq('id', input.switchRequestId)
    .returns<Array<{ id: string; company_id: string; customer_id: string | null; site_id: string | null; metering_point_id: string | null; contract_id: string | null; customer_contract_id: string | null; requested_start_date: string | null; validation_snapshot: unknown; power_of_attorney_id: string | null }>>().maybeSingle()
  if (error || row?.company_id !== input.companyId || !row.customer_id || !row.site_id || !row.metering_point_id) return
  const companyId = row.company_id as string
  const contractId = (row.customer_contract_id ?? row.contract_id) as string | null
  const asOf = prodatMarketMinuteToUtc(prodatDate203(row.requested_start_date as string | null))
  if (!contractId || !asOf) return

  for (const environment of ['production', 'test'] as const) {
    try {
      const basis = await readContractRequestedMethodSource({ companyId, contractId, actorUserId: input.actorUserId, environment })
      if (basis.status !== 'authorized') continue
      const context = await getCustomerExportContext({ companyId, customerId: row.customer_id as string, siteId: row.site_id as string,
        meteringPointId: row.metering_point_id as string, actorUserId: input.actorUserId, environment, requireCustomerMasterdata: true, asOf })
      const endUser = resolveSwedishProdatEndUserExport({ customer: context.customer as unknown as Record<string, unknown> | null,
        customerLifeEvent: context.customerLifeEvent, customerMasterdata: context.customerMasterdata })
      const qualifier = endUser.identity.qualifier
      if (!context.customerMasterdata || !endUser.identity.id || (qualifier !== 'SE1' && qualifier !== 'SE2')) continue
      const selected = await readContractInvoicee({ companyId, customerId: row.customer_id as string, contractId,
        meteringPointId: basis.pointId, identityAgency: basis.identityAgency,
        endUser: { identity: { id: endUser.identity.id, qualifier, agency: '260' }, nameParts: endUser.nameLines ?? [endUser.identity.name],
          streetParts: endUser.addressLines, postalCode: endUser.postalCode ?? '', city: endUser.city ?? '', country: endUser.country } })
      const snapshot = (row.validation_snapshot && typeof row.validation_snapshot === 'object' ? row.validation_snapshot : {}) as Record<string, unknown>
      const portalData = (snapshot.portalData && typeof snapshot.portalData === 'object' ? snapshot.portalData : {}) as Record<string, unknown>
      const facts = (portalData.dependentConditionFacts && typeof portalData.dependentConditionFacts === 'object' ? portalData.dependentConditionFacts : {}) as Record<string, unknown>
      // RFF+ANJ: the reference of the signed power of attorney bound to this switch, as the platform's own
      // PRODAT context reads it (lib/ediel/prodatContext.ts); never a saved preview's value.
      const agreementReference = await boundPowerOfAttorneyReference({ companyId, customerId: row.customer_id as string, powerOfAttorneyId: row.power_of_attorney_id as string | null })
      const next = { ...snapshot, portalData: { ...portalData, invoicee: selected.invoicee, powerOfAttorneyReference: agreementReference,
        dependentConditionFacts: { ...facts, invoiceeObjects: [selected.fact] } } }
      const { error: writeError } = await tenantUpdate(companyId, "supplier_switch_requests", { validation_snapshot: next, updated_at: new Date().toISOString(), updated_by: input.actorUserId })
        .eq('id', row.id).eq('company_id', companyId)
      if (writeError) throw writeError
      return
    } catch (failure) {
      console.warn('[switch] invoicee selection skipped', { switchRequestId: input.switchRequestId, environment, failure })
    }
  }
}

async function boundPowerOfAttorneyReference(input: { companyId: string; customerId: string; powerOfAttorneyId: string | null }) {
  if (!input.powerOfAttorneyId) return null
  const { data, error } = await tenantSelect(input.companyId, "powers_of_attorney", 'reference,status')
    .eq('id', input.powerOfAttorneyId).eq('company_id', input.companyId).eq('customer_id', input.customerId).returns<Array<{ reference: string | null; status: string | null }>>().maybeSingle()
  if (error) throw error
  const reference = typeof data?.reference === 'string' ? data.reference.trim() : ''
  return reference && ['signed', 'active'].includes(String(data?.status)) ? reference : null
}
