import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  RULEBOOK_FIELD_MATRIX,
  RULEBOOK_MESSAGE_RULES,
  RULEBOOK_TEST_CASES,
  deriveRulebookAckDecision,
  expectedApplicationReferenceForProcess,
  getBusinessProcessForMessage,
  listFieldRules,
} from '@/lib/ediel/rulebook'

export const dynamic = 'force-dynamic'

type RecentRun = {
  id: string
  test_suite: string | null
  test_case_code: string | null
  role_code: string | null
  status: string | null
  created_at: string | null
}

type RuleVersionRow = {
  id: string
  rulebook_key: string | null
  version_code: string | null
  status: string | null
  valid_from: string | null
  valid_to: string | null
  message_family: string | null
  message_code: string | null
}

async function countRows(table: string): Promise<number> {
  try {
    const result = await supabaseService.from(table).select('*', { count: 'exact', head: true })
    if (result.error) throw result.error
    return result.count ?? 0
  } catch {
    return 0
  }
}

async function recentRuns(): Promise<RecentRun[]> {
  try {
    const { data, error } = await supabaseService
      .from('ediel_test_runs')
      .select('id,test_suite,test_case_code,role_code,status,created_at')
      .order('created_at', { ascending: false })
      .limit(8)
    if (error) throw error
    return Array.isArray(data) ? data as RecentRun[] : []
  } catch {
    return []
  }
}

async function ruleVersions(): Promise<RuleVersionRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('ediel_rule_versions')
      .select('id,rulebook_key,version_code,status,valid_from,valid_to,message_family,message_code')
      .order('valid_from', { ascending: false })
      .limit(12)
    if (error) throw error
    return Array.isArray(data) ? data as RuleVersionRow[] : []
  } catch {
    return []
  }
}

function Badge({ tone, children }: { tone: 'emerald' | 'amber' | 'red' | 'slate' | 'blue'; children: ReactNode }) {
  const styles: Record<typeof tone, string> = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
  }
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${styles[tone]}`}>{children}</span>
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">{hint}</div>
    </div>
  )
}

function statusTone(status?: string | null): 'emerald' | 'amber' | 'red' | 'slate' | 'blue' {
  const normalized = String(status ?? '').toLowerCase()
  if (['active', 'passed', 'runtime_ready'].includes(normalized)) return 'emerald'
  if (['draft', 'review', 'running', 'manual_review', 'runtime_partial'].includes(normalized)) return 'amber'
  if (['failed', 'blocked'].includes(normalized)) return 'red'
  if (['superseded'].includes(normalized)) return 'blue'
  return 'slate'
}

export default async function EdielSystemTestsPage() {
  const context = await requirePlatformAdminAccess()
  const [dbTestCases, dbRuns, dbVersions, dbFieldRules, recent, versions] = await Promise.all([
    countRows('ediel_test_cases'),
    countRows('ediel_test_runs'),
    countRows('ediel_rule_versions'),
    countRows('ediel_field_rules'),
    recentRuns(),
    ruleVersions(),
  ])

  const activeRuleCount = RULEBOOK_MESSAGE_RULES.filter((item) => item.runtimeStatus === 'runtime_ready').length
  const partialRuleCount = RULEBOOK_MESSAGE_RULES.filter((item) => item.runtimeStatus === 'runtime_partial').length
  const escoCases = RULEBOOK_TEST_CASES.filter((item) => item.actorRole === 'energy_service_company')
  const supplierCases = RULEBOOK_TEST_CASES.filter((item) => item.actorRole === 'supplier')
  const ackSamples = [
    deriveRulebookAckDecision({ family: 'PRODAT', code: 'Z03' }),
    deriveRulebookAckDecision({ family: 'APERAK', code: 'APERAK' }),
    deriveRulebookAckDecision({ family: 'UTILTS', code: 'E66', utiltsFunctionalError: true }),
  ]

  return (
    <div className="space-y-6 p-6">
      <AdminHeader
        title="Ediel Systemtest & Regelcenter"
        subtitle="Superadmin-yta för rulebook, testfall, fältmatris, parser, ACK-regler, ESCO och regression. Kundkortets befintliga testflöde ska använda samma regelmotor bakom kulisserna."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Batch 2 rulebook</p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">Gemensam regelmotor före fler specialflöden</h1>
            <p className="mt-3 max-w-5xl text-sm font-semibold leading-6 text-slate-700">
              Den här ytan visar det nya rulebook-lagret för PRODAT, UTILTS, CONTRL, APERAK, UTILTS_ERR, AI-lista och ESCO. Den är avsiktligt platform-only så vanliga bolag inte ser rå Ediel-teknik.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="emerald">PRODAT rulebook</Badge>
            <Badge tone="blue">ESCO</Badge>
            <Badge tone="amber">draft-regler testbara</Badge>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Runtime-regler" value={activeRuleCount} hint="Kända aktiva regler i rulebook-lagret." />
        <Metric label="Delvisa regler" value={partialRuleCount} hint="Regler där fältimport/komplett segmentvalidering ska kunna byggas på." />
        <Metric label="Testfall" value={dbTestCases || RULEBOOK_TEST_CASES.length} hint="Databasens testfall eller statisk fallback från rulebook." />
        <Metric label="Körningar" value={dbRuns} hint="Sparade system-/AGT-/TGT-körningar i ediel_test_runs." />
      </section>

      <Card title="Översikt" subtitle="Snabb status för regelmotor, testsviter och kända flöden.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">Leverantör</div>
            <p className="mt-1 text-sm font-semibold text-slate-600">{supplierCases.length} leverantörsfall finns i rulebook.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">Energitjänsteföretag</div>
            <p className="mt-1 text-sm font-semibold text-slate-600">{escoCases.length} ESCO/berättigad part-fall finns.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">Fältmatris</div>
            <p className="mt-1 text-sm font-semibold text-slate-600">{dbFieldRules || RULEBOOK_FIELD_MATRIX.length} fältregler kan visas/importeras.</p>
          </div>
        </div>
      </Card>

      <Card title="Regelversioner" subtitle="Produktion ska bara använda active. Systemtest kan läsa draft/review för regression.">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              <tr><th className="px-4 py-3">Regel</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Giltig från</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {(versions.length > 0 ? versions : RULEBOOK_MESSAGE_RULES.slice(0, 12).map((item, index) => ({
                id: `${item.family}-${item.code}-${index}`,
                rulebook_key: `${item.family}/${item.code}`,
                version_code: item.currentVersion,
                status: item.runtimeStatus === 'runtime_ready' ? 'active' : 'review',
                valid_from: item.validFrom,
                valid_to: null,
                message_family: item.family,
                message_code: item.code,
              }))).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-bold text-slate-950">{item.rulebook_key ?? `${item.message_family}/${item.message_code}`}</td>
                  <td className="px-4 py-3 text-slate-700">{item.version_code ?? '—'}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(item.status)}>{item.status ?? '—'}</Badge></td>
                  <td className="px-4 py-3 text-slate-700">{item.valid_from ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Testsviter & testfall" subtitle="Leverantörstester behålls. ESCO/berättigad part läggs ovanpå samma testmotor.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {RULEBOOK_TEST_CASES.map((item) => (
            <div key={`${item.suite}-${item.testCaseCode}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <Badge tone={item.actorRole === 'energy_service_company' ? 'blue' : 'slate'}>{item.actorRole === 'energy_service_company' ? 'Energitjänsteföretag' : item.actorRole}</Badge>
                <Badge tone="emerald">{item.family} {item.messageCode}</Badge>
              </div>
              <div className="mt-3 text-sm font-black text-slate-950">{item.testCaseCode} · {item.name}</div>
              <div className="mt-1 text-xs font-semibold text-slate-600">{item.suite} · {item.direction}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone={item.expectedContrl === 'positive' ? 'emerald' : 'amber'}>CONTRL {item.expectedContrl}</Badge>
                <Badge tone={item.expectedAperak === 'negative' ? 'red' : item.expectedAperak === 'positive' ? 'emerald' : 'amber'}>APERAK {item.expectedAperak}</Badge>
                <Badge tone={item.expectedUtiltsErr === 'expected' ? 'red' : 'slate'}>UTILTS_ERR {item.expectedUtiltsErr}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Fältmatris" subtitle="R/D/O byggs som regelmatris, inte enkel required true/false.">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              <tr><th className="px-4 py-3">Meddelande</th><th className="px-4 py-3">Fält</th><th className="px-4 py-3">Segment</th><th className="px-4 py-3">Krav</th><th className="px-4 py-3">Villkor</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {listFieldRules().slice(0, 18).map((item) => (
                <tr key={`${item.family}-${item.code}-${item.fieldKey}-${item.segmentPath}`}>
                  <td className="px-4 py-3 font-bold text-slate-950">{item.family}/{item.code}</td>
                  <td className="px-4 py-3 text-slate-700">{item.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.segmentPath}</td>
                  <td className="px-4 py-3"><Badge tone={item.requirement === 'required' ? 'red' : item.requirement === 'dependent' ? 'amber' : 'slate'}>{item.requirement}</Badge></td>
                  <td className="px-4 py-3 text-slate-600">{item.condition ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Meddelandebyggare / processgrupper" subtitle="BGM hålls ren: Z03L/Z13V är inte BGM-värden, undertyp ligger i transaktionstyp.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {['Z01', 'Z03', 'Z13', 'Z18'].map((code) => {
            const process = getBusinessProcessForMessage({ family: 'PRODAT', code })
            return (
              <div key={code} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-lg font-black text-slate-950">PRODAT {code}</div>
                <div className="mt-2 text-sm font-semibold text-slate-700">Process: {process}</div>
                <div className="mt-2 text-sm font-semibold text-slate-700">Application Reference: {expectedApplicationReferenceForProcess(process)}</div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="Parser & validering" subtitle="Parsern returnerar canonical object: familj, kod, referenser, process, parter, mätpunkt, tillstånd och period.">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
          Parsern finns i <span className="font-mono text-slate-950">lib/ediel/rulebook/messageParser.ts</span> och valideringen i <span className="font-mono text-slate-950">lib/ediel/rulebook/validator.ts</span>. Den kontrollerar bland annat fel Application Reference, fel processgrupp och om undertyp felaktigt hamnar i BGM.
        </div>
      </Card>

      <Card title="ACK-regler" subtitle="CONTRL, APERAK och UTILTS_ERR hålls isär.">
        <div className="grid gap-3 md:grid-cols-3">
          {ackSamples.map((item, index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone={item.requiresContrl ? 'emerald' : 'slate'}>CONTRL {item.contrlStatus}</Badge>
                <Badge tone={item.requiresAperak ? 'emerald' : 'slate'}>APERAK {item.aperakStatus}</Badge>
                <Badge tone={item.utiltsErrStatus === 'pending' ? 'red' : 'slate'}>UTILTS_ERR {item.utiltsErrStatus}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-700">Deadline: {item.ackDueMinutes ? `${item.ackDueMinutes} min` : 'ingen'}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="AI-lista / BI-lista" subtitle="AI/BI är strukturkontroll och avvikelselista, inte ett PRODAT-substitut.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">AI-lista</div>
            <p className="mt-1 text-sm font-semibold text-slate-600">CSV från 2025-10-01, fortfarande semikolonseparerad, versionsmarkering Ver20140401.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">BI-lista</div>
            <p className="mt-1 text-sm font-semibold text-slate-600">Ändring av anläggnings-id/nätområde/nätbolag ska ge avvikelsehantering, inte automatisk kundändring.</p>
          </div>
        </div>
      </Card>

      <Card title="Senaste testkörningar" subtitle="Kopplar systemtest/kundkortstest till samma testlogg.">
        {recent.length > 0 ? (
          <div className="space-y-2">
            {recent.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{run.test_suite ?? '—'} · {run.test_case_code ?? '—'}</div>
                  <div className="text-xs font-semibold text-slate-500">{run.role_code ?? '—'} · {run.created_at ?? '—'}</div>
                </div>
                <Badge tone={statusTone(run.status)}>{run.status ?? '—'}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">Inga sparade testkörningar ännu.</div>
        )}
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/ediel/agt" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Öppna AGT</Link>
        <Link href="/admin/ediel/control-tower" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">Öppna Control Tower</Link>
        <Link href="/admin/ediel/ai-list" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">Öppna AI-lista</Link>
      </div>
    </div>
  )
}
