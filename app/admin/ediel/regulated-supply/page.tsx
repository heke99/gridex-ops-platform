import { requireAdminPageAccess } from '@/lib/admin/guards'
import { UUID_PATTERN } from '@/lib/ediel/matching/postgrestFilter'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import type { Database } from '@/supabase/database.types'
import RegulatedSupplyWorkspace, { type GroundChoice } from './workspace'

export const dynamic = 'force-dynamic'

const route = '/admin/ediel/regulated-supply'
const discoveryLimit = 100
const scopedPageSize = 50
const contractStatuses = ['signed', 'active']
type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>
type Contract = Pick<Database['public']['Tables']['customer_contracts']['Row'],
  'id' | 'customer_id' | 'metering_point_id' | 'contract_number' | 'signed_version' | 'contract_version'>
type ConsumptionPeriod = Pick<Database['public']['Tables']['customer_supply_periods']['Row'], 'id' | 'start_date' | 'end_date'> & {
  point: Pick<Database['public']['Tables']['metering_points']['Row'], 'ediel_metering_point_id'>
}
type Workspace = Parameters<typeof RegulatedSupplyWorkspace>[0]

async function readCandidates(db: Db, companyId: string, reference: string): Promise<Contract[]> {
  const query = () => db.from('customer_contracts').select('id,customer_id,metering_point_id,contract_number,signed_version,contract_version')
    .eq('company_id', companyId).in('status', contractStatuses).not('signed_at', 'is', null)
  if (!reference) {
    const { data, error } = await query().order('signed_at', { ascending: false }).order('id', { ascending: false }).limit(discoveryLimit + 1)
    if (error) throw error
    return data ?? []
  }
  if (UUID_PATTERN.test(reference)) {
    const { data, error } = await query().eq('id', reference).maybeSingle()
    if (error) throw error
    if (data) return [data]
  }
  const { data, error } = await query().eq('contract_number', reference).maybeSingle()
  if (error) throw error
  return data ? [data] : []
}

async function* scopedPages<Row extends { id: string }>(read: (after: string | null) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  let after: string | null = null
  for (;;) {
    const { data, error } = await read(after)
    if (error) throw error
    if (!Array.isArray(data) || data.length > scopedPageSize) throw new Error('regulated_supply_selection_incomplete')
    if (!data.length) return
    for (const row of data) {
      if (!UUID_PATTERN.test(row?.id) || (after && row.id <= after)) throw new Error('regulated_supply_selection_incomplete')
      after = row.id
    }
    yield data
  }
}

async function uniqueContract(db: Db, companyId: string, customerId: string, pointId: string, contractId: string) {
  let match: string | null = null
  for await (const rows of scopedPages(after => {
    const query = db.from('customer_contracts').select('id,signed_version,contract_version')
      .eq('company_id', companyId).eq('customer_id', customerId).eq('metering_point_id', pointId)
      .in('status', contractStatuses).order('id').limit(scopedPageSize)
    return after ? query.gt('id', after) : query
  })) {
    // Native admission counts signed versions that still match the contract.
    for (const row of rows) {
      if (row.signed_version === null || row.signed_version !== row.contract_version) continue
      if (match !== null) return false
      match = row.id
    }
  }
  return match === contractId
}

async function consumptionChoices(db: Db, companyId: string, customerId: string): Promise<Workspace['consumption']> {
  const choices: Workspace['consumption'] = []
  for await (const rows of scopedPages(after => {
    const query = db.from('customer_supply_periods')
      .select('id,start_date,end_date,point:metering_points!customer_supply_periods_company_meter_fkey!inner(ediel_metering_point_id)')
      .eq('company_id', companyId).eq('customer_id', customerId).in('status', ['active', 'confirmed_by_grid_owner'])
      .eq('point.customer_id', customerId).eq('point.product_direction', 'consumption').not('point.ediel_metering_point_id', 'is', null)
      .order('id').limit(scopedPageSize)
    // The named composite FK resolves each period to one company-owned point.
    return (after ? query.gt('id', after) : query).overrideTypes<ConsumptionPeriod[], { merge: false }>()
  })) {
    for (const period of rows) {
      const point = period.point?.ediel_metering_point_id
      if (point) choices.push({ id: period.id, customerId, label: `${point} · ${period.start_date}${period.end_date ? `–${period.end_date}` : ''}` })
    }
  }
  return choices
}

async function exactChoice(db: Db, companyId: string, contract: Contract): Promise<GroundChoice | null> {
  const { customer_id: customerId, metering_point_id: pointId } = contract
  if (!customerId || !pointId || contract.signed_version === null || contract.signed_version !== contract.contract_version) return null
  const { data: point, error } = await db.from('metering_points').select('id,ediel_metering_point_id,product_direction')
    .eq('company_id', companyId).eq('id', pointId).eq('customer_id', customerId).maybeSingle()
  if (error) throw error
  if (!point?.ediel_metering_point_id || (point.product_direction !== 'consumption' && point.product_direction !== 'production')) return null

  const [identity, onlyContract] = await Promise.all([
    db.from('metering_points').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('ediel_metering_point_id', point.ediel_metering_point_id),
    uniqueContract(db, companyId, customerId, pointId, contract.id),
  ])
  if (identity.error) throw identity.error
  if (identity.count === null || !Number.isSafeInteger(identity.count) || identity.count < 0) throw new Error('regulated_supply_selection_incomplete')
  if (identity.count !== 1 || !onlyContract) return null
  return { customerId, contractId: contract.id, pointId: point.id, point: point.ediel_metering_point_id,
    direction: point.product_direction, label: `Avtal ${contract.contract_number ?? 'utan nummer'} · ${point.ediel_metering_point_id}` }
}

export default async function RegulatedSupplyPage({ searchParams }: { searchParams: Promise<{ artifactId?: string | string[]; contract?: string | string[] }> }) {
  const read = ['communication.read', 'contracts.read', 'metering.read']
  const access = await requireAdminPageAccess({ allOf: read })
  if (!access.companyId || !read.every(p => access.permissions.includes(p))) {
    return <main className="p-6"><h1 className="text-xl font-semibold">Rättsgrund för särskild leverans</h1><p>Välj ett bolag där du har behörighet att läsa kommunikation, avtal och anläggningar.</p></main>
  }

  const params = await searchParams
  const artifactId = typeof params.artifactId === 'string' ? params.artifactId : ''
  const reference = typeof params.contract === 'string' ? params.contract.trim() : ''
  const companyId = access.companyId
  const canArchive = ['communication.write', 'contracts.read', 'metering.write'].every(p => access.permissions.includes(p))
  let candidates: Contract[] = []
  let choice: GroundChoice | null = null
  let consumption: Workspace['consumption'] = []
  let agreements: Workspace['agreements'] = []
  let readFailed = false
  if (canArchive) {
    try {
      const db = await createSupabaseServerClient()
      candidates = await readCandidates(db, companyId, reference)
      if (reference && candidates[0]) {
        const scopedChoice = await exactChoice(db, companyId, candidates[0])
        if (scopedChoice?.customerId) {
          const [periods, agreementResult] = await Promise.all([
            scopedChoice.direction === 'production' ? consumptionChoices(db, companyId, scopedChoice.customerId) : [],
            supabaseService.from('tenant_bilateral_agreements').select('id,environment,capability_code,source_reference')
              .eq('company_id', companyId).eq('is_enabled', true).in('capability_code', ['PRODAT:Z04:A', 'PRODAT:Z04:D']).limit(100),
          ])
          if (agreementResult.error) throw agreementResult.error
          consumption = periods
          agreements = agreementResult.data ?? []
          choice = scopedChoice
        }
      }
    } catch {
      readFailed = true
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <h1 className="mb-2 text-2xl font-semibold">Rättsgrund för särskild leverans</h1>
      <p className="mb-6">Arkivera originalet för anvisad leverans eller mottagningsplikt. En annan behörig granskare prövar utfärdarens intyg och bolagets aktuella mandat. En godkänd grund registrerar ingen leverans. Nätägarens kvalificerade meddelande prövas separat.</p>
      {canArchive && (
        <div className="mb-6 space-y-3">
          <form action={route} method="get" className="flex flex-wrap items-end gap-3">
            {artifactId && <input type="hidden" name="artifactId" value={artifactId} />}
            <label className="min-w-0 grow">Sök på avtalsnummer eller avtals-ID<input type="search" name="contract" defaultValue={reference} className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
            <button type="submit" className="rounded bg-blue-700 px-4 py-2 text-white">Sök avtal</button>
          </form>
          {!reference && candidates.length > 0 && (
            <form action={route} method="get" className="flex flex-wrap items-end gap-3">
              {artifactId && <input type="hidden" name="artifactId" value={artifactId} />}
              <label className="min-w-0 grow">Senaste undertecknade avtal<select name="contract" required defaultValue="" className="mt-1 block w-full rounded border border-gray-400 p-2">
                <option value="">Välj avtal</option>
                {candidates.slice(0, discoveryLimit).map(contract => <option key={contract.id} value={contract.id}>{contract.contract_number ?? contract.id}</option>)}
              </select></label>
              <button type="submit" className="rounded bg-blue-700 px-4 py-2 text-white">Läs anläggning</button>
            </form>
          )}
          {candidates.length > discoveryLimit && <p>Visar de 100 senaste undertecknade avtalen. Sök för att hitta ett äldre avtal.</p>}
          {readFailed && <p role="alert">Avtalets anläggning och valbara underlag kunde inte läsas. Försök igen.</p>}
          {!readFailed && reference && !choice && <p>Inget entydigt undertecknat avtal med aktuell anläggning kunde bekräftas i valt bolag.</p>}
        </div>
      )}
      <RegulatedSupplyWorkspace choices={choice ? [choice] : []} consumption={consumption} agreements={agreements} initialArtifactId={artifactId}
        canArchive={canArchive} canReview={canArchive && access.permissions.includes('ediel.regulated_supply.review')} />
    </main>
  )
}
