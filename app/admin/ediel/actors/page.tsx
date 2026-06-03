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

  const verifiedGridOwners = parties.filter((party) => Array.isArray(party.roles) && party.roles.includes('grid_owner') && party.status === 'verified').length
  const verifiedSuppliers = parties.filter((party) => Array.isArray(party.roles) && (party.roles.includes('electricity_supplier') || party.roles.includes('supplier')) && party.status === 'verified').length
  const missingCertificates = addresses.filter((address) => String(address.message_family ?? '').toUpperCase() === 'PRODAT' && !address.receiver_certificate_id).length
  const hiddenOrTestParties = parties.filter((party) => !party.visible_to_customer_flow || (Array.isArray(party.roles) && (party.roles.includes('ediel_portal') || party.roles.includes('test_counterparty')))).length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel Party Registry" subtitle="Superadmin-register för Ediel-parter, PRODAT-subadresser, SMTP och transport security." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="space-y-8 p-8">

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Verifierade nätägare</p>
            <div className="mt-2 text-3xl font-black text-emerald-950">{verifiedGridOwners}</div>
            <p className="mt-2 text-xs leading-5 text-emerald-900">Globala nätägare som kan visas i kund-/anläggningsflöden.</p>
          </div>
          <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Verifierade elleverantörer</p>
            <div className="mt-2 text-3xl font-black text-blue-950">{verifiedSuppliers}</div>
            <p className="mt-2 text-xs leading-5 text-blue-900">Globala motparter och leverantörer som kan användas i marknadsflöden.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Saknar PRODAT-certifikat</p>
            <div className="mt-2 text-3xl font-black text-amber-950">{missingCertificates}</div>
            <p className="mt-2 text-xs leading-5 text-amber-900">PRODAT-adresser utan kopplat mottagarcertifikat ska inte vara send-ready.</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Dolda/testparter</p>
            <div className="mt-2 text-3xl font-black text-slate-950">{hiddenOrTestParties}</div>
            <p className="mt-2 text-xs leading-5 text-slate-700">Edielportalen och testmotparter ska inte visas i normala kundflöden.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Produktionsflöde</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">Registrera nätägare och elleverantörer</h1>
              <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
                Superadmin registrerar marknadsparter globalt. Systemet söker publika mottagarcertifikat i Expisoft via SMTP-adressen och sparar certifikatet globalt så alla tenants kan återanvända samma verifierade part. Vanliga bolagsadmin ska bara välja verifierade aktörer, inte skapa egna Ediel-routes eller certifikat.
              </p>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">
              <div className="font-black text-blue-950">Certifikatprincip</div>
              <div>Expisoft = publika mottagarcertifikat för outbound PRODAT.</div>
              <div>Privat PFX = vår/tenantens inbound-dekryptering.</div>
              <div>Mailboxen avgör aldrig tenant; CMS + UNB + Ediel-ID gör det.</div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <form action={saveEdielPartyRegistryEntryAction} className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <input type="hidden" name="partyType" value="grid_owner" />
              <input type="hidden" name="roles" value="grid_owner" />
              <input type="hidden" name="status" value="verified" />
              <input type="hidden" name="source" value="manual_verified" />
              <input type="hidden" name="messageFamily" value="PRODAT" />
              <input type="hidden" name="environment" value="production" />
              <input type="hidden" name="transportSecurityMode" value="required_encrypted" />
              <input type="hidden" name="certificateRequired" value="true" />
              <input type="hidden" name="lookupCertificateOnSave" value="true" />
              <input type="hidden" name="visibleToCustomerFlow" value="true" />
              <input type="hidden" name="requiresSubaddress" value="true" />
              <div className="text-sm font-black text-emerald-950">Lägg till nätägare</div>
              <p className="mt-2 text-xs leading-5 text-emerald-900">För riktiga nätägare: fyll Ediel-ID, PRODAT-subadress och SMTP. Vid sparning hämtas Expisoft-certifikat automatiskt om inget certifikat redan är valt.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input name="name" placeholder="Namn, t.ex. TVLAB" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <input name="organizationNumber" placeholder="Org.nr, valfritt" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
                <input name="edielId" placeholder="Ediel ID, t.ex. 11900" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <input name="qualifier" defaultValue="ZZ" placeholder="Qualifier" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
                <input name="subaddress" placeholder="PRODAT-subadress, t.ex. PRODAT-SE" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <input name="smtpAddress" placeholder="SMTP, t.ex. 11900@tvlab.se" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <textarea name="notes" rows={3} placeholder="Verifieringskälla, kontaktperson eller Ediel-registeranteckning" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm md:col-span-2" />
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-3 text-xs leading-5 text-emerald-900">
                Efter sparning: status verified, synlig i kundflöde, PRODAT kräver kryptering och Expisoft-certifikatet kopplas globalt om lookup lyckas.
              </div>
              <button className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Spara nätägare och sök certifikat</button>
            </form>

            <form action={saveEdielPartyRegistryEntryAction} className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
              <input type="hidden" name="partyType" value="electricity_supplier" />
              <input type="hidden" name="roles" value="electricity_supplier" />
              <input type="hidden" name="roles" value="supplier" />
              <input type="hidden" name="status" value="verified" />
              <input type="hidden" name="source" value="manual_verified" />
              <input type="hidden" name="messageFamily" value="PRODAT" />
              <input type="hidden" name="environment" value="production" />
              <input type="hidden" name="transportSecurityMode" value="required_encrypted" />
              <input type="hidden" name="certificateRequired" value="true" />
              <input type="hidden" name="lookupCertificateOnSave" value="true" />
              <input type="hidden" name="visibleToCustomerFlow" value="true" />
              <input type="hidden" name="requiresSubaddress" value="true" />
              <div className="text-sm font-black text-blue-950">Lägg till elleverantör</div>
              <p className="mt-2 text-xs leading-5 text-blue-900">För externa elleverantörer eller marknadsmotparter. Tenant-elbolag ska dessutom få eget bolagskort med Ediel-ID, route-profiler och privat PFX för inbound.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input name="name" placeholder="Namn" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <input name="organizationNumber" placeholder="Org.nr, valfritt" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
                <input name="edielId" placeholder="Ediel ID" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <input name="qualifier" defaultValue="ZZ" placeholder="Qualifier" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
                <input name="subaddress" placeholder="PRODAT-subadress" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <input name="smtpAddress" placeholder="SMTP-adress" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <textarea name="notes" rows={3} placeholder="Roll: extern leverantör, tidigare leverantör, ny leverantör, testpart etc." className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm md:col-span-2" />
              </div>
              <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-3 text-xs leading-5 text-blue-900">
                Sparas som global motpart. Publikt certifikat återanvänds av alla tenants, men varje tenant skickar fortsatt med sin egen Ediel-identitet.
              </div>
              <button className="mt-4 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">Spara elleverantör och sök certifikat</button>
            </form>
          </div>
        </section>
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
