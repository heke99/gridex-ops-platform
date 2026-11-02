import {randomUUID} from 'node:crypto'
import Link from 'next/link'
import {redirect} from 'next/navigation'
import {requireAdminPageAccess} from '@/lib/admin/guards'
import {assertContractTenant,loadCustomerTenantContext} from '@/lib/tenant/entityGuards'
import {supabaseService} from '@/lib/supabase/service'
import {proposeSignedContractAmendmentAction} from './actions'

export const dynamic='force-dynamic'

export default async function SignedContractAmendmentPage({params,searchParams}:{
  params:Promise<{id:string;contractId:string}>
  searchParams:Promise<{error?:string}>
}) {
  const [{id:customerId,contractId},query]=await Promise.all([params,searchParams])
  const access=await requireAdminPageAccess({allOf:['contracts.write','contracts.create']})
  const {companyId}=await loadCustomerTenantContext(customerId,access)
  await assertContractTenant({companyId,customerId,contractId})
  const {data:predecessor,error}=await supabaseService.from('customer_contracts')
    .select('id,contract_name,contract_number,status,signed_at,metering_point_id')
    .eq('company_id',companyId).eq('customer_id',customerId).eq('id',contractId).single()
  if(error) throw error
  const eligible=['signed','active'].includes(predecessor.status)&&Boolean(predecessor.signed_at)&&Boolean(predecessor.metering_point_id)
  const drafts=eligible?await supabaseService.from('customer_contracts')
    .select('id,contract_name,contract_number,starts_at')
    .eq('company_id',companyId).eq('customer_id',customerId)
    .eq('metering_point_id',predecessor.metering_point_id).eq('status','draft')
    .is('signed_at',null).is('locked_at',null).order('created_at',{ascending:false}).limit(100):null
  if(drafts?.error) throw drafts.error
  const candidates=(drafts?.data??[]) as Array<{id:string;contract_name:string|null;contract_number:string|null;starts_at:string|null}>
  const back=`/admin/customers/${customerId}?tab=contracts#contracts`
  async function submit(form:FormData) {
    'use server'
    // The action independently authenticates and checks BOTH contracts and the
    // native command; neither the page closure nor hidden fields grants scope.
    const result=await proposeSignedContractAmendmentAction(form)
    if(result.status==='invalid') redirect(`/admin/customers/${customerId}/contracts/${contractId}/amend?error=${encodeURIComponent(result.message)}`)
    redirect(`/admin/customers/${customerId}/contracts/${result.receipt.successorContractId}/signature`)
  }
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
    <Link href={back} className="text-sm underline">Tillbaka till kundens avtal</Link>
    <section className="space-y-4 rounded-2xl border bg-white p-6">
      <h1 className="text-2xl font-semibold">Ändra signerat avtal</h1>
      <p>Tidigare avtal: {predecessor.contract_number??predecessor.contract_name??predecessor.id}</p>
      <p>Välj ett nytt avtalsförslag från kundens ordinarie avtalsflöde. Kunden behöver granska och signera de nya villkoren. Det tidigare avtalet och dess historik sparas.</p>
      <p>Ändring stöds vid ett framtida månadsskifte för tillsvidareavtal om förbrukning, med samma uppsägningstid och utan bindningstid eller engångsavgifter. Det nya förslagets startdatum ska vara ändringsdatumet. Ändringen behåller den befintliga leveransen.</p>
      {query.error?<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{query.error}</p>:null}
      {!eligible?<p role="alert">Ett signerat avtal med kopplad mätpunkt krävs.</p>:candidates.length===0?<p>Skapa först ett nytt osignerat avtalsförslag för samma anläggning i kundens ordinarie avtalsflöde.</p>:<form action={submit} className="space-y-4">
        <input type="hidden" name="customer_id" value={customerId}/>
        <input type="hidden" name="predecessor_contract_id" value={contractId}/>
        <input type="hidden" name="request_id" value={randomUUID()}/>
        <label className="grid gap-1">Nytt avtalsförslag
          <select name="successor_contract_id" required defaultValue="" className="rounded-lg border p-2">
            <option value="" disabled>Välj avtalsförslag</option>
            {candidates.map(c=><option key={c.id} value={c.id}>{c.contract_number??c.contract_name??c.id} — start {c.starts_at?.slice(0,10)??'saknas'}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Nya villkor gäller från
          <input type="date" name="effective_from" required className="rounded-lg border p-2"/>
        </label>
        <label className="grid gap-1">Orsak till ändringen
          <textarea name="reason" required maxLength={1000} rows={3} className="rounded-lg border p-2"/>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="acknowledge_new_signature" required/>
          <span>Kunden ska granska och signera den nya avtalsversionen innan ändringen kan träda i kraft.</span>
        </label>
        <button className="rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white">Spara ändringsförslag och fortsätt till signering</button>
      </form>}
    </section>
  </main>
}
