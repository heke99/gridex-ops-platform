import { requireAdminPageAccess } from '@/lib/admin/guards'
import { postgrestEq, UUID_PATTERN } from '@/lib/ediel/matching/postgrestFilter'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import SignedBrpWorkspace from './workspace'

export const dynamic = 'force-dynamic'

const recentContractLimit = 100

export default async function SignedBrpPage({ searchParams }: {
  searchParams: Promise<{ artifactId?: string | string[]; contract?: string | string[] }>
}) {
  const rights = ['communication.read', 'customers.read', 'contracts.read']
  const access = await requireAdminPageAccess({ allOf: rights })
  if (!access.companyId || !rights.every(p => access.permissions.includes(p))) {
    return <main className="p-6"><h1 className="text-xl font-semibold">BRP i undertecknat avtal</h1><p>Välj ett bolag där du får läsa kommunikation, kunder och avtal.</p></main>
  }

  const params = await searchParams
  const artifactId = typeof params.artifactId === 'string' ? params.artifactId : ''
  const reference = typeof params.contract === 'string' ? params.contract.trim() : ''
  const id = UUID_PATTERN.test(reference) ? reference.toLowerCase() : null
  const db = await createSupabaseServerClient()
  let query = db.from('customer_contracts')
    .select('id,contract_number,signed_at')
    .eq('company_id', access.companyId)
    .in('status', ['signed', 'active'])
    .not('signed_at', 'is', null)
  if (reference) {
    query = id
      ? query.or(`${postgrestEq('id', id)},${postgrestEq('contract_number', reference)}`)
      : query.eq('contract_number', reference)
  }
  const { data, error } = await query.order('signed_at', { ascending: false })
    .order('id', { ascending: false }).limit(recentContractLimit + 1)
  if (error) {
    return <main className="p-6"><h1 className="text-xl font-semibold">BRP i undertecknat avtal</h1><p role="alert">Bolagets undertecknade avtal kunde inte läsas med aktuell behörighet.</p></main>
  }

  const rows = data ?? []
  const contracts = rows.slice(0, recentContractLimit).map(contract => ({
    id: contract.id,
    label: `${contract.contract_number ?? contract.id} · ${contract.signed_at}`,
  }))
  const selectedById = id ? contracts.findIndex(contract => contract.id === id) : -1
  if (selectedById > 0) contracts.unshift(...contracts.splice(selectedById, 1))
  const write = ['communication.write', 'customers.write', 'contracts.write'].every(p => access.permissions.includes(p))

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <h1 className="mb-2 text-2xl font-semibold">BRP i undertecknat avtal</h1>
      <p className="mb-6">Arkivera det undertecknade avtalet och originalet som uttryckligen anger samma balansansvariga part. En annan behörig granskare måste pröva originalen och utfärdarens aktuella mandat innan uppgiften får användas.</p>
      {write && (
        <div className="mb-6 space-y-2">
          <form method="get" action="/admin/ediel/signed-brp-declarations" className="flex flex-wrap items-end gap-3">
            {artifactId && <input type="hidden" name="artifactId" value={artifactId} />}
            <label className="min-w-0 grow">
              Sök på avtalsnummer eller avtals-ID
              <input type="search" name="contract" defaultValue={reference} className="mt-1 block w-full rounded border border-slate-400 p-2" />
            </label>
            <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-white">Sök avtal</button>
          </form>
          {rows.length > recentContractLimit && <p className="text-sm text-slate-600">Visar de 100 senaste undertecknade avtalen. Sök för att välja ett äldre avtal.</p>}
          {!contracts.length && <p className="text-sm text-slate-600">{reference ? 'Inget undertecknat avtal matchar sökningen.' : 'Det finns inga undertecknade avtal i valt bolag.'}</p>}
        </div>
      )}
      <SignedBrpWorkspace
        contracts={contracts}
        initialArtifactId={artifactId}
        canArchive={write && contracts.length > 0}
        canReview={write && access.permissions.includes('ediel.source.review')}
      />
    </main>
  )
}
