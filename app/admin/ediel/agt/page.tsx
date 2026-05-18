import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/agtRuntime'
import {
  EDIEL_AGT_PORTAL_EDIEL_ID,
  EDIEL_AGT_PORTAL_SMTP,
  EDIEL_AGT_PRODAT_SUB_ADDRESS,
  EDIEL_AGT_SUPPLIER_2026A_CASES,
  isEdielAgtRunApprovalVersion,
  type EdielAgtTestCaseDefinition,
} from '@/lib/ediel/agtRegistry'
import {
  createAgtSupplierTestRunAction,
  createAllAgtSupplierTestRunsAction,
  saveAgtSupplierRuntimeAction,
} from '@/app/admin/ediel/agt/actions'
import {
  createEdielAgtOutboundDraftAction,
  createEdielAgtResponsesForInboundAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

function inputClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400'
}

function Field({
  label,
  value,
}: {
  label: string
  value: string | number | boolean | null | undefined
}) {
  const display = value === null || value === undefined || String(value).trim() === '' ? '—' : String(value)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm text-slate-950">{display}</div>
    </div>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate' | 'indigo'
  children: React.ReactNode
}) {
  const className =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'yellow'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'red'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : tone === 'blue'
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : tone === 'indigo'
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>
}

function issueTone(severity: 'error' | 'warning' | 'info') {
  if (severity === 'error') return 'red' as const
  if (severity === 'warning') return 'yellow' as const
  return 'blue' as const
}

function statusTone(status: string | null | undefined) {
  if (!status) return 'slate' as const
  if (['sent', 'received', 'acknowledged', 'passed'].includes(status)) return 'green' as const
  if (['draft', 'queued', 'prepared', 'running'].includes(status)) return 'yellow' as const
  if (['failed', 'cancelled', 'rejected'].includes(status)) return 'red' as const
  return 'slate' as const
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function RouteCard({
  title,
  family,
  route,
  profile,
}: {
  title: string
  family: 'PRODAT' | 'UTILTS'
  route: Awaited<ReturnType<typeof getEdielAgtSupplierRuntime>>['prodat']['route']
  profile: Awaited<ReturnType<typeof getEdielAgtSupplierRuntime>>['prodat']['profile']
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-950">{title}</div>
          <div className="mt-1 text-sm text-slate-500">Runtime route + Ediel profile som AGT använder.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={route?.is_active ? 'green' : 'red'}>{route?.is_active ? 'route aktiv' : 'route saknas/inaktiv'}</Badge>
          <Badge tone={profile?.is_enabled ? 'green' : 'red'}>{profile?.is_enabled ? 'profil aktiv' : 'profil saknas/inaktiv'}</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Route name" value={route?.route_name} />
        <Field label="Target email" value={route?.target_email} />
        <Field label="Sender Ediel-id" value={profile?.sender_ediel_id} />
        <Field label="Receiver Ediel-id" value={profile?.receiver_ediel_id} />
        <Field label="Sender subaddress" value={profile?.sender_sub_address} />
        <Field label="Receiver subaddress" value={profile?.receiver_sub_address} />
        <Field label="Ack mode" value={profile?.ack_mode} />
        <Field label="Encryption" value={profile?.encryption_mode} />
      </div>

      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        {family === 'PRODAT'
          ? `PRODAT AGT ska gå mot ${EDIEL_AGT_PORTAL_EDIEL_ID} med subadress ${EDIEL_AGT_PRODAT_SUB_ADDRESS} och okrypterad SMTP tills certifikat finns.`
          : `UTILTS AGT ska gå mot ${EDIEL_AGT_PORTAL_EDIEL_ID} utan subadress.`}
      </div>
    </div>
  )
}

function caseTone(hasRun: boolean) {
  return hasRun ? 'green' : 'slate'
}

function directionLabel(direction: 'actor_to_portal' | 'portal_to_actor') {
  return direction === 'actor_to_portal' ? 'Div3rsa → Edielportalen' : 'Edielportalen → Div3rsa'
}

function notesText(notes: string | string[]) {
  return Array.isArray(notes) ? notes.join(' ') : notes
}

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function parsedAgtCaseCode(message: EdielMessageRow): string | null {
  const value = message.parsed_payload?.agtTestCaseCode
  return typeof value === 'string' ? value.toUpperCase() : null
}

function rawIncludesCase(message: EdielMessageRow, testCaseCode: string): boolean {
  const marker = testCaseCode.toUpperCase()
  return [message.subject, message.process_type, message.external_reference, message.correlation_reference, message.transaction_reference, message.raw_payload]
    .some((value) => normalized(value).includes(marker))
}

function isMessageForCase(message: EdielMessageRow, testCase: EdielAgtTestCaseDefinition): boolean {
  const parsedCode = parsedAgtCaseCode(message)
  if (parsedCode && parsedCode === testCase.testCaseCode) return true

  if (message.direction === 'outbound') {
    return (
      normalized(message.process_type) === `AGT_SUPPLIER_${testCase.testCaseCode}` &&
      normalized(message.message_family) === normalized(testCase.messageFamily) &&
      normalized(String(message.message_code)) === normalized(testCase.messageCode)
    ) || rawIncludesCase(message, testCase.testCaseCode)
  }

  if (testCase.direction === 'portal_to_actor') {
    return (
      normalized(message.direction) === 'INBOUND' &&
      normalized(message.message_family) === normalized(testCase.messageFamily) &&
      normalized(String(message.message_code)) === normalized(testCase.messageCode) &&
      (normalized(message.sender_ediel_id) === EDIEL_AGT_PORTAL_EDIEL_ID || rawIncludesCase(message, testCase.testCaseCode))
    )
  }

  if (testCase.direction === 'actor_to_portal' && ['CONTRL', 'APERAK'].includes(normalized(message.message_family))) {
    return normalized(message.direction) === 'INBOUND' && rawIncludesCase(message, testCase.testCaseCode)
  }

  return false
}

function latestMessagesForCase(messages: EdielMessageRow[], testCase: EdielAgtTestCaseDefinition, direction?: 'inbound' | 'outbound') {
  return messages
    .filter((message) => (!direction || message.direction === direction) && isMessageForCase(message, testCase))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6)
}

function activeRunForCase(testRuns: EdielTestRunRow[], testCase: EdielAgtTestCaseDefinition): EdielTestRunRow | null {
  return testRuns.find((run) =>
    isEdielAgtRunApprovalVersion(run.approval_version) &&
    ['running', 'draft'].includes(run.status) &&
    run.role_code === testCase.roleCode &&
    run.test_suite === testCase.suite &&
    run.test_case_code === testCase.testCaseCode
  ) ?? null
}

function SendButton({ message }: { message: EdielMessageRow }) {
  if (!['draft', 'queued', 'prepared'].includes(message.status) || message.direction !== 'outbound') return null

  return (
    <form action={sendEdielMessageAction}>
      <input type="hidden" name="edielMessageId" value={message.id} />
      <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
        Skicka okrypterat EDIFACT
      </button>
    </form>
  )
}

function MessageMiniCard({ message }: { message: EdielMessageRow }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={message.direction === 'outbound' ? 'blue' : 'green'}>{message.direction}</Badge>
          <Badge tone={statusTone(message.status)}>{message.status}</Badge>
          <Badge tone="slate">{message.message_family} {message.message_code}</Badge>
        </div>
        <Link href={`/admin/ediel/messages/${message.id}`} className="text-xs font-semibold text-blue-700 hover:underline">
          Öppna payload
        </Link>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
        <div>Skapad: {formatDateTime(message.created_at)}</div>
        <div>Skickad: {formatDateTime(message.message_sent_at)}</div>
        <div className="break-all">FR {message.sender_ediel_id ?? '—'}{message.sender_sub_address ? `:${message.sender_sub_address}` : ''}</div>
        <div className="break-all">DO {message.receiver_ediel_id ?? '—'}{message.receiver_sub_address ? `:${message.receiver_sub_address}` : ''}</div>
        <div className="break-all">SMTP till: {message.receiver_email ?? '—'}</div>
        <div className="break-all">UNB-ref: {message.interchange_reference ?? '—'}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <SendButton message={message} />
        <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Kontrollera råpayload
        </Link>
      </div>
    </div>
  )
}

function AgtWorkflowCard({
  testCase,
  testRuns,
  messages,
  actorName,
  actorEdielId,
  runtimeReady,
}: {
  testCase: EdielAgtTestCaseDefinition
  testRuns: EdielTestRunRow[]
  messages: EdielMessageRow[]
  actorName: string
  actorEdielId: string
  runtimeReady: boolean
}) {
  const activeRun = activeRunForCase(testRuns, testCase)
  const actorSendsFirst = testCase.direction === 'actor_to_portal'
  const outboundMessages = latestMessagesForCase(messages, testCase, 'outbound')
  const inboundMessages = latestMessagesForCase(messages, testCase, 'inbound')

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">{testCase.testCaseCode}</Badge>
            <Badge tone={testCase.suite === 'PRODAT' ? 'blue' : 'green'}>{testCase.suite}</Badge>
            <Badge tone={actorSendsFirst ? 'blue' : 'green'}>{directionLabel(testCase.direction)}</Badge>
            <Badge tone={activeRun ? 'yellow' : 'slate'}>{activeRun ? `run ${activeRun.status}` : 'run saknas'}</Badge>
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-950">{testCase.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">{testCase.purpose}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {testCase.agtInstruction}
      </div>

      <div className="mt-4 grid gap-2">
        {testCase.expectedSteps.map((step) => (
          <div key={`${testCase.testCaseCode}-${step.stepNo}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-700">
            <Badge tone={step.actor === 'actor' ? 'blue' : 'green'}>Steg {step.stepNo}</Badge>
            <span className="font-medium">{step.actor === 'actor' ? 'Div3rsa/systemet' : 'Edielportalen'}</span>
            <span>{step.direction}</span>
            <span>{step.family} {step.code}</span>
            <span className="text-slate-500">{step.title}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <form action={createAgtSupplierTestRunAction} className="rounded-2xl border border-slate-200 p-3">
          <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
          <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            {activeRun ? `Skapa ny run ${testCase.testCaseCode}` : `Skapa run ${testCase.testCaseCode}`}
          </button>
          <p className="mt-2 text-xs leading-5 text-slate-500">Skapa run efter att du har startat samma test i Edielportalen. Kör ett test åt gången.</p>
        </form>

        {actorSendsFirst ? (
          <form action={createEdielAgtOutboundDraftAction} className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
            <input type="hidden" name="testRunId" value={activeRun?.id ?? ''} />
            <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
            <input type="hidden" name="actorName" value={actorName} />
            <input type="hidden" name="actorEdielId" value={actorEdielId} />
            <button disabled={!runtimeReady} className="w-full rounded-xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400">
              Skapa draft och öppna payload
            </button>
            <p className="mt-2 text-xs leading-5 text-blue-800">
              För L1/L7 öppnas detaljvyn direkt så du kan granska UNB/NAD/payload innan du skickar.
            </p>
          </form>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-semibold text-emerald-950">Vänta på inbound från Edielportalen</div>
            <p className="mt-2 text-xs leading-5 text-emerald-800">
              För {testCase.testCaseCode} ska portalen skicka {testCase.messageFamily} {testCase.messageCode}. När den finns här skapar du CONTRL + negativ APERAK från inbound-raden.
            </p>
          </div>
        )}
      </div>

      {outboundMessages.length > 0 ? (
        <div className="mt-5">
          <div className="text-sm font-semibold text-slate-900">Outbound / svar att kontrollera och skicka</div>
          <div className="mt-2 grid gap-3">
            {outboundMessages.map((message) => <MessageMiniCard key={message.id} message={message} />)}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-900">Inbound från portalen / kvittenser</div>
        {inboundMessages.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Ingen matchande inbound hittad ännu.</p>
        ) : (
          <div className="mt-2 grid gap-3">
            {inboundMessages.map((message) => (
              <div key={message.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <MessageMiniCard message={message} />
                {!actorSendsFirst ? (
                  <form action={createEdielAgtResponsesForInboundAction} className="mt-3">
                    <input type="hidden" name="sourceMessageId" value={message.id} />
                    <input type="hidden" name="testRunId" value={activeRun?.id ?? ''} />
                    <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
                    <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
                      Skapa CONTRL + negativ APERAK för detta inbound
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default async function EdielAgtPage() {
  const context = await requireAnyPermissionServer(['communication.read'])
  const [runtime, testRuns, messages] = await Promise.all([
    getEdielAgtSupplierRuntime(),
    listEdielTestRuns(),
    listEdielMessages({ limit: 100 }),
  ])

  const supplierAgtRuns = testRuns.filter(
    (run) =>
      run.role_code === 'supplier' &&
      isEdielAgtRunApprovalVersion(run.approval_version) &&
      EDIEL_AGT_SUPPLIER_2026A_CASES.some(
        (testCase) => testCase.suite === run.test_suite && testCase.testCaseCode === run.test_case_code
      )
  )

  const runKeySet = new Set(supplierAgtRuns.map((run) => `${run.test_suite}:${run.test_case_code}`))
  const errorCount = runtime.issues.filter((issue) => issue.severity === 'error').length
  const warningCount = runtime.issues.filter((issue) => issue.severity === 'warning').length
  const actorName = runtime.actor?.actor_name ?? 'Div3rsa AB'
  const actorEdielId = runtime.actor?.actor_ediel_id ?? '21660'
  const prodatCases = EDIEL_AGT_SUPPLIER_2026A_CASES.filter((testCase) => testCase.suite === 'PRODAT')

  return (
    <div className="space-y-6">
      <AdminHeader
        title="AGT 2026A · Leverantör"
        subtitle="Här kör du Div3rsa AB:s leverantörstester utan att blanda ihop dem med GridCore/TGT-id. L1/L7 är outbound; L2-L5 är inbound från portalen."
        userEmail={context.email}
      />

      <section className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Starta inte tester blint</div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">AGT runtime, draft, payload och skickning på samma sida</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Sidan är byggd SaaS-mässigt: aktör, route och Ediel-profil läses från databasen. Div3rsa är bara nuvarande aktör. För andra leverantörer byts aktörskort/routing, inte koden.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={runtime.isReady ? 'green' : 'red'}>{runtime.isReady ? 'AGT redo' : 'AGT blockerad'}</Badge>
            <Badge tone={errorCount > 0 ? 'red' : 'green'}>fel {errorCount}</Badge>
            <Badge tone={warningCount > 0 ? 'yellow' : 'green'}>varningar {warningCount}</Badge>
            <Link href="/admin/ediel" className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Till Ediel
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Field label="Aktiv aktör" value={runtime.actor?.actor_name} />
        <Field label="Aktörens Ediel-id" value={runtime.actor?.actor_ediel_id} />
        <Field label="Aktörsroll" value={runtime.actor?.actor_role} />
        <Field label="Miljö" value={runtime.actor?.environment} />
        <Field label="Portal Ediel-id" value={EDIEL_AGT_PORTAL_EDIEL_ID} />
        <Field label="Portal SMTP" value={EDIEL_AGT_PORTAL_SMTP} />
      </section>

      {runtime.issues.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Readiness issues</h2>
          <div className="mt-4 space-y-3">
            {runtime.issues.map((issue) => (
              <div key={issue.code} className="rounded-xl border border-white/70 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge>
                  <div className="text-sm font-semibold text-slate-950">{issue.title}</div>
                </div>
                <div className="mt-1 text-sm text-slate-700">{issue.description}</div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          Readiness är grön. L1/L7 kan skapa draft, öppna payload och skicka okrypterat. L2-L5 väntar på inbound från portalen och skapar sedan svar.
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-950">Leverantörens AGT-info</h2>
          <p className="mt-1 text-sm text-slate-500">
            Det är här du lägger in Div3rsa nu. För framtida SaaS-kunder ändras samma fält till kundens bolagsnamn, Ediel-id och e-post/routing.
          </p>
        </div>

        <form action={saveAgtSupplierRuntimeAction} className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Aktörskort</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Bolagsnamn
                <input name="actor_name" defaultValue={runtime.actor?.actor_name ?? 'Div3rsa AB'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                Leverantörens Ediel-id
                <input name="actor_ediel_id" defaultValue={runtime.actor?.actor_ediel_id ?? '21660'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                Sender name
                <input name="sender_name" defaultValue={runtime.actor?.sender_name ?? runtime.actor?.actor_name ?? 'Div3rsa AB'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                Mailbox / SMTP user
                <input name="mailbox" defaultValue={runtime.actor?.mailbox ?? 'ediel@gridex.se'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                SMTP from email
                <input name="smtp_from_email" defaultValue={runtime.actor?.smtp_from_email ?? 'ediel@gridex.se'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                Reply-to
                <input name="smtp_reply_to_email" defaultValue={runtime.actor?.smtp_reply_to_email ?? 'ediel@gridex.se'} className={inputClassName()} />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Edielportalen / AGT-routes</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Mottagare
                <input name="receiver_name" defaultValue="Edielportalen" className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                SMTP till portalen
                <input name="target_email" defaultValue={EDIEL_AGT_PORTAL_SMTP} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                PRODAT application reference
                <input name="prodat_application_reference" defaultValue={runtime.prodat.profile?.application_reference ?? '23-DDQ-PRODAT'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                PRODAT default version
                <input name="prodat_default_message_version" defaultValue={runtime.prodat.profile?.default_message_version ?? '97A'} className={inputClassName()} />
              </label>
              <label className="text-sm text-slate-700">
                UTILTS default version
                <input name="utilts_default_message_version" defaultValue={runtime.utilts.profile?.default_message_version ?? ''} className={inputClassName()} placeholder="valfritt" />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Knappen skapar/uppdaterar ett aktivt test-aktörskort, en PRODAT-route och en UTILTS-route. Den använder inte GridCore/TGT-id 92825 som avsändare.
            </div>
          </div>

          <div className="xl:col-span-2">
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Spara AGT-runtime
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RouteCard title="PRODAT AGT route" family="PRODAT" route={runtime.prodat.route} profile={runtime.prodat.profile} />
        <RouteCard title="UTILTS AGT route" family="UTILTS" route={runtime.utilts.route} profile={runtime.utilts.profile} />
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">Korrekt körordning för dina L-tester</h2>
        <p className="mt-2 text-sm leading-6 text-blue-900">
          L1 och L7 är Aktör → Portal: starta testet i Edielportalen, skapa run här, skapa draft, öppna payload och skicka. L2-L5 är Portal → Aktör: starta testet i portalen, hämta/importera inbound PRODAT och skapa CONTRL + negativ APERAK från inbound-raden.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Testfall 2026A</h2>
            <p className="mt-1 text-sm text-slate-500">
              Detta är den gamla översikten. Den nya arbetsytan under visar draft, payload-länk, skickaknapp och inbound-koppling.
            </p>
          </div>
          <form action={createAllAgtSupplierTestRunsAction}>
            <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Skapa alla som draft
            </button>
          </form>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {EDIEL_AGT_SUPPLIER_2026A_CASES.map((testCase) => {
            const hasRun = runKeySet.has(`${testCase.suite}:${testCase.testCaseCode}`)
            return (
              <div key={`${testCase.suite}-${testCase.testCaseCode}`} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{testCase.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{testCase.suite} · {testCase.messageCode} · {directionLabel(testCase.direction)}</div>
                  </div>
                  <Badge tone={caseTone(hasRun)}>{hasRun ? 'run finns' : 'ej skapad'}</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{notesText(testCase.notes)}</p>
                <form action={createAgtSupplierTestRunAction} className="mt-4">
                  <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
                  <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                    Skapa run {testCase.testCaseCode}
                  </button>
                </form>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">AGT arbetsyta · PRODAT L1-L7</h2>
          <p className="mt-1 text-sm text-slate-500">
            Här ser du vad som faktiskt ska skickas eller tas emot per testfall. Använd denna del för körningen.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {prodatCases.map((testCase) => (
            <AgtWorkflowCard
              key={testCase.testCaseCode}
              testCase={testCase}
              testRuns={testRuns}
              messages={messages}
              actorName={actorName}
              actorEdielId={actorEdielId}
              runtimeReady={runtime.isReady}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
