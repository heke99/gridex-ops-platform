import { saveCompanyEdielActorAction } from '@/app/admin/companies/[id]/ediel-actions'
import { applicationReferenceForActor, normalizeActorRole, normalizeActorSubrole, normalizeEnvironmentType } from '@/lib/ediel/actorRoles'
import type { CompanyActorConfiguration, EdielConfigRow } from '@/lib/ediel/companyActorConfiguration'

type CompanyLike = {
  id: string
  name?: string | null
  primary_contact_email?: string | null
}

type ActorProfileDefinition = {
  key: string
  title: string
  badge: string
  actorRole: 'supplier' | 'energy_service_company'
  actorSubrole: 'DDQ' | 'DGI'
  defaultEnvironmentType: 'agt_test'
  defaultApplicationReference: string
  brpRelevant: boolean
}

const ACTOR_PROFILES: ActorProfileDefinition[] = [
  {
    key: 'supplier-ddq',
    title: 'Elleverantor / DDQ',
    badge: 'supplier · DDQ',
    actorRole: 'supplier',
    actorSubrole: 'DDQ',
    defaultEnvironmentType: 'agt_test',
    defaultApplicationReference: '23-DDQ-PRODAT',
    brpRelevant: true,
  },
  {
    key: 'dgi',
    title: 'Energitjansteforetag / DGI',
    badge: 'energy_service_company · DGI',
    actorRole: 'energy_service_company',
    actorSubrole: 'DGI',
    defaultEnvironmentType: 'agt_test',
    defaultApplicationReference: '23-DGI-PRODAT',
    brpRelevant: false,
  },
]

function rowText(row: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!row) return null
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function rowBool(row: Record<string, unknown> | null | undefined, key: string, fallback = false): boolean {
  if (!row || row[key] === null || row[key] === undefined) return fallback
  return row[key] === true
}

function labelForEnvironmentType(value: string | null | undefined) {
  const normalized = normalizeEnvironmentType(value)
  const labels: Record<typeof normalized, string> = {
    tgt_test: 'TGT test',
    agt_test: 'AGT test',
    bilateral_test: 'Bilateral test',
    production: 'Production',
  }
  return labels[normalized]
}

function fieldValue(row: EdielConfigRow | null, key: string, fallback = ''): string {
  return rowText(row, key) ?? fallback
}

function findActorProfile(actors: EdielConfigRow[], definition: ActorProfileDefinition): EdielConfigRow | null {
  return actors.find((row) => {
    const role = normalizeActorRole(rowText(row, 'actor_role', 'role'))
    const subrole = normalizeActorSubrole(rowText(row, 'actor_subrole', 'sub_role'), role, rowText(row, 'application_reference', 'default_application_reference'))
    return role === definition.actorRole && subrole === definition.actorSubrole
  }) ?? null
}

function ProfileReadinessPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      {label}: {ok ? 'klar' : 'saknas'}
    </span>
  )
}

function ActorProfileSummaryCard({
  actor,
  definition,
}: {
  actor: EdielConfigRow | null
  definition: ActorProfileDefinition
}) {
  const edielId = rowText(actor, 'ediel_id', 'actor_ediel_id')
  const applicationReference =
    rowText(actor, 'application_reference', 'default_application_reference') ??
    applicationReferenceForActor({ actorRole: definition.actorRole, actorSubrole: definition.actorSubrole, messageFamily: 'PRODAT' }) ??
    definition.defaultApplicationReference
  const smtp = rowText(actor, 'registered_smtp_address', 'smtp_from_email', 'mailbox')
  const contact = rowText(actor, 'contact_email', 'technical_contact_email', 'smtp_reply_to_email')
  const brp = rowText(actor, 'default_supplier_brp_ediel_id', 'brp_ediel_id')

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">{definition.badge}</p>
          <h3 className="mt-2 text-lg font-black text-slate-950">{definition.title}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${rowBool(actor, 'is_active') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {rowBool(actor, 'is_active') ? 'Aktiv' : 'Ej aktiv'}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Ediel ID</dt>
          <dd className="mt-1 font-mono text-slate-900">{edielId ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Environment type</dt>
          <dd className="mt-1 text-slate-900">{labelForEnvironmentType(rowText(actor, 'environment_type'))}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Application ref</dt>
          <dd className="mt-1 font-mono text-xs text-slate-900">{applicationReference}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">SMTP/kontakt</dt>
          <dd className="mt-1 break-all text-slate-900">{smtp ?? contact ?? '-'}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <ProfileReadinessPill ok={Boolean(edielId)} label="Ediel ID" />
        <ProfileReadinessPill ok={Boolean(smtp || contact)} label="Kontakt" />
        <ProfileReadinessPill ok={rowBool(actor, 'prodat_enabled', true)} label="PRODAT" />
        <ProfileReadinessPill ok={rowBool(actor, 'utilts_enabled', true)} label="UTILTS" />
        {definition.brpRelevant ? <ProfileReadinessPill ok={Boolean(brp)} label="BRP" /> : null}
      </div>
    </article>
  )
}

function ActorProfileForm({
  actor,
  company,
  definition,
}: {
  actor: EdielConfigRow | null
  company: CompanyLike
  definition: ActorProfileDefinition
}) {
  const environment = rowText(actor, 'environment') ?? 'test'
  const environmentType = normalizeEnvironmentType(rowText(actor, 'environment_type'), environment)
  const applicationReference =
    rowText(actor, 'application_reference', 'default_application_reference') ??
    applicationReferenceForActor({ actorRole: definition.actorRole, actorSubrole: definition.actorSubrole, messageFamily: 'PRODAT' }) ??
    definition.defaultApplicationReference

  return (
    <form action={saveCompanyEdielActorAction} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <input type="hidden" name="company_id" value={company.id} />
      <input type="hidden" name="actor_role" value={definition.actorRole} />
      <input type="hidden" name="actor_subrole" value={definition.actorSubrole} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">{definition.badge}</p>
          <h3 className="mt-2 text-lg font-black text-slate-950">{definition.title}</h3>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
          {environmentType}
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Miljo</span>
          <select name="environment" defaultValue={environment} className="rounded-2xl border border-slate-300 px-4 py-3">
            <option value="test">test</option>
            <option value="production">production</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Environment type</span>
          <select name="environment_type" defaultValue={environmentType} className="rounded-2xl border border-slate-300 px-4 py-3">
            <option value="agt_test">AGT test</option>
            <option value="tgt_test">TGT test</option>
            <option value="bilateral_test">Bilateral test</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Ediel ID</span>
          <input name="ediel_id" defaultValue={fieldValue(actor, 'ediel_id', fieldValue(actor, 'actor_ediel_id'))} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Application reference</span>
          <input name="application_reference" defaultValue={applicationReference} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Registered SMTP</span>
          <input name="registered_smtp_address" type="email" defaultValue={fieldValue(actor, 'registered_smtp_address', fieldValue(actor, 'smtp_from_email'))} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Kontaktmail</span>
          <input name="contact_email" type="email" defaultValue={fieldValue(actor, 'contact_email', company.primary_contact_email ?? '')} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Test resource name</span>
          <input name="test_resource_name" defaultValue={fieldValue(actor, 'test_resource_name')} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Test resource email</span>
          <input name="test_resource_email" type="email" defaultValue={fieldValue(actor, 'test_resource_email')} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Sender subaddress</span>
          <input name="sender_subaddress" defaultValue={fieldValue(actor, 'sender_subaddress', fieldValue(actor, 'sender_sub_address'))} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Receiver subaddress</span>
          <input name="receiver_subaddress" defaultValue={fieldValue(actor, 'receiver_subaddress', fieldValue(actor, 'receiver_sub_address'))} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">IT-system profile ID</span>
          <input name="approved_it_system_profile_id" defaultValue={fieldValue(actor, 'approved_it_system_profile_id')} className="rounded-2xl border border-slate-300 px-4 py-3 font-mono text-xs" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Giltig fran</span>
          <input type="date" name="valid_from" defaultValue={fieldValue(actor, 'valid_from')} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Giltig till</span>
          <input type="date" name="valid_to" defaultValue={fieldValue(actor, 'valid_to')} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Default supplier BRP Ediel ID</span>
          <input name="default_supplier_brp_ediel_id" defaultValue={fieldValue(actor, 'default_supplier_brp_ediel_id', fieldValue(actor, 'brp_ediel_id'))} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Default supplier BRP name</span>
          <input name="default_supplier_brp_name" defaultValue={fieldValue(actor, 'default_supplier_brp_name', fieldValue(actor, 'brp_name'))} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">Production mode</span>
          <select name="production_mode" defaultValue={fieldValue(actor, 'production_mode', 'disabled')} className="rounded-2xl border border-slate-300 px-4 py-3">
            <option value="disabled">disabled</option>
            <option value="shadow">shadow</option>
            <option value="active">active</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-4 text-sm font-bold text-slate-800">
        <label className="inline-flex items-center gap-2"><input type="checkbox" name="is_ombud" defaultChecked={rowBool(actor, 'is_ombud')} /> Ombud</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" name="prodat_enabled" defaultChecked={rowBool(actor, 'prodat_enabled', true)} /> PRODAT</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" name="utilts_enabled" defaultChecked={rowBool(actor, 'utilts_enabled', true)} /> UTILTS</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={actor ? rowBool(actor, 'is_active') : true} /> Aktiv</label>
      </div>

      <button className="mt-5 rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
        Spara {definition.actorSubrole}
      </button>
    </form>
  )
}

export function CompanyActorProfilesPanel({
  company,
  config,
}: {
  company: CompanyLike
  config: CompanyActorConfiguration
}) {
  const profiles = ACTOR_PROFILES.map((definition) => ({
    definition,
    actor: findActorProfile(config.actors, definition),
  }))

  return (
    <section id="ediel-actor" className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Ediel actor profiles</h2>
            <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
              Bolaget kan ha separata Ediel-profiler for supplier/DDQ och energitjansteforetag/DGI. Backend anvander roll, subroll och environment_type for route, AGT och production guards.
            </p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
            {profiles.filter((profile) => profile.actor && rowBool(profile.actor, 'is_active')).length}/{profiles.length} aktiva
          </span>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {profiles.map((profile) => (
            <ActorProfileSummaryCard key={profile.definition.key} actor={profile.actor} definition={profile.definition} />
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {profiles.map((profile) => (
          <ActorProfileForm key={profile.definition.key} company={company} actor={profile.actor} definition={profile.definition} />
        ))}
      </div>
    </section>
  )
}
