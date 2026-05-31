import { supabaseService } from '@/lib/supabase/service'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
  listAllBillingUnderlays,
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
  listAllPartnerExports,
} from '@/lib/cis/db'
import {
  listAllSupplierSwitchRequests,
  listPowersOfAttorneyByCustomerIds,
} from '@/lib/operations/db'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { PowerOfAttorneyRow, SupplierSwitchRequestRow } from '@/lib/operations/types'

export type OperationsIntegrityData = {
  sites: CustomerSiteRow[]
  contracts: CustomerContractRow[]
  switchRequests: SupplierSwitchRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
  billingUnderlays: BillingUnderlayRow[]
  partnerExports: PartnerExportRow[]
  allMeteringValues: MeteringValueRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
}

export async function loadOperationsIntegrityData(
  customerIds: string[],
  companyId: string | null
): Promise<OperationsIntegrityData> {
  if (customerIds.length === 0) {
    return {
      sites: [],
      contracts: [],
      switchRequests: [],
      dataRequests: [],
      billingUnderlays: [],
      partnerExports: [],
      allMeteringValues: [],
      meteringPoints: [],
      powersOfAttorney: [],
    }
  }

  const [sitesResponse, contractsResponse, switchRequests, dataRequests, billingUnderlays, partnerExports, allMeteringValues] =
    await Promise.all([
      (() => {
        let query = supabaseService.from('customer_sites').select('*').in('customer_id', customerIds)
        if (companyId) query = query.eq('company_id', companyId)
        return query
      })(),
      (() => {
        let query = supabaseService.from('customer_contracts').select('*').in('customer_id', customerIds)
        if (companyId) query = query.eq('company_id', companyId)
        return query
      })(),
      listAllSupplierSwitchRequests(supabaseService, {
        status: 'all',
        requestType: 'all',
        query: '',
        companyId,
      }),
      listAllGridOwnerDataRequests({ status: 'all', scope: 'all', query: '', companyId }),
      listAllBillingUnderlays({ status: 'all', query: '', companyId }),
      listAllPartnerExports({ status: 'all', exportKind: 'all', query: '', companyId }),
      listAllMeteringValues({ query: '', companyId }),
    ])

  if (sitesResponse.error) throw sitesResponse.error
  if (contractsResponse.error) throw contractsResponse.error

  const sites = (sitesResponse.data ?? []) as CustomerSiteRow[]
  const siteIds = sites.map((site) => site.id)
  const [meteringPoints, powersOfAttorney] = await Promise.all([
    siteIds.length > 0 ? listMeteringPointsBySiteIds(supabaseService, siteIds, { companyId }) : [],
    listPowersOfAttorneyByCustomerIds(supabaseService, customerIds, {
      companyId,
      limit: Math.max(customerIds.length * 5, 100),
    }),
  ])

  return {
    sites,
    contracts: (contractsResponse.data ?? []) as CustomerContractRow[],
    switchRequests,
    dataRequests,
    billingUnderlays,
    partnerExports,
    allMeteringValues,
    meteringPoints,
    powersOfAttorney,
  }
}
