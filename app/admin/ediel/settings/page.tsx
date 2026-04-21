// app/admin/ediel/settings/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  saveEdielActorSettingsAction,
  saveEdielMessageRuleAction,
} from '@/app/admin/ediel/settings/actions'
import type {
  EdielActorSettingsRow,
  EdielMessageRuleRow,
} from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'yellow'
        ? 'bg-amber-100 text-amber-700'
        : tone === 'red'
          ? 'bg-rose-100 text-rose-700'
          : tone === 'blue'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-700'

  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${toneClass}`}>{text}</span>
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
  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue ?? ''}
      placeholder={placeholder}
      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
    />
  )
}

function Select({
  name,
  defaultValue,
  children,
}: {
  name: string
  defaultValue?: string | number | null
  children: React.ReactNode
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue == null ? '' : String(defaultValue)}
      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
    >
      {children}
    </select>
  )
}

function Checkbox({
  name,
  defaultChecked,
  label,
}: {
  name: string
  defaultChecked?: boolean
  label: string
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300"
      />
      <span>{label}</span>
    </label>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

export default async function AdminEdielSettingsPage() {
  const context = await requireAnyPermissionServer(['communication.read'])

  const supabase = await createSupabaseServerClient()

  const [
    actorSettingsResult,
    messageRulesResult,
  ] = await Promise.all([
    supabase
      .from('ediel_actor_settings')
      .select('*')
      .order('environment', { ascending: true })
      .order('updated_at', { ascending: false }),
    supabase
      .from('ediel_message_rules')
      .select('*')
      .order('message_family', { ascending: true })
      .order('message_code', { ascending: true })
      .order('valid_from', { ascending: false, nullsFirst: false }),
  ])

  if (actorSettingsResult.error) throw actorSettingsResult.error
  if (messageRulesResult.error) throw messageRulesResult.error

  const actorSettings = (actorSettingsResult.data ?? []) as EdielActorSettingsRow[]
  const messageRules = (messageRulesResult.data ?? []) as EdielMessageRuleRow[]

  const activeTestActor = actorSettings.find(
    (row) => row.environment === 'test' && row.is_active
  )
  const activeProdActor = actorSettings.find(
    (row) => row.environment === 'production' && row.is_active
  )

  const activeRuleCount = messageRules.filter((row) => row.is_active).length
  const pendingNegativeSupport = messageRules.filter(
    (row) => row.supports_negative_response
  ).length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel settings"
        subtitle="Aktörskort, versionsregler och ack-policy för test och produktion."
        userEmail={context.email}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiv test-aktör</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {activeTestActor?.actor_ediel_id ?? 'Saknas'}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiv prod-aktör</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {activeProdActor?.actor_ediel_id ?? 'Saknas'}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiva regler</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {activeRuleCount}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Regler med negativ respons</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {pendingNegativeSupport}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">Aktörskort</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ett aktivt aktörskort per miljö. När du markerar en rad som aktiv
              stängs övriga av i samma miljö.
            </p>
          </div>

          <div className="space-y-6">
            {actorSettings.map((row) => (
              <form
                key={row.id}
                action={saveEdielActorSettingsAction}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <input type="hidden" name="id" value={row.id} />
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Pill text={row.environment} tone={row.environment === 'production' ? 'red' : 'blue'} />
                  <Pill text={row.is_active ? 'Aktiv' : 'Inaktiv'} tone={row.is_active ? 'green' : 'slate'} />
                  <span className="text-xs text-slate-500">
                    Uppdaterad {formatDate(row.updated_at)}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Input name="actor_name" defaultValue={row.actor_name} placeholder="Actor name" />
                  <Input name="actor_ediel_id" defaultValue={row.actor_ediel_id} placeholder="Actor Ediel ID" />
                  <Input name="actor_role" defaultValue={row.actor_role} placeholder="Actor role" />
                  <Select name="environment" defaultValue={row.environment}>
                    <option value="test">test</option>
                    <option value="production">production</option>
                  </Select>
                  <Input name="sender_name" defaultValue={row.sender_name} placeholder="Sender name" />
                  <Input name="sender_sub_address" defaultValue={row.sender_sub_address} placeholder="Sender sub address" />
                  <Input
                    name="default_application_reference"
                    defaultValue={row.default_application_reference}
                    placeholder="Application reference"
                  />
                  <Input name="default_timezone" defaultValue={row.default_timezone} placeholder="Timezone" type="number" />
                  <Input name="default_charset" defaultValue={row.default_charset} placeholder="Charset" />
                  <Select name="default_test_flag" defaultValue={row.default_test_flag}>
                    <option value="1">1</option>
                    <option value="0">0</option>
                  </Select>
                  <Input name="smtp_from_email" defaultValue={row.smtp_from_email} placeholder="SMTP from email" />
                  <Input name="smtp_reply_to_email" defaultValue={row.smtp_reply_to_email} placeholder="SMTP reply-to" />
                  <Input name="mailbox" defaultValue={row.mailbox} placeholder="Mailbox" />
                  <Input name="notes" defaultValue={row.notes} placeholder="Notes" />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Checkbox name="is_active" defaultChecked={row.is_active} label="Aktiv för miljön" />
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Spara aktörskort
                  </button>
                </div>
              </form>
            ))}

            <form
              action={saveEdielActorSettingsAction}
              className="rounded-2xl border border-dashed border-slate-300 p-4"
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Skapa nytt aktörskort</h3>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Input name="actor_name" placeholder="Actor name" />
                <Input name="actor_ediel_id" placeholder="Actor Ediel ID" />
                <Input name="actor_role" placeholder="Actor role" />
                <Select name="environment" defaultValue="test">
                  <option value="test">test</option>
                  <option value="production">production</option>
                </Select>
                <Input name="sender_name" placeholder="Sender name" />
                <Input name="sender_sub_address" placeholder="Sender sub address" />
                <Input name="default_application_reference" placeholder="Application reference" />
                <Input name="default_timezone" defaultValue={1} type="number" />
                <Input name="default_charset" defaultValue="UNOC" />
                <Select name="default_test_flag" defaultValue="1">
                  <option value="1">1</option>
                  <option value="0">0</option>
                </Select>
                <Input name="smtp_from_email" placeholder="SMTP from email" />
                <Input name="smtp_reply_to_email" placeholder="SMTP reply-to" />
                <Input name="mailbox" placeholder="Mailbox" />
                <Input name="notes" placeholder="Notes" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <Checkbox name="is_active" label="Aktivera direkt" />
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Skapa aktörskort
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">Meddelanderegler</h2>
            <p className="mt-1 text-sm text-slate-500">
              Här styr du version, riktning och kvittenskrav per meddelandetyp.
            </p>
          </div>

          <div className="space-y-4">
            {messageRules.map((row) => (
              <form
                key={row.id}
                action={saveEdielMessageRuleAction}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <input type="hidden" name="id" value={row.id} />

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Pill text={row.message_family} tone="blue" />
                  <Pill text={row.message_code} tone="slate" />
                  <Pill text={row.version_code} tone="yellow" />
                  <Pill text={row.is_active ? 'Aktiv' : 'Inaktiv'} tone={row.is_active ? 'green' : 'slate'} />
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <Input name="message_family" defaultValue={row.message_family} />
                  <Input name="message_code" defaultValue={row.message_code} />
                  <Select name="message_standard" defaultValue={row.message_standard}>
                    <option value="edifact">edifact</option>
                    <option value="xml">xml</option>
                    <option value="ai_list">ai_list</option>
                  </Select>
                  <Input name="version_code" defaultValue={row.version_code} />
                  <Select name="direction" defaultValue={row.direction}>
                    <option value="both">both</option>
                    <option value="inbound">inbound</option>
                    <option value="outbound">outbound</option>
                  </Select>
                  <Input name="valid_from" defaultValue={row.valid_from} type="date" />
                  <Input name="valid_to" defaultValue={row.valid_to} type="date" />
                  <Input name="notes" defaultValue={row.notes} placeholder="Notes" />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Checkbox
                    name="requires_contrl"
                    defaultChecked={row.requires_contrl}
                    label="Kräver CONTRL"
                  />
                  <Checkbox
                    name="requires_aperak"
                    defaultChecked={row.requires_aperak}
                    label="Kräver APERAK"
                  />
                  <Checkbox
                    name="supports_negative_response"
                    defaultChecked={row.supports_negative_response}
                    label="Stödjer negativ respons"
                  />
                  <Checkbox name="is_active" defaultChecked={row.is_active} label="Aktiv regel" />

                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Spara regel
                  </button>
                </div>
              </form>
            ))}

            <form
              action={saveEdielMessageRuleAction}
              className="rounded-2xl border border-dashed border-slate-300 p-4"
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Skapa ny regel</h3>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <Input name="message_family" placeholder="PRODAT / UTILTS / APERAK ..." />
                <Input name="message_code" placeholder="Z05 / E66 / APERAK ..." />
                <Select name="message_standard" defaultValue="edifact">
                  <option value="edifact">edifact</option>
                  <option value="xml">xml</option>
                  <option value="ai_list">ai_list</option>
                </Select>
                <Input name="version_code" placeholder="E5SE5A / csv-2025-10-01 ..." />
                <Select name="direction" defaultValue="both">
                  <option value="both">both</option>
                  <option value="inbound">inbound</option>
                  <option value="outbound">outbound</option>
                </Select>
                <Input name="valid_from" type="date" />
                <Input name="valid_to" type="date" />
                <Input name="notes" placeholder="Notes" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <Checkbox name="requires_contrl" label="Kräver CONTRL" />
                <Checkbox name="requires_aperak" label="Kräver APERAK" />
                <Checkbox name="supports_negative_response" label="Stödjer negativ respons" />
                <Checkbox name="is_active" label="Aktiv regel" defaultChecked />

                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Skapa regel
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}