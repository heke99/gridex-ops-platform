import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { refreshExpisoftReceiverCertificateAction, saveEdielPartyRegistryEntryAction } from '@/app/admin/ediel/actors/actions'

export const dynamic = 'force-dynamic'

export default async function EdielActorsPage() {
  const context = await requirePlatformAdminAccess()
  const [actorsResult, partiesResult, addressesResult] = await Promise.all([
    supabaseService
    .from('ediel_actor_settings')
    .select('id, company_id, ediel_id, actor_ediel_id, actor_role, role, sub_role, environment, is_active, status, updated_at')
    .order('updated_at', { ascending: false })
      .limit(100),
    supabaseService
      .from('ediel_parties')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabaseService
      .from('ediel_party_addresses')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200),
  ])
  const actors = actorsResult.data ?? []
  const parties = partiesResult.error ? [] : partiesResult.data ?? []
  const addresses = addressesResult.error ? [] : addressesResult.data ?? []
  const addressesByParty = new Map<string, typeof addresses>()
  for (const address of addresses) {
    const existing = addressesByParty.get(address.party_id) ?? []
    existing.push(address)
    addressesByParty.set(address.party_id, existing)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel Party Registry" subtitle="Superadmin-register för Ediel-parter, PRODAT-subadresser, SMTP och transport security." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="space-y-8 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-950">Skapa eller uppdatera Ediel-part</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Real grid owners kan markeras synliga i kundflödet. Edielportalen/testsystem ska inte vara synlig för normal kundskapning. PRODAT-rader med tom business code gäller hela familjen och kan överskuggas av en exakt Z13/Z14/etc-rad.
          </p>
          <form action={saveEdielPartyRegistryEntryAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input name="name" placeholder="Namn" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="organizationNumber" placeholder="Org.nr (valfritt)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="edielId" placeholder="Ediel ID, t.ex. 11900" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="status" defaultValue="needs_verification" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="verified">verified</option>
              <option value="needs_verification">needs_verification</option>
              <option value="draft">draft</option>
              <option value="inactive">inactive</option>
              <option value="blocked">blocked</option>
            </select>
            <select name="source" defaultValue="grid_owner_confirmation" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="grid_owner_confirmation">grid_owner_confirmation</option>
              <option value="manual_verified">manual_verified</option>
              <option value="ediel_registry">ediel_registry</option>
              <option value="ediel_catalog">ediel_catalog</option>
              <option value="manual">manual</option>
              <option value="import">import</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" name="visibleToCustomerFlow" value="true" />
              Synlig som grid owner i kundflöde
            </label>
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 p-3 text-xs">
              {['grid_owner', 'electricity_supplier', 'energy_service_company', 'brp', 'ediel_portal', 'test_counterparty', 'grid_owner_in_agt_context', 'system_supplier', 'other'].map((role) => (
                <label key={role} className="inline-flex items-center gap-1">
                  <input type="checkbox" name="roles" value={role} />
                  {role}
                </label>
              ))}
            </div>
            <input name="messageFamily" defaultValue="PRODAT" placeholder="Message family" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="businessCode" placeholder="Business code, tomt/* = familjeroute" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="environment" defaultValue="test" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="test">test</option>
              <option value="production">production</option>
              <option value="agt">agt</option>
            </select>
            <input name="qualifier" defaultValue="ZZ" placeholder="Qualifier" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="subaddress" placeholder="PRODAT subadress, t.ex. PRODAT-SE" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="smtpAddress" placeholder="SMTP, t.ex. 11900@tvlab.se" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="transportSecurityMode" defaultValue="required_encrypted" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="required_encrypted">required_encrypted</option>
              <option value="encrypted">encrypted</option>
              <option value="unencrypted">unencrypted</option>
              <option value="needs_verification">needs_verification</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" name="requiresSubaddress" value="true" />
              Subadress krävs
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" name="certificateRequired" value="true" defaultChecked />
              Mottagarcertifikat krävs
            </label>
            <input name="receiverCertificateId" placeholder="Receiver public certificate id" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="addressStatus" defaultValue="needs_verification" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="active">active</option>
              <option value="needs_verification">needs_verification</option>
              <option value="inactive">inactive</option>
              <option value="expired">expired</option>
            </select>
            <input name="lastVerifiedAt" type="datetime-local" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <textarea name="notes" rows={3} placeholder="Anteckningar / verifieringskälla" className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 xl:col-span-4" />
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Spara Ediel-part</button>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {parties.map((party) => (
          <section key={party.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{party.status}</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">{party.name}</h2>
            <div className="mt-1 font-mono text-sm text-slate-700">{party.ediel_id}</div>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="font-bold text-slate-500">Roller</dt><dd>{Array.isArray(party.roles) ? party.roles.join(', ') || '—' : String(party.roles ?? '—')}</dd></div>
              <div><dt className="font-bold text-slate-500">Kundflöde</dt><dd>{party.visible_to_customer_flow ? 'synlig' : 'dold'}</dd></div>
              <div><dt className="font-bold text-slate-500">Källa</dt><dd>{party.source ?? '—'}</dd></div>
            </dl>
            <div className="mt-4 space-y-2">
              {(addressesByParty.get(party.id) ?? []).map((address) => (
                <div key={address.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="font-mono font-bold text-slate-950">
                    {address.ediel_id}:{address.qualifier}{address.subaddress ? `:${address.subaddress}` : ''}
                  </div>
                  <div className="mt-1 text-slate-700">{address.environment} · {address.message_family} {address.business_code ?? '*'} · {address.smtp_address}</div>
                  <div className="mt-1 font-semibold text-slate-800">{address.transport_security_mode} · cert {address.receiver_certificate_id ?? 'saknas'}</div>
                  <form action={refreshExpisoftReceiverCertificateAction} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="partyId" value={party.id} />
                    <input type="hidden" name="edielId" value={address.ediel_id} />
                    <input type="hidden" name="subaddress" value={address.subaddress ?? ''} />
                    <input type="hidden" name="smtpEmail" value={address.smtp_address} />
                    <input type="hidden" name="forceRefresh" value="true" />
                    <button className="rounded-lg border border-emerald-300 bg-white px-3 py-1 font-semibold text-emerald-800">
                      Fetch receiver certificate from Expisoft
                    </button>
                    <span className="font-mono text-slate-600">mail={address.smtp_address}</span>
                  </form>
                  <div className="mt-2 break-all text-slate-600">
                    ldap://sodir01.expisoft.se:389/c=se?userCertificate?sub?mail={address.smtp_address}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {actors.map((row) => (
          <section key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{row.environment ?? 'miljö saknas'}</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">{row.ediel_id ?? row.actor_ediel_id ?? 'Ediel-id saknas'}</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="font-bold text-slate-500">Bolag</dt><dd>{row.company_id ?? 'Platform'}</dd></div>
              <div><dt className="font-bold text-slate-500">Roll</dt><dd>{row.actor_role ?? row.role ?? '—'} / {row.sub_role ?? '—'}</dd></div>
              <div><dt className="font-bold text-slate-500">Status</dt><dd>{row.status ?? (row.is_active ? 'active' : 'inactive')}</dd></div>
            </dl>
          </section>
        ))}
        </section>
      </main>
    </div>
  )
}
