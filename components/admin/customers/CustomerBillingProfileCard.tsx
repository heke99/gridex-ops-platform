'use client'

import { useId } from 'react'
import { saveCustomerBillingProfileAction, saveCustomerContractBillingOverrideAction } from '@/app/admin/customers/[id]/billing-profile-actions'
import type { BillingProfileFields, EffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import CustomerEditForm from './CustomerEditForm'

const fieldClass = 'min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
const billingFields: Array<{ key: keyof BillingProfileFields; label: string; type?: string; autoComplete?: string }> = [
  { key: 'recipient', label: 'Fakturamottagare', autoComplete: 'organization' },
  { key: 'distributionMethod', label: 'Distribution' },
  { key: 'email', label: 'Faktura-e-post', type: 'email', autoComplete: 'email' },
  { key: 'reference', label: 'Fakturareferens' },
  { key: 'street', label: 'Fakturaadress', autoComplete: 'street-address' },
  { key: 'postalCode', label: 'Postnummer', autoComplete: 'postal-code' },
  { key: 'city', label: 'Ort', autoComplete: 'address-level2' },
  { key: 'country', label: 'Landskod', autoComplete: 'country' },
]

function billingValues(profile: EffectiveBillingProfile): Record<keyof Required<BillingProfileFields>, string | null> {
  return {
    recipient: profile.recipient, distributionMethod: profile.distributionMethod,
    email: profile.email, reference: profile.reference,
    street: profile.address.street, postalCode: profile.address.postalCode,
    city: profile.address.city, country: profile.address.country,
  }
}

/** Remove a key to inherit. An explicit null clears a field instead of inheriting it. */
export function buildBillingOverrideChanges(data: FormData): { changes: BillingProfileFields; inheritFields: Array<keyof BillingProfileFields> } {
  const changes: Record<string, string | null> = {}
  const inheritFields: Array<keyof BillingProfileFields> = []
  for (const field of billingFields) {
    const mode = data.get(`${field.key}__mode`)
    if (mode === 'inherit') inheritFields.push(field.key)
    else if (mode === 'clear') changes[field.key] = null
    else if (mode === 'override') changes[field.key] = String(data.get(field.key) ?? '').trim() || null
    else throw new Error('invalid_billing_profile_command')
  }
  return { changes: changes as BillingProfileFields, inheritFields }
}

function DistributionOptions() {
  return <><option value="">Välj distributionssätt</option><option value="email">E-post</option><option value="paper">Post</option><option value="e_invoice">E-faktura</option><option value="direct_debit">Autogiro</option></>
}

function ContractBillingOverrideEditor({ profile, idempotencyKey }: { profile: EffectiveBillingProfile; idempotencyKey: string }) {
  const formId = useId()
  const values = billingValues(profile)
  async function save(data: FormData) {
    if (!profile.contractId) return { error: true as const, code: 'invalid_billing_profile_command' }
    const result = await saveCustomerContractBillingOverrideAction({
      companyId: profile.companyId, customerId: profile.customerId, contractId: profile.contractId,
      expectedRevision: Number(data.get('expected_revision')),
      expectedOverrideRevision: Number(data.get('expected_override_revision')),
      idempotencyKey: String(data.get('idempotency_key') ?? ''),
      ...buildBillingOverrideChanges(data),
    })
    if (result.status === 'error') return { error: true as const, code: result.code }
    return result
  }

  return <CustomerEditForm key={`${profile.companyId}:${profile.customerId}:${profile.contractId}:${profile.profileRevision}:${profile.contractOverrideRevision}`} noValidate action={save} draftKey={`${profile.companyId}/${profile.customerId}/${profile.contractId}/billing-override`} submitLabel="Spara avtalsundantag" className="mt-4 space-y-4">
    <input type="hidden" name="expected_revision" defaultValue={profile.profileRevision} />
    <input type="hidden" name="expected_override_revision" defaultValue={profile.contractOverrideRevision} />
    <input type="hidden" name="idempotency_key" defaultValue={idempotencyKey} />
    <p className="text-sm text-slate-700">Välj per fält. Ärv använder kundstandarden eller avtalets befintliga adressregel. Undantag använder det angivna värdet. Rensa lämnar fältet uttryckligen tomt. Värdet används endast när Undantag är valt. Ändringen gäller framtida underlag.</p>
    <div className="space-y-4">{billingFields.map((field) => {
      const isOverride = ['contract_override', 'legacy_contract_override'].includes(profile.sources[field.key])
      const mode = isOverride ? values[field.key] === null ? 'clear' : 'override' : 'inherit'
      const source = profile.sources[field.key] === 'site_address' ? 'anläggningsadress'
        : profile.sources[field.key] === 'tenant_default' ? 'tenantstandard'
          : profile.sources[field.key] === 'missing' ? 'saknas' : isOverride ? 'avtalsundantag' : 'kundstandard'
      return <div key={field.key} className="grid min-w-0 gap-2 rounded-2xl border border-slate-200 p-3 sm:grid-cols-2">
        <label className="grid gap-1" htmlFor={`${formId}-${field.key}-mode`}><span>{field.label}: källa ({source})</span><select id={`${formId}-${field.key}-mode`} name={`${field.key}__mode`} defaultValue={mode} className={fieldClass}><option value="inherit">Ärv ordinarie profil</option><option value="override">Uttryckligt undantag</option><option value="clear">Rensa uttryckligen</option></select></label>
        <label className="grid gap-1" htmlFor={`${formId}-${field.key}-value`}><span>{field.label}: undantagsvärde</span>{field.key === 'distributionMethod'
          ? <select id={`${formId}-${field.key}-value`} name={field.key} defaultValue={values[field.key] ?? ''} className={fieldClass}><DistributionOptions /></select>
          : <input id={`${formId}-${field.key}-value`} name={field.key} type={field.type ?? 'text'} autoComplete={field.autoComplete} spellCheck={field.type === 'email' ? false : undefined} defaultValue={values[field.key] ?? ''} className={fieldClass} />}</label>
      </div>
    })}</div>
  </CustomerEditForm>
}

export default function CustomerBillingProfileCard({ profile, contracts, canEdit, idempotencyKey, providerBlockers = [] }: {
  profile: EffectiveBillingProfile
  contracts: Array<{ id: string; name: string; profile: EffectiveBillingProfile; canEdit?: boolean }>
  canEdit: boolean
  idempotencyKey: string
  providerBlockers?: Array<{ code: string; message: string }>
}) {
  const formId = useId()
  const inheritedEmails = contracts.filter((contract) => !['contract_override', 'legacy_contract_override'].includes(contract.profile.sources.email) && !contract.profile.blockers.some((blocker) => blocker.code === 'billing_profile_resource_mismatch'))
  const values = billingValues(profile)
  const canEditDefault = canEdit && Boolean(idempotencyKey) && Number.isSafeInteger(profile.profileRevision) && profile.profileRevision >= 0 && !profile.blockers.some((blocker) => blocker.code === 'billing_profile_resource_mismatch')

  async function save(data: FormData) {
    const changes = Object.fromEntries(Object.keys(values).map((key) => [key, String(data.get(key) ?? '').trim() || null])) as BillingProfileFields
    const result = await saveCustomerBillingProfileAction({
      companyId: profile.companyId, customerId: profile.customerId,
      expectedRevision: Number(data.get('expected_revision')),
      idempotencyKey: String(data.get('idempotency_key') ?? ''), changes,
    })
    if (result.status === 'error') return { error: true as const, code: result.code }
    return result
  }

  return <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div>
      <h2 className="text-lg font-semibold text-slate-950">Faktureringsstandard</h2>
      <p className="mt-1 text-sm text-slate-700">Profilrevision: {profile.profileRevision}. Kontaktmejl och inloggning ändras separat.</p>
      <p className="mt-2 text-sm text-slate-700">Ändrad standard för faktura-e-post påverkar {inheritedEmails.length} av {contracts.length} avtal. Uttryckliga undantag, utfärdade fakturor, signerade dokument och skickade exporter bevaras.</p>
    </div>
    {profile.blockers.length ? <ul aria-label="Faktureringsblockerare" className="list-inside list-disc rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{profile.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul> : null}
    {providerBlockers.length ? <ul aria-label="Blockerare för fakturaintegration" className="list-inside list-disc rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{providerBlockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul> : null}
    {canEditDefault ? <CustomerEditForm key={`${profile.companyId}:${profile.customerId}:${profile.profileRevision}`} action={save} draftKey={`${profile.companyId}/${profile.customerId}/billing-default`} submitLabel="Spara faktureringsstandard" className="space-y-4">
      <input type="hidden" name="expected_revision" defaultValue={profile.profileRevision} />
      <input type="hidden" name="idempotency_key" defaultValue={idempotencyKey} />
      <label className="grid gap-1 text-sm"><span>Distribution</span><select name="distributionMethod" defaultValue={profile.distributionMethod ?? ''} className={fieldClass}><DistributionOptions /></select></label>
      <div className="grid gap-4 sm:grid-cols-2">{billingFields.filter((field) => field.key !== 'distributionMethod').map((field) => <label key={field.key} htmlFor={`${formId}-${field.key}`} className="grid gap-1 text-sm"><span>{field.key === 'email' ? 'Standard för faktura-e-post' : field.label}</span><input id={`${formId}-${field.key}`} name={field.key} type={field.type ?? 'text'} autoComplete={field.autoComplete} spellCheck={field.type === 'email' ? false : undefined} defaultValue={values[field.key] ?? ''} className={fieldClass} /></label>)}</div>
    </CustomerEditForm> : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"><p className="font-semibold">Läsläge – aktuell behörighet, revision eller kundstatus tillåter inte ändring av faktureringsstandarden.</p><p className="mt-2 break-all">Mottagare: {profile.recipient ?? 'Saknas'} · Faktura-e-post: {profile.email ?? 'Saknas'} · Distribution: {profile.distributionMethod ?? 'Saknas'}</p></div>}
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-900">Effekt per avtal</h3>
      {contracts.length ? contracts.map((contract) => <article key={contract.id} className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="font-semibold">{contract.name}</p><p className="mt-1 break-all">Faktura-e-post: {contract.profile.email ?? 'Saknas'}</p><p className="mt-1 text-slate-700">{['customer_default', 'legacy_customer_default', 'missing'].includes(contract.profile.sources.email) && !contract.profile.blockers.some((blocker) => blocker.code === 'billing_profile_resource_mismatch') ? 'Ärver kundens standard (tom standard ger saknad faktura-e-post)' : ['contract_override', 'legacy_contract_override'].includes(contract.profile.sources.email) ? 'Uttryckligt avtalsundantag – bevaras vid standardändring' : 'Faktura-e-post saknas'}. Profilrevision {contract.profile.profileRevision}; undantagsrevision {contract.profile.contractOverrideRevision}.</p>{contract.profile.blockers.length ? <ul aria-label={`Faktureringsblockerare för ${contract.name}`} className="mt-2 list-inside list-disc rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">{contract.profile.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul> : null}{canEditDefault && contract.canEdit !== false && contract.profile.contractId && !contract.profile.blockers.some((blocker) => blocker.code === 'billing_profile_resource_mismatch') ? <details className="mt-3"><summary className="cursor-pointer rounded-lg p-2 font-semibold text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Ändra avtalsundantag</summary><ContractBillingOverrideEditor profile={contract.profile} idempotencyKey={`${idempotencyKey}:override:${contract.id}`} /></details> : null}</article>) : <p className="text-sm text-slate-700">Kunden har inga avtal ännu.</p>}
    </div>
  </section>
}
