import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { saveEdielActorSettingsAction } from '@/app/admin/ediel/settings/actions'
import type { EdielActorSettingsRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Pill({ text, tone }: { text: string; tone: 'emerald' | 'red' | 'slate' | 'amber' }) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'red'
        ? 'border-red-200 bg-red-50 text-red-700'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>{text}</span>
}

function inputClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function selectClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
}

function Input({
  name,
  defaultValue,
  placeholder,
  type = 'text',
}: {
  name: string
  defaultValue?: string | number | null
  placeholder?: string
  type?: string
}) {
  return <input name={name} type={type} defaultValue={defaultValue ?? ''} placeholder={placeholder} className={inputClassName()} />
}

function Select({ name, defaultValue, children }: { name: string; defaultValue?: string | number | null; children: React.ReactNode }) {
  return (
    <select name={name} defaultValue={defaultValue == null ? '' : String(defaultValue)} className={selectClassName()}>
      {children}
    </select>
  )
}

function Checkbox({ name, defaultChecked, label }: { name: string; defaultChecked?: boolean; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300" />
      <span>{label}</span>
    </label>
  )
}

function ActorCard({ row, companyName }: { row: EdielActorSettingsRow; companyName?: string | null }) {
  return (
    <form key={row.id} action={saveEdielActorSettingsAction} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <input type="hidden" name="id" value={row.id} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill text={row.environment} tone={row.environment === 'production' ? 'red' : 'emerald'} />
        <Pill text={row.is_active ? 'Aktiv' : 'Inaktiv'} tone={row.is_active ? 'emerald' : 'slate'} />
        {companyName ? <Pill text={companyName} tone="amber" /> : null}
        <span className="text-xs text-slate-700">Uppdaterad {formatDate(row.updated_at)}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Input name="actor_name" defaultValue={row.actor_name} placeholder="Aktörsnamn" />
        <Input name="actor_ediel_id" defaultValue={row.actor_ediel_id} placeholder="Ediel-id" />
        <Input name="actor_role" defaultValue={row.actor_role} placeholder="Aktörsroll, t.ex. DDQ/BRP/ESP" />
        <Select name="environment" defaultValue={row.environment}>
          <option value="test">test</option>
          <option value="production">production</option>
        </Select>
        <Input name="sender_name" defaultValue={row.sender_name} placeholder="Avsändarnamn" />
        <Input name="sender_sub_address" defaultValue={row.sender_sub_address} placeholder="Sender subaddress" />
        <Input name="default_application_reference" defaultValue={row.default_application_reference} placeholder="Application reference" />
        <Input name="default_timezone" defaultValue={row.default_timezone} placeholder="Timezone" type="number" />
        <Input name="default_charset" defaultValue={row.default_charset} placeholder="Charset" />
        <Select name="default_test_flag" defaultValue={row.default_test_flag}>
          <option value="1">Testflagga 1</option>
          <option value="0">Testflagga 0</option>
        </Select>
        <Input name="smtp_from_email" defaultValue={row.smtp_from_email} placeholder="SMTP från e-post" />
        <Input name="smtp_reply_to_email" defaultValue={row.smtp_reply_to_email} placeholder="SMTP reply-to" />
        <Input name="mailbox" defaultValue={row.mailbox} placeholder="Ediel-mailbox" />
        <Input name="notes" defaultValue={row.notes} placeholder="Intern anteckning" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <Checkbox name="is_active" defaultChecked={row.is_active} label="Aktiv för miljön" />
        <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black">
          Spara aktörskort
        </button>
      </div>
    </form>
  )
}

export default async function AdminEdielSettingsPage() {
  const context = await requireAdminPageKeyAccess('ediel.settings')
  const companyScope = await getOperationalCompanyScope(context.userId)
  const supabase = await createSupabaseServerClient()

  let actorSettingsQuery = supabase.from('ediel_actor_settings').select('*')

  if (!context.isPlatformAdmin) {
    if (companyScope.companyId) {
      actorSettingsQuery = actorSettingsQuery.eq('company_id', companyScope.companyId)
    } else {
      actorSettingsQuery = actorSettingsQuery.is('company_id', null).eq('id', '__no_company_scope__')
    }
  }

  const [actorSettingsResult, companiesResult] = await Promise.all([
    actorSettingsQuery.order('environment', { ascending: true }).order('updated_at', { ascending: false }),
    context.isPlatformAdmin ? supabase.from('companies').select('id,name') : Promise.resolve({ data: [], error: null }),
  ])

  if (actorSettingsResult.error) throw actorSettingsResult.error
  if (companiesResult.error) throw companiesResult.error

  const actorSettings = (actorSettingsResult.data ?? []) as EdielActorSettingsRow[]
  const companyNameById = new Map(((companiesResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]))
  const activeTestActor = actorSettings.find((row) => row.environment === 'test' && row.is_active)
  const activeProdActor = actorSettings.find((row) => row.environment === 'production' && row.is_active)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Ediel-inställningar"
        subtitle={`Aktörsprofil, avsändaruppgifter och teknisk bolagskonfiguration för ${companyScope.companyName ?? 'valt bolag'}. Globala regler hanteras separat på plattformsnivå.`}
        userEmail={context.email}
      />

      <div className="space-y-6 p-8">
        {context.isPlatformAdmin ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Global regelstyrning är flyttad</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Den här sidan visar aktörsprofiler och bolagens tekniska Ediel-uppgifter. Versioner, message rules och globala runtime-regler ligger nu på riktiga plattformsrutter.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/admin/platform/ediel/rules" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Globala Ediel-regler</Link>
              <Link href="/admin/platform/ediel/versions" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">Versioner</Link>
              <Link href="/admin/platform/ediel/routes" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">Globala rutter</Link>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-700">Aktiv test-aktör</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{activeTestActor?.actor_ediel_id ?? 'Saknas'}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-700">Aktiv prod-aktör</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{activeProdActor?.actor_ediel_id ?? 'Saknas'}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-700">Aktörskort</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{actorSettings.length}</p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Aktörskort</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Ett aktivt aktörskort per miljö. När du markerar en rad som aktiv stängs övriga av i samma miljö för samma bolag.
            </p>
          </div>

          {actorSettings.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-700">Inga aktörskort finns ännu för den här vyn.</div>
          ) : (
            actorSettings.map((row) => <ActorCard key={row.id} row={row} companyName={row.company_id ? companyNameById.get(row.company_id) ?? null : null} />)
          )}

          <form action={saveEdielActorSettingsAction} className="rounded-3xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Skapa nytt aktörskort</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Input name="actor_name" placeholder="Aktörsnamn" />
              <Input name="actor_ediel_id" placeholder="Ediel-id" />
              <Input name="actor_role" placeholder="Aktörsroll, t.ex. DDQ/BRP/ESP" />
              <Select name="environment" defaultValue="test">
                <option value="test">test</option>
                <option value="production">production</option>
              </Select>
              <Input name="sender_name" placeholder="Avsändarnamn" />
              <Input name="sender_sub_address" placeholder="Sender subaddress" />
              <Input name="default_application_reference" placeholder="Application reference" />
              <Input name="default_timezone" type="number" defaultValue={1} />
              <Input name="default_charset" defaultValue="UNOC" />
              <Select name="default_test_flag" defaultValue={1}>
                <option value="1">Testflagga 1</option>
                <option value="0">Testflagga 0</option>
              </Select>
              <Input name="smtp_from_email" placeholder="SMTP från e-post" />
              <Input name="smtp_reply_to_email" placeholder="SMTP reply-to" />
              <Input name="mailbox" placeholder="Ediel-mailbox" />
              <Input name="notes" placeholder="Intern anteckning" />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <Checkbox name="is_active" label="Aktiv för miljön" />
              <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black">Skapa aktörskort</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
