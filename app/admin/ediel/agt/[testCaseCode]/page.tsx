import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
 listAckMessagesForSource,
 listEdielMessages,
 listEdielMessagesByIds,
 listEdielTestRunMessages,
 listEdielTestRuns,
} from '@/lib/ediel/db'
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/agtRuntime'
import {
 EDIEL_AGT_PORTAL_EDIEL_ID,
 EDIEL_AGT_PORTAL_SMTP,
 EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS,
 getEdielAgtSupplier2026ACase,
 type EdielAgtTestCaseDefinition,
} from '@/lib/ediel/agtRegistry'
import type { EdielMessageRow, EdielTestRunMessageRow, EdielTestRunRow } from '@/lib/ediel/types'
import {
 attachAgtInboundAndCreateResponsesAction,
 cleanupAgtCaseUnsentMessagesAction,
 createAgtSupplierOutboundCommandAction,
 createAgtSupplierTestRunAction,
 importAgtRawInboundForCaseAction,
 pollAgtMailboxForCaseAction,
} from '@/app/admin/ediel/agt/actions'
import { sendEdielMessageAction } from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

type Tone = 'emerald' | 'amber' | 'red' | 'slate'

function badgeTone(tone: Tone) {
 if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700'
 if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700'
 return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
 return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeTone(tone)}`}>{children}</span>
}

function inputClassName() {
 return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function statusTone(status: string | null | undefined): Tone {
 const value = String(status ?? '').toLowerCase()
 if (['sent', 'received', 'acknowledged', 'processed', 'success'].includes(value)) return 'emerald'
 if (['draft', 'queued', 'prepared', 'pending', 'in_progress', 'running'].includes(value)) return 'amber'
 if (['failed', 'cancelled', 'error', 'rejected'].includes(value)) return 'red'
 return 'slate'
}

function formatDate(value: string | null | undefined) {
 if (!value) return '—'
 return value.replace('T', ' ').slice(0, 16)
}

function directionText(testCase: EdielAgtTestCaseDefinition) {
 return testCase.direction === 'actor_to_portal' ? 'Leverantör → Edielportalen' : 'Edielportalen → Leverantör'
}


function isAckLikeStep(step: EdielAgtTestCaseDefinition['expectedSteps'][number]): boolean {
 const family = String(step.family ?? '').toUpperCase()
 const code = String(step.code ?? '').toUpperCase()
 return family === 'CONTRL' || code === 'CONTRL' || family === 'APERAK' || code === 'APERAK' || family === 'UTILTS_ERR' || code === 'UTILTS_ERR'
}

function messageMatchesExpectedStep(step: EdielAgtTestCaseDefinition['expectedSteps'][number], message: EdielMessageRow): boolean {
 const family = String(message.message_family ?? '').toUpperCase()
 const code = String(message.message_code ?? '').toUpperCase()
 const expectedFamily = String(step.family ?? '').toUpperCase()
 const expectedCode = String(step.code ?? '').toUpperCase()

 if (isAckLikeStep(step)) {
 return family === expectedFamily || code === expectedCode || family === expectedCode
 }

 return family === expectedFamily && code === expectedCode
}

function canAttachToCase(testCase: EdielAgtTestCaseDefinition, message: EdielMessageRow) {
 if (message.direction !== 'inbound') return false
 return testCase.expectedSteps.some((step) => {
 if (step.actor !== 'portal' || step.direction !== 'inbound') return false
 return messageMatchesExpectedStep(step, message)
 })
}


function isPrimaryInbound(testCase: EdielAgtTestCaseDefinition, message: EdielMessageRow) {
 return (
 testCase.direction === 'portal_to_actor' &&
 message.direction === 'inbound' &&
 String(message.message_family).toUpperCase() === String(testCase.messageFamily).toUpperCase() &&
 String(message.message_code).toUpperCase() === String(testCase.messageCode).toUpperCase()
 )
}

function MessageSummary({ message }: { message: EdielMessageRow }) {
 return (
 <div className="space-y-2">
 <div className="flex flex-wrap items-center gap-2">
 <Badge tone={statusTone(message.status)}>{message.status}</Badge>
 <Badge tone="slate">{message.direction}</Badge>
 <Badge tone="emerald">{message.message_family} {message.message_code}</Badge>
 {message.ack_outcome ? <Badge tone={message.ack_outcome === 'positive' ? 'emerald' : 'red'}>{message.ack_outcome}</Badge> : null}
 </div>
 <div className="grid gap-2 text-xs text-slate-700 md:grid-cols-2">
 <div>Från: <span className="font-mono text-slate-900">{message.sender_ediel_id ?? '—'}</span></div>
 <div>Till: <span className="font-mono text-slate-900">{message.receiver_ediel_id ?? '—'}</span></div>
 <div>UNB ref: <span className="font-mono text-slate-900">{message.interchange_reference ?? '—'}</span></div>
 <div>Transaktion: <span className="font-mono text-slate-900">{message.transaction_reference ?? '—'}</span></div>
 </div>
 </div>
 )
}

function SendButton({ message }: { message: EdielMessageRow }) {
 const canSend = message.direction === 'outbound' && (message.status === 'draft' || message.status === 'queued' || message.status === 'prepared')
 if (!canSend) return null

 return (
 <form action={sendEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={message.id} />
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
 Skicka
 </button>
 </form>
 )
}

function LinkedTimeline({
 testCase,
 run,
 links,
 messagesById,
}: {
 testCase: EdielAgtTestCaseDefinition
 run: EdielTestRunRow | null
 links: EdielTestRunMessageRow[]
 messagesById: Map<string, EdielMessageRow>
}) {
 return (
 <section className="rounded-2xl border border-slate-200 bg-white p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Testkedja</h2>
 <p className="mt-1 text-sm text-slate-700">Förväntade steg och kopplade meddelanden för just detta test.</p>
 </div>
 <Badge tone={run ? statusTone(run.status) : 'slate'}>{run ? `run ${run.status}` : 'ingen run'}</Badge>
 </div>

 <div className="mt-4 space-y-3">
 {testCase.expectedSteps.map((step) => {
 const validLinked = links
 .map((link) => ({ link, message: messagesById.get(link.ediel_message_id) }))
 .filter((item): item is { link: EdielTestRunMessageRow; message: EdielMessageRow } => {
 const message = item.message
 if (!message) return false
 return item.link.step_no === step.stepNo && message.status !== 'cancelled' && messageMatchesExpectedStep(step, message)
 })
 .sort((a, b) => Date.parse(b.message.created_at ?? '') - Date.parse(a.message.created_at ?? ''))
 const visibleLinked = validLinked.slice(0, 1)
 const hiddenCount = Math.max(validLinked.length - visibleLinked.length, 0)
 return (
 <div key={step.stepNo} className="rounded-2xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div>
 <div className="text-sm font-semibold text-slate-950">Steg {step.stepNo}: {step.title}</div>
 <div className="mt-1 text-xs text-slate-700">{step.actor} · {step.direction} · {step.family} {step.code}</div>
 </div>
 <Badge tone={visibleLinked.length > 0 ? 'emerald' : 'slate'}>{visibleLinked.length > 0 ? 'kopplad' : 'väntar'}</Badge>
 </div>

 {visibleLinked.length > 0 ? (
 <div className="mt-3 space-y-2">
 {visibleLinked.map(({ link, message }) => (
 <div key={link.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <MessageSummary message={message} />
 <div className="flex flex-wrap gap-2">
 <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
 Öppna payload
 </Link>
 <SendButton message={message} />
 </div>
 </div>
 </div>
 ))}
 {hiddenCount > 0 ? (
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
 {hiddenCount} äldre/duplicerade kopplingar är dolda. Använd rensningsknappen om du vill makulera gamla oskickade meddelanden för detta test.
 </div>
 ) : null}
 </div>
 ) : null}
 </div>
 )
 })}
 </div>
 </section>
 )
}

export default async function AgtCasePage({
 params,
}: {
 params: Promise<{ testCaseCode: string }>
}) {
 const { testCaseCode } = await params
 const context = await requireAdminPageKeyAccess('ediel.workspace')
 const isPlatformAdmin = isPlatformAdminContext(context)
 const companyScope = await getOperationalCompanyScope(context.userId)
 const companyId = isPlatformAdmin ? null : companyScope.companyId
 const testCase = getEdielAgtSupplier2026ACase(String(testCaseCode).toUpperCase())

 if (!testCase) {
 return (
 <div className="space-y-6">
 <AdminHeader
 title="Testmiljö / AGT-test"
 subtitle="Testfallet hittades inte."
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Platform Control' : companyScope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />
 <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
 Okänt testfall: {testCaseCode}
 </div>
 </div>
 )
 }

 const [runtime, runs, recentInbound] = await Promise.all([
 getEdielAgtSupplierRuntime(companyId),
 listEdielTestRuns(),
 listEdielMessages({ direction: 'inbound', companyId, limit: 80 }),
 ])

 const run = runs.find((item) =>
 item.role_code === testCase.roleCode &&
 item.test_suite === testCase.suite &&
 item.test_case_code === testCase.testCaseCode &&
 item.approval_version === testCase.approvalVersion &&
 (item.status === 'draft' || item.status === 'running')
 ) ?? null

 const links = run ? await listEdielTestRunMessages({ testRunId: run.id }) : []
 const linkedIds = links.map((link) => link.ediel_message_id)
 const linkedMessages = await listEdielMessagesByIds(linkedIds, { companyId })
 const messagesById = new Map(linkedMessages.map((message) => [message.id, message]))

 const candidateInbound = recentInbound
 .filter((message) => testCase.direction === 'portal_to_actor' ? isPrimaryInbound(testCase, message) : canAttachToCase(testCase, message))
 .filter((message) => message.status !== 'cancelled')
 .slice(0, 10)

 const candidateAckPairs = await Promise.all(
 candidateInbound.map(async (message) => ({
 message,
 acks: await listAckMessagesForSource({ sourceMessageId: message.id, companyId }),
 }))
 )

 const linkedSourceIds = Array.from(new Set(linkedMessages.filter((message) => isPrimaryInbound(testCase, message)).map((message) => message.id)))
 const linkedAckPairs = await Promise.all(
 linkedSourceIds.map(async (id) => ({
 sourceId: id,
 acks: await listAckMessagesForSource({ sourceMessageId: id, companyId }),
 }))
 )

 const actorToPortal = testCase.direction === 'actor_to_portal'
 const route = testCase.suite === 'PRODAT' ? runtime.prodat.route : runtime.utilts.route
 const profile = testCase.suite === 'PRODAT' ? runtime.prodat.profile : runtime.utilts.profile

 return (
 <div className="space-y-6">
 <AdminHeader
 title={`${testCase.testCaseCode} · ${testCase.title}`}
 subtitle={isPlatformAdmin
 ? 'Plattformens AGT-testmotor. Inbound/outbound visas globalt för platform admin.'
 : 'Tenant-skopad AGT-testvy. Endast bolagets egna inbound/outbound-meddelanden visas.'}
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Platform Control' : companyScope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-5">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="flex flex-wrap gap-2">
 <Badge tone="emerald">TESTLÄGE</Badge>
 <Badge tone="slate">{testCase.suite}</Badge>
 <Badge tone="slate">{testCase.messageCode}</Badge>
 <Badge tone={actorToPortal ? 'amber' : 'emerald'}>{directionText(testCase)}</Badge>
 </div>
 <h1 className="mt-3 text-2xl font-semibold text-slate-950">{testCase.portalTitle}</h1>
 <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">{testCase.purpose}</p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Link href="/admin/ediel/agt" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
 Till testmiljö
 </Link>
 <Link href="/admin/ediel/messages" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
 Meddelanden
 </Link>
 </div>
 </div>
 </section>

 <section className="grid gap-4 lg:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Aktiv tenant/leverantör</div>
 <div className="mt-1 text-sm font-semibold text-slate-950">{runtime.actor?.actor_name ?? '—'}</div>
 <div className="mt-1 font-mono text-xs text-slate-700">{runtime.actor?.actor_ediel_id ?? 'saknas'}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Portal</div>
 <div className="mt-1 text-sm font-semibold text-slate-950">{EDIEL_AGT_PORTAL_EDIEL_ID}</div>
 <div className="mt-1 text-xs text-slate-700">{EDIEL_AGT_PORTAL_SMTP}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Route</div>
 <div className="mt-1 text-sm font-semibold text-slate-950">{route?.route_name ?? 'saknas'}</div>
 <div className="mt-1 text-xs text-slate-700">{profile?.encryption_mode ?? '—'} · {profile?.ack_mode ?? '—'}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Run</div>
 <div className="mt-1 text-sm font-semibold text-slate-950">{run ? run.status : 'ingen aktiv run'}</div>
 <div className="mt-1 text-xs text-slate-700">{run ? formatDate(run.created_at) : 'skapa run först'}</div>
 </div>
 </section>

 <section className="grid gap-4 xl:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 bg-white p-5">
 <h2 className="text-lg font-semibold text-slate-950">Kör detta test</h2>
 <p className="mt-2 text-sm leading-6 text-slate-700">{testCase.agtInstruction}</p>

 {testCase.prodatOutboundTemplate ? (
 <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">
 <div className="font-semibold text-emerald-950">2026A outbound-template</div>
 <div className="mt-1">
 GridCore skickar bara om payloaden matchar vald AGT-template. För detta test: 223/Z13 ={' '}
 <span className="font-mono font-semibold">{testCase.prodatOutboundTemplate.reasonForTransaction}</span> och 217/Z04 ={' '}
 <span className="font-mono font-semibold">{testCase.prodatOutboundTemplate.meteringMethod}</span>.
 </div>
 </div>
 ) : null}

 <div className="mt-4 flex flex-wrap gap-2">
 <form action={createAgtSupplierTestRunAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
 {run ? 'Skapa ny run' : 'Skapa run'}
 </button>
 </form>

 {actorToPortal ? (
 <form action={createAgtSupplierOutboundCommandAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={run?.id ?? ''} />
 <button disabled={!run} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300">
 Generera + skicka
 </button>
 </form>
 ) : (
 <form action={pollAgtMailboxForCaseAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={run?.id ?? ''} />
 <input type="hidden" name="mailbox" value={runtime.actor?.mailbox ?? 'INBOX'} />
 <input type="hidden" name="limit" value="20" />
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
 Importera från IMAP + koppla
 </button>
 </form>
 )}
 </div>

 {run ? (
 <form action={cleanupAgtCaseUnsentMessagesAction} className="mt-3">
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={run.id} />
 <button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">
 Makulera gamla oskickade testkommandon
 </button>
 </form>
 ) : null}

 <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
 För Aktör → Portal genererar GridCore outbound och skickar direkt; därefter sparas skickat meddelande som audit/logg och portalkvittenser importeras. För Portal → Aktör skapas kvittensförslag från inbound-raden. Produktion/live-flöden ska inte gå via den här testvyn.
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-5">
 <h2 className="text-lg font-semibold text-slate-950">Manuell import</h2>
 <p className="mt-2 text-sm leading-6 text-slate-700">
 Använd detta om IMAP inte hunnit hämta meddelandet eller om du vill klistra in EDIFACT från portalen. För Portal → Aktör skapar motorn AGT-svar från portalens affärsmeddelande. För Aktör → Portal kopplas endast portalens CONTRL/APERAK till auditkedjan.
 </p>
 <form action={importAgtRawInboundForCaseAction} className="mt-4 space-y-3">
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={run?.id ?? ''} />
 <label className="block text-sm font-medium text-slate-700">
 Fil
 <input type="file" name="ediel_file" className={inputClassName()} />
 </label>
 <label className="block text-sm font-medium text-slate-700">
 Eller klistra in raw EDIFACT
 <textarea name="raw_payload" rows={5} className={inputClassName()} placeholder="UNA:+.? 'UNB+..." />
 </label>
 <button className="rounded-xl bg-white border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
 Importera och koppla
 </button>
 </form>
 </div>
 </section>

 <LinkedTimeline testCase={testCase} run={run} links={links} messagesById={messagesById} />

 {linkedAckPairs.some((pair) => pair.acks.length > 0) ? (
 <section className="rounded-2xl border border-slate-200 bg-white p-5">
 <h2 className="text-lg font-semibold text-slate-950">Skapade kvittensförslag för kopplade inbound</h2>
 <div className="mt-4 space-y-3">
 {linkedAckPairs.flatMap((pair) => pair.acks).map((ack) => (
 <div key={ack.id} className="rounded-xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <MessageSummary message={ack} />
 <div className="flex flex-wrap gap-2">
 <Link href={`/admin/ediel/messages/${ack.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
 Öppna payload
 </Link>
 <SendButton message={ack} />
 </div>
 </div>
 </div>
 ))}
 </div>
 </section>
 ) : null}

 <section className="rounded-2xl border border-slate-200 bg-white p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Möjliga inbound att koppla</h2>
 <p className="mt-1 text-sm text-slate-700">Senaste inbound som matchar förväntad familj/kod för {testCase.testCaseCode}.</p>
 </div>
 {actorToPortal ? (
 <form action={pollAgtMailboxForCaseAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={run?.id ?? ''} />
 <input type="hidden" name="mailbox" value={runtime.actor?.mailbox ?? 'INBOX'} />
 <input type="hidden" name="limit" value="20" />
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
 Importera portalens CONTRL/APERAK från IMAP
 </button>
 </form>
 ) : null}
 </div>

 <div className="mt-4 space-y-3">
 {candidateAckPairs.length === 0 ? (
 <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-700">
 Inga matchande inbound hittades än. Starta testet i Edielportalen och använd IMAP-importen ovan.
 </div>
 ) : (
 candidateAckPairs.map(({ message, acks }) => (
 <div key={message.id} className="rounded-2xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <MessageSummary message={message} />
 <div className="mt-2 text-xs text-slate-700">Mottaget: {formatDate(message.message_received_at ?? message.created_at)}</div>
 {isPrimaryInbound(testCase, message) ? (
 <div className="mt-2 text-xs font-semibold text-emerald-700">Detta är portalens affärsmeddelande för testet. Motorn skapar rätt kvittensförslag.</div>
 ) : (
 <div className="mt-2 text-xs font-semibold text-emerald-700">Detta är portalens kvittens/svarsmeddelande för ett outbound-test och kan kopplas till testkedjan.</div>
 )}
 </div>
 <div className="flex flex-wrap gap-2">
 <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
 Öppna
 </Link>
 <form action={attachAgtInboundAndCreateResponsesAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={run?.id ?? ''} />
 <input type="hidden" name="source_message_id" value={message.id} />
 <button className="rounded-xl bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50">
 {actorToPortal ? 'Koppla kvittens' : 'Koppla + skapa svar'}
 </button>
 </form>
 </div>
 </div>

 {acks.length > 0 ? (
 <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
 <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Kvittensförslag / kvittenser</div>
 <div className="space-y-2">
 {acks.map((ack) => (
 <div key={ack.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
 <MessageSummary message={ack} />
 <div className="flex flex-wrap gap-2">
 <Link href={`/admin/ediel/messages/${ack.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
 Öppna payload
 </Link>
 <SendButton message={ack} />
 </div>
 </div>
 ))}
 </div>
 </div>
 ) : null}
 </div>
 ))
 )}
 </div>
 </section>

 <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-900">
 <div className="font-semibold text-emerald-950">SaaS-regel för detta fönster</div>
 <p className="mt-1">
 Testfallet styrs av AGT-registret och aktiv tenant-runtime. Inga tenantnamn ska ligga som specialfall i motorn. För andra leverantörer byts Ediel-id, mailbox, routes, eventuell sender-subadress och BRP i runtime.
 </p>
 {testCase.suite === 'PRODAT' ? (
 <p className="mt-2">PRODAT AGT mot portalen använder receiver {EDIEL_AGT_PORTAL_EDIEL_ID}:ZZ:{EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS}. Sender-subadress ska följa Edielregistret per tenant.</p>
 ) : null}
 </section>
 </div>
 )
}
