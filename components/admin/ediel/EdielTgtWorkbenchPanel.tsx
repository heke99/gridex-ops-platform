// components/admin/ediel/EdielTgtWorkbenchPanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
 archiveEdielTgtRunAction,
 archiveOlderEdielTgtRunsForCaseAction,
 attachEdielMessageToTestRunAction,
 createEdielTgtDraftAction,
 createMockPortalMessageForNextTgtStepAction,
 createEdielTgtRunFromTemplateAction,
 markEdielTgtRunStatusAction,
 runEdielTgtAutopilotAction,
 saveEdielTgtPortalTestDataAction,
} from '@/app/admin/ediel/actions'
import {
 evaluateEdielTgtRun,
 getEdielTgtCoverageSummary,
 getEdielTgtNextAction,
 getEdielTgtTestCases,
 type EdielTgtExpectedStep,
 type EdielTgtRunEvaluation,
 type EdielTgtStepMatch,
 type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import {
 getEdielTgtTestDataForCase,
 type EdielTgtCaseTestData,
 type EdielTgtCaseTestDataGroup,
} from '@/lib/ediel/tgtTestData'
import type { EdielTgtDynamicTestDataSummary } from '@/lib/ediel/tgtTestDataStore'
import { getEdielTgtDraftOptionsForCase } from '@/lib/ediel/tgtEdifact'
import { edielCodeLabel } from '@/lib/ediel/codeLabels'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'

type BadgeTone = 'slate' | 'emerald' | 'amber' | 'red'

type TgtWorkbenchGroupConfig = {
 id: string
 title: string
 description: string
 tone: BadgeTone
 prefixes: string[]
}

type TgtWorkbenchGroup = TgtWorkbenchGroupConfig & {
 testCases: EdielTgtTestCaseDefinition[]
}

const TGT_PRODAT_GROUPS: TgtWorkbenchGroupConfig[] = [
 {
 id: 's1-2',
 title: 'S1.2 – Korrekt PRODAT Z03/Z04',
 description: 'Positiva basflöden. Z03/Z04 skapas från riktig kunddata och kvittenser matchas mot portalens svar.',
 tone: 'emerald',
 prefixes: ['1.2'],
 },
 {
 id: 's1-3',
 title: 'S1.3 – Negativ APERAK Z03',
 description: 'Fel i affärsinnehåll för Z03, exempelvis anläggnings-id, nätområde, transaktionstyp eller datum.',
 tone: 'red',
 prefixes: ['1.3'],
 },
 {
 id: 's1-4',
 title: 'S1.4 – Negativ APERAK Z04',
 description: 'Fel i Z04/Z04D, exempelvis saknad anläggningsreferens, ärendereferens eller felaktig årsförbrukning.',
 tone: 'red',
 prefixes: ['1.4'],
 },
 {
 id: 's1-5',
 title: 'S1.5 – Syntaxfel / negativ CONTRL',
 description: 'Syntaxfel ska ge negativ CONTRL. Detta är inte en APERAK-affärskontroll.',
 tone: 'amber',
 prefixes: ['1.5'],
 },
 {
 id: 's2-1',
 title: 'S2.1 – Korrekt PRODAT Z06',
 description: 'Z06F/Z06G för ändrad avräkning, mätmetod, räkneverk eller anläggningsadress.',
 tone: 'emerald',
 prefixes: ['2.1'],
 },
 {
 id: 's2-2',
 title: 'S2.2 – Felaktigt PRODAT Z06',
 description: 'Negativa Z06-testfall, till exempel felaktigt anläggnings-id eller saknade mätaruppgifter.',
 tone: 'red',
 prefixes: ['2.2'],
 },
 {
 id: 's2-3',
 title: 'S2.3 – Korrekt PRODAT Z10',
 description: 'Korrekt Z10M för mätarbyte och relaterade mätaruppgifter.',
 tone: 'emerald',
 prefixes: ['2.3'],
 },
 {
 id: 's2-4',
 title: 'S2.4 – Felaktigt PRODAT Z10',
 description: 'Negativa Z10M-testfall, till exempel när konstant eller annan mätarinformation saknas.',
 tone: 'red',
 prefixes: ['2.4'],
 },
 {
 id: 's2-5',
 title: 'S2.5 – Korrekt PRODAT Z09',
 description: 'Korrekt Z09F/Z09G/Z09D, inklusive nytt avtal om mikroproduktion.',
 tone: 'emerald',
 prefixes: ['2.5'],
 },
 {
 id: 's3-1',
 title: 'S3.1 – Korrekt PRODAT Z05',
 description: 'Korrekt Z05L och Z05LK.',
 tone: 'emerald',
 prefixes: ['3.1'],
 },
 {
 id: 's3-2',
 title: 'S3.2 – Negativ APERAK Z05',
 description: 'Negativ APERAK för Z05, exempelvis felaktigt anläggnings-id.',
 tone: 'red',
 prefixes: ['3.2'],
 },
 {
 id: 's8-1',
 title: 'S8.1 – Energitjänsteföretag: korrekt Z13/Z14',
 description: 'ESCO-flöden där GridCore skickar Z13 och portalen svarar med Z14.',
 tone: 'emerald',
 prefixes: ['8.1'],
 },
 {
 id: 's8-2',
 title: 'S8.2 – Energitjänsteföretag: negativ APERAK Z14V',
 description: 'Felaktig Z14V ska få positiv CONTRL och negativ APERAK.',
 tone: 'red',
 prefixes: ['8.2'],
 },
 {
 id: 's9-1',
 title: 'S9.1 – Energitjänsteföretag: korrekt Z15/Z18',
 description: 'Avslutsflöden för tillstånd: Z15 och Z18.',
 tone: 'emerald',
 prefixes: ['9.1'],
 },
 {
 id: 's9-2',
 title: 'S9.2 – Energitjänsteföretag: negativ APERAK Z15V',
 description: 'Felaktig Z15V ska få positiv CONTRL och negativ APERAK.',
 tone: 'red',
 prefixes: ['9.2'],
 },
]

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
 const classes = {
 slate: 'border-slate-200 bg-slate-50 text-slate-700',
 emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
 amber: 'border-amber-200 bg-amber-50 text-amber-700',
 red: 'border-red-200 bg-red-50 text-red-700',
 }[tone]

 return (
 <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${classes}`}>
 {children}
 </span>
 )
}


function normalizeBadgeTone(tone: string | null | undefined): BadgeTone {
 if (tone === 'green' || tone === 'blue' || tone === 'indigo' || tone === 'emerald') return 'emerald'
 if (tone === 'yellow' || tone === 'amber') return 'amber'
 if (tone === 'red') return 'red'
 return 'slate'
}

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value
 return date.toLocaleString('sv-SE')
}

function statusTone(status: EdielTgtRunEvaluation['computedStatus']): BadgeTone {
 if (status === 'passed') return 'emerald'
 if (status === 'failed' || status === 'not_mapped') return 'red'
 if (status === 'in_progress') return 'amber'
 return 'slate'
}

function dbStatusTone(status: EdielTestRunRow['status']): BadgeTone {
 if (status === 'passed') return 'emerald'
 if (status === 'failed') return 'red'
 if (status === 'running') return 'amber'
 if (status === 'cancelled') return 'slate'
 return 'emerald'
}

function definitionTone(status: EdielTgtTestCaseDefinition['status']): 'emerald' | 'amber' {
 return status === 'ready_for_file_engine' ? 'emerald' : 'amber'
}

function directionLabel(direction: string): string {
 return direction === 'outbound' ? 'GridCore → Portal' : 'Portal → GridCore'
}

function actorLabel(actor: EdielTgtExpectedStep['actor']): string {
 return actor === 'gridex' ? 'GridCore skapar/skickar' : 'Edielportalen svarar'
}

function compareTestCaseCodes(a: string, b: string): number {
 return a.localeCompare(b, 'sv-SE', { numeric: true, sensitivity: 'base' })
}

function matchesPrefix(code: string, prefix: string): boolean {
 return code === prefix || code.startsWith(`${prefix}.`)
}

function testDataKey(suite: string, roleCode: string, testCaseCode: string): string {
 return `${suite}:${roleCode}:${testCaseCode}`
}

function buildDynamicTestDataMap(rows: EdielTgtDynamicTestDataSummary[]): Map<string, EdielTgtDynamicTestDataSummary> {
 return new Map(rows.map((row) => [testDataKey(row.testSuite, row.roleCode, row.testCaseCode), row]))
}

function dynamicRowForCase(
 map: Map<string, EdielTgtDynamicTestDataSummary>,
 testCase: EdielTgtTestCaseDefinition
): EdielTgtDynamicTestDataSummary | null {
 return map.get(testDataKey(testCase.suite, testCase.roleCode, testCase.testCaseCode)) ?? null
}

function getGroupedProdatDefinitions(definitions: EdielTgtTestCaseDefinition[]): TgtWorkbenchGroup[] {
 const prodatCases = definitions
 .filter((definition) => definition.suite === 'PRODAT')
 .sort((a, b) => compareTestCaseCodes(a.testCaseCode, b.testCaseCode))

 return TGT_PRODAT_GROUPS.map((group) => ({
 ...group,
 testCases: prodatCases.filter((definition) =>
 group.prefixes.some((prefix) => matchesPrefix(definition.testCaseCode, prefix))
 ),
 })).filter((group) => group.testCases.length > 0)
}

function prodatStepCodeLabel(step: EdielTgtExpectedStep): string {
 if (step.family !== 'PRODAT') return step.code
 return edielCodeLabel('prodat_code', step.code)
}

function isAckLikeFamily(family: string | null | undefined): boolean {
 const normalized = String(family ?? '').toUpperCase()
 return normalized === 'CONTRL' || normalized === 'APERAK' || normalized === 'UTILTS_ERR'
}

function nextActionKindLabel(kind: string): string {
 if (kind === 'generate_gridex_file') return 'Skapa GridCore-fil'
 if (kind === 'import_portal_file') return 'Väntar på portalfil'
 if (kind === 'review_failed') return 'Granska fel'
 if (kind === 'completed') return 'Klart'
 return kind.replaceAll('_', ' ')
}

function matchStatusLabel(status: EdielTgtStepMatch['status']): string {
 if (status === 'passed') return 'Klar'
 if (status === 'mismatch') return 'Fel/mismatch'
 return 'Väntar'
}

function isFirstRecommendedCase(testCase: EdielTgtTestCaseDefinition): boolean {
 return testCase.suite === 'PRODAT' && testCase.roleCode === 'supplier' && testCase.testCaseCode === '1.2.1'
}

function portalTestName(testCase: EdielTgtTestCaseDefinition): string {
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'supplier' && testCase.testCaseCode === '1.2.2') {
 return 'Leverantör · S1.2 · 1.2.2 Z03LK, minimi information'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'supplier' && testCase.testCaseCode === '1.2.1') {
 return 'Leverantör · S1.2 · 1.2.1 Z03L, extra information'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'supplier' && testCase.testCaseCode === '1.2.5') {
 return 'Leverantör · S1.2 · 1.2.5 Z04D, mottagningspliktig mikroproduktion'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'supplier' && testCase.testCaseCode === '1.3.1') {
 return 'Leverantör · S1.3 · Negativ APERAK - Z03'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'supplier' && testCase.testCaseCode === '1.5') {
 return 'Leverantör · S1.5 · Syntaxfel - negativ CONTRL'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '8.1.1') {
 return 'Energitjänsteföretag · S8.1 · 8.1.1 PRODAT Z13V och positivt Z14V'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '8.1.2') {
 return 'Energitjänsteföretag · S8.1 · 8.1.2 PRODAT Z13V och Z14N'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '8.1.3') {
 return 'Energitjänsteföretag · S8.1 · 8.1.3 PRODAT Z13VH och positivt Z14'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '8.2.1') {
 return 'Energitjänsteföretag · S8.2 · 8.2.1 Negativ APERAK - Z14V'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '9.1.1') {
 return 'Energitjänsteföretag · S9.1 · 9.1.1 PRODAT Z15V'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '9.1.2') {
 return 'Energitjänsteföretag · S9.1 · 9.1.2 PRODAT Z18V och Z15V'
 }
 if (testCase.suite === 'PRODAT' && testCase.roleCode === 'esco' && testCase.testCaseCode === '9.2.1') {
 return 'Energitjänsteföretag · S9.2 · 9.2.1 Negativ APERAK - Z15V'
 }
 return testCase.suite + ' · ' + testCase.testCaseCode
}

const PORTAL_PRODAT_S12_STEPS = [
 ['1', 'PRODAT (97A) / Z03', 'Aktör → Portal', 'Skicka Z03-filen från GridCore till Edielportalen.'],
 ['2', 'CONTRL (2)', 'Portal → Aktör', 'Ladda ner/kopiera portalens CONTRL-svar och importera i Filimport.'],
 ['3', 'APERAK (96A)', 'Portal → Aktör', 'Ladda ner/kopiera portalens APERAK-svar och importera i Filimport.'],
 ['4', 'PRODAT (97A) / Z04', 'Portal → Aktör', 'Ladda ner/kopiera portalens Z04 och importera i Filimport.'],
 ['5', 'CONTRL (2)', 'Aktör → Portal', 'GridCore skapar CONTRL via inbound-kortet efter Z04-import. Skicka inte CONTRL från generiskt TGT-utkast.'],
 ['6', 'APERAK (96A)', 'Aktör → Portal', 'GridCore skapar APERAK via inbound-kortet efter Z04-import. Skicka inte APERAK från generiskt TGT-utkast.'],
] as const

function PortalTestStepTable() {
 return (
 <div className="mt-3 overflow-x-auto rounded-2xl border border-emerald-100 bg-white">
 <table className="min-w-full text-left text-xs">
 <thead className="bg-emerald-50 text-emerald-900">
 <tr>
 <th className="px-3 py-2 font-semibold">Portalsteg</th>
 <th className="px-3 py-2 font-semibold">Meddelande</th>
 <th className="px-3 py-2 font-semibold">Riktning</th>
 <th className="px-3 py-2 font-semibold">Vad du gör</th>
 </tr>
 </thead>
 <tbody>
 {PORTAL_PRODAT_S12_STEPS.map(([stepNo, message, direction, instruction]) => (
 <tr key={stepNo} className="border-t border-emerald-100 align-top">
 <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">{stepNo}</td>
 <td className="whitespace-nowrap px-3 py-2 text-slate-800">{message}</td>
 <td className="whitespace-nowrap px-3 py-2 text-slate-700">{direction}</td>
 <td className="min-w-[260px] px-3 py-2 text-slate-700">{instruction}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )
}

function PortalScopePanel() {
 return (
 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h3 className="text-sm font-semibold text-slate-950">Registrerat scope i Edielportalen</h3>
 <p className="mt-1 text-xs text-slate-700">
 Använd detta som kompass när du väljer test i portalen. Börja inte med alla tester samtidigt.
 </p>
 </div>
 <Badge tone="emerald">GridCore · APP + EDI</Badge>
 </div>
 <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
 <div className="rounded-xl border border-slate-200 bg-white p-3">
 <div className="text-xs font-semibold text-slate-900">Leverantör</div>
 <div className="mt-2 flex flex-wrap gap-1">
 <Badge>PRODAT</Badge>
 <Badge>UTILTS E66 KVART</Badge>
 <Badge>UTILTS E66 SCH</Badge>
 <Badge>UTILTS S02</Badge>
 <Badge>UTILTS S03</Badge>
 </div>
 </div>
 <div className="rounded-xl border border-slate-200 bg-white p-3">
 <div className="text-xs font-semibold text-slate-900">Energitjänsteföretag</div>
 <div className="mt-2 flex flex-wrap gap-1">
 <Badge>PRODAT tillstånd</Badge>
 </div>
 </div>
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
 <div className="font-semibold">Rekommenderad start</div>
 <p className="mt-1">Kör först Leverantör → S1.2 → 1.2.1 Z03L om det är testet som är öppet i portalen. Kör bara ett testfall åt gången.</p>
 </div>
 </div>
 </div>
 )
}

function getRecentMessageOptions(messages: EdielMessageRow[]) {
 return messages
 .filter((message) => ['manual_upload', 'email', 'smtp', 'api'].includes(message.transport_type))
 .slice(0, 80)
}

function messageOptionLabel(message: EdielMessageRow): string {
 const external = message.external_reference ?? message.transaction_reference ?? message.interchange_reference ?? 'utan ref'
 return `${message.direction} · ${message.message_family}/${String(message.message_code)} · ${message.status} · ${external} · ${formatDateTime(message.created_at)}`
}

function messagePreviewText(message: EdielMessageRow): string {
 const raw = String(message.raw_payload ?? '')
 .replace(/\r\n/g, ' ')
 .replace(/\n/g, ' ')
 .replace(/\s+/g, ' ')
 .trim()

 if (raw.length > 0) return raw.slice(0, 280)

 const parsed = message.parsed_payload ? JSON.stringify(message.parsed_payload) : ''
 return parsed.slice(0, 280) || 'Ingen payload sparad på meddelandet.'
}

function getManualAttachCandidates(messages: EdielMessageRow[], step: EdielTgtExpectedStep): EdielMessageRow[] {
 const strict = messages.filter((message) =>
 message.direction === step.direction &&
 message.message_family === step.family &&
 String(message.message_code) === String(step.code)
 )

 return (strict.length > 0 ? strict : getRecentMessageOptions(messages)).slice(0, 8)
}

function selectedValuesForGroup(group: EdielTgtCaseTestDataGroup, values: Record<string, string>) {
 return orderedTestDataColumns(group)
 .map((column) => ({ column, value: values[column.name] }))
 .filter((entry) => entry.value && entry.value.trim().length > 0)
}

type OrderedSummaryColumn = EdielTgtCaseTestDataGroup['columns'][number] & { sourceOrder?: number | null }

function sourceOrderForSummaryColumn(column: OrderedSummaryColumn): number {
 const value = Number(column.sourceOrder)
 return Number.isFinite(value) && value > 0 ? value : column.index
}

function orderedTestDataColumns(group: EdielTgtCaseTestDataGroup): OrderedSummaryColumn[] {
 return [...group.columns].sort((a, b) => {
 const orderDiff = sourceOrderForSummaryColumn(a as OrderedSummaryColumn) - sourceOrderForSummaryColumn(b as OrderedSummaryColumn)
 if (orderDiff !== 0) return orderDiff
 return a.index - b.index
 }) as OrderedSummaryColumn[]
}

function valueForSummaryField(group: EdielTgtCaseTestDataGroup, columnName: string, fieldCodes: string[]): string | null {
 for (const field of group.fields) {
 if (!fieldCodes.includes(String(field.fieldCode).toUpperCase())) continue
 const value = field.values[columnName]?.trim()
 if (value) return value
 }
 return null
}

function TestDataObjectOrder({ group }: { group: EdielTgtCaseTestDataGroup }) {
 const columns = orderedTestDataColumns(group).filter((column) =>
 valueForSummaryField(group, column.name, ['209', '233']) ||
 valueForSummaryField(group, column.name, ['227']) ||
 valueForSummaryField(group, column.name, ['228'])
 )

 if (columns.length === 0) return null

 return (
 <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
 <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900">
 Importerad objektordning som används för LIN-block
 </div>
 <div className="mt-2 space-y-1 text-xs text-emerald-950">
 {columns.map((column, index) => {
 const objectId = valueForSummaryField(group, column.name, ['209', '233']) ?? '—'
 const customerId = valueForSummaryField(group, column.name, ['227']) ?? '—'
 const customerName = valueForSummaryField(group, column.name, ['228']) ?? column.name
 const reference = valueForSummaryField(group, column.name, ['261']) ?? '—'

 return (
 <div key={`${group.block.sourceWorkbook}-${group.block.sourceSheet}-order-${column.name}`} className="rounded-lg bg-white px-2 py-1.5">
 <span className="font-semibold">{index + 1}.</span>{' '}
 <span>{objectId}</span>{' · '}
 <span>{customerName}</span>{' · '}
 <span>Kund {customerId}</span>{' · '}
 <span>Ref {reference}</span>
 </div>
 )
 })}
 </div>
 </div>
 )
}

function TestDataGroupTable({ group }: { group: EdielTgtCaseTestDataGroup }) {
 const visibleFields = group.fields.slice(0, 16)

 return (
 <div className="rounded-2xl border border-slate-200 bg-white p-3">
 <div className="flex flex-wrap items-start justify-between gap-2">
 <div>
 <div className="text-xs font-semibold text-slate-950">{group.block.entityLabel}</div>
 <div className="mt-1 text-[11px] text-slate-700">
 {group.block.sourceSheet} · {group.block.sourceWorkbook}
 </div>
 </div>
 <div className="flex flex-wrap gap-1">
 {orderedTestDataColumns(group).map((column, columnIndex) => (
 <Badge key={`${group.block.sourceWorkbook}-${group.block.sourceSheet}-${group.block.entityLabel}-column-${columnIndex}-${column.name}`}>
 {column.name}
 </Badge>
 ))}
 </div>
 </div>

 <TestDataObjectOrder group={group} />

 <div className="mt-3 overflow-x-auto">
 <table className="min-w-full text-left text-xs">
 <thead>
 <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-700">
 <th className="whitespace-nowrap px-2 py-2 font-semibold">Fält</th>
 <th className="min-w-[180px] px-2 py-2 font-semibold">Namn</th>
 <th className="min-w-[260px] px-2 py-2 font-semibold">Testdata</th>
 </tr>
 </thead>
 <tbody>
 {visibleFields.map((field, fieldIndex) => {
 const entries = selectedValuesForGroup(group, field.values)
 return (
 <tr key={`${group.block.sourceWorkbook}-${group.block.sourceSheet}-${group.block.entityLabel}-field-${fieldIndex}-${field.fieldCode}-${field.fieldName}`} className="border-b border-slate-100 align-top last:border-0">
 <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">{field.fieldCode}</td>
 <td className="px-2 py-2 text-slate-700">{field.fieldName}</td>
 <td className="px-2 py-2 text-slate-700">
 <div className="space-y-1">
 {entries.length === 0 ? (
 <span>—</span>
 ) : (
 entries.map((entry, entryIndex) => (
 <div key={`${group.block.sourceWorkbook}-${group.block.sourceSheet}-${group.block.entityLabel}-${fieldIndex}-entry-${entryIndex}-${entry.column.name}`}>
 <span className="font-medium text-slate-800">{entry.column.name}:</span> {entry.value}
 </div>
 ))
 )}
 </div>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>

 {group.fields.length > visibleFields.length ? (
 <div className="mt-2 text-[11px] text-slate-700">
 Visar {visibleFields.length} prioriterade fält av {group.fields.length}. Fullständig raddata finns i importregistret.
 </div>
 ) : null}
 </div>
 )
}

function TestDataSummary({ data }: { data: EdielTgtCaseTestData | null }) {
 if (!data || data.groups.length === 0) {
 return (
 <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
 Ingen importerad Excel-testdata är kopplad till detta testfall ännu.
 </div>
 )
 }

 return (
 <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
 <div className="flex flex-wrap items-start justify-between gap-2">
 <div>
 <div className="text-xs font-semibold text-emerald-950">{data.title}</div>
 <div className="mt-1 text-xs text-emerald-800">{data.sourceNote}</div>
 </div>
 <Badge tone="emerald">Excel-import</Badge>
 </div>
 <div className="mt-3 space-y-3">
 {data.groups.map((group, groupIndex) => (
 <TestDataGroupTable
 key={`${group.block.sourceWorkbook}-${group.block.sourceSheet}-${group.block.entityLabel}-group-${groupIndex}`}
 group={group}
 />
 ))}
 </div>
 </div>
 )
}

function CoverageDashboard({
 evaluations,
 definitions,
 archivedCount,
}: {
 evaluations: EdielTgtRunEvaluation[]
 definitions: EdielTgtTestCaseDefinition[]
 archivedCount: number
}) {
 const summary = getEdielTgtCoverageSummary(evaluations, definitions)
 const cells: Array<[string, string, BadgeTone]> = [
 ['Aktiva körningar', String(summary.totalRuns), 'slate'],
 ['Godkända', String(summary.passedRuns), 'emerald'],
 ['Fel/mismatch', String(summary.failedRuns), summary.failedRuns > 0 ? 'red' : 'slate'],
 ['Pågår', String(summary.inProgressRuns), 'amber'],
 ['Core-mallar körda', `${summary.coreCasesWithRuns}/${summary.totalCoreCases}`, summary.coreCasesWithoutRuns === 0 ? 'emerald' : 'amber'],
 ['Arkiverade/dolda', String(archivedCount), archivedCount > 0 ? 'amber' : 'slate'],
 ]

 return (
 <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h3 className="text-sm font-semibold text-slate-950">TGT coverage och arbetsläge</h3>
 <p className="mt-1 text-xs text-slate-700">
 Huvudvyn visar bara aktiva runs. Arkiverade runs ligger kvar i databasen för spårbarhet men döljs från arbetsflödet.
 </p>
 </div>
 <Badge tone={summary.readyForFinalApproval ? 'emerald' : 'amber'}>
 {summary.readyForFinalApproval ? 'redo för portal-kontroll' : 'inte komplett ännu'}
 </Badge>
 </div>

 <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
 {cells.map(([label, value, tone]) => (
 <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
 <div className="text-[11px] font-medium uppercase tracking-wide text-slate-700">{label}</div>
 <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-950">
 {value}
 <Badge tone={tone}>{tone}</Badge>
 </div>
 </div>
 ))}
 </div>
 </div>
 )
}

function Batch5RunbookPanel() {
 return (
 <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-950">
 <div className="font-semibold">Arbeta rent med TGT-runs</div>
 <div className="mt-2 grid gap-2 md:grid-cols-2">
 <div className="rounded-xl bg-white/70 p-3">
 <div className="font-medium">En aktiv run per testfall</div>
 <p className="mt-1 text-xs text-emerald-900">Starta helst bara en aktiv PRODAT/UTILTS-run åt gången. Arkivera äldre runs så arbetsvyn blir ren.</p>
 </div>
 <div className="rounded-xl bg-white/70 p-3">
 <div className="font-medium">Arkivera, inte hårdradera</div>
 <p className="mt-1 text-xs text-emerald-900">Arkivering sätter status till cancelled. Det håller audit/spårbarhet kvar men döljer run från huvudvyn.</p>
 </div>
 <div className="rounded-xl bg-white/70 p-3">
 <div className="font-medium">När portalen svarar</div>
 <p className="mt-1 text-xs text-emerald-900">Importera svaret i filmotorn, koppla det mot rätt TGT-steg och följ nästa instruktion i guided mode.</p>
 </div>
 <div className="rounded-xl bg-white/70 p-3">
 <div className="font-medium">Vid negativ kvittens</div>
 <p className="mt-1 text-xs text-emerald-900">Stoppa flödet, öppna meddelandet, läs ERC/FTX eller CONTRL-status och skapa inte nytt svar på samma transaktion innan felet är förstått.</p>
 </div>
 </div>
 </div>
 )
}

function RunArchiveControls({ evaluation }: { evaluation: EdielTgtRunEvaluation }) {
 return (
 <div className="mt-3 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
 <form action={archiveEdielTgtRunAction}>
 <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
 <input type="hidden" name="reason" value="Arkiverad från TGT workbench för renare arbetsvy." />
 <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
 Arkivera denna run
 </button>
 </form>

 <form action={archiveOlderEdielTgtRunsForCaseAction}>
 <input type="hidden" name="keepTestRunId" value={evaluation.testRun.id} />
 <input type="hidden" name="testSuite" value={evaluation.testRun.test_suite} />
 <input type="hidden" name="roleCode" value={evaluation.testRun.role_code} />
 <input type="hidden" name="testCaseCode" value={evaluation.testRun.test_case_code} />
 <button className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
 Rensa äldre runs för samma testfall
 </button>
 </form>

 <div className="flex items-center text-xs text-slate-700">
 Rensning arkiverar äldre dubletter men behåller denna run aktiv.
 </div>
 </div>
 )
}

function GuidedNextActionPanel({ evaluation }: { evaluation: EdielTgtRunEvaluation }) {
 const nextAction = getEdielTgtNextAction(evaluation)
 const tone = normalizeBadgeTone(nextAction.tone)
 const isWaitingForPortal = nextAction.kind === 'import_portal_file'
 const nextStep = evaluation.definition?.expectedSteps.find((step) => step.stepNo === nextAction.stepNo) ?? null
 const shouldUseCustomerProdat =
 nextAction.kind === 'create_file' &&
 nextStep?.family === 'PRODAT' &&
 Boolean(evaluation.definition && ['1.2.1', '1.2.2', '1.2.5'].includes(evaluation.definition.testCaseCode))

 const isAckLikeNextStep = isAckLikeFamily(nextStep?.family)

 return (
 <div className={`mt-4 rounded-2xl border p-4 ${tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : tone === 'red' ? 'border-red-200 bg-red-50 text-red-950' : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-950'}`}>
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-xs font-semibold uppercase tracking-wide">Nästa steg</div>
 <div className="mt-1 text-sm font-semibold">{nextAction.title}</div>
 <p className="mt-1 text-xs">{nextAction.description}</p>
 {isWaitingForPortal ? (
 <p className="mt-2 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs text-amber-900">
 Detta steg ägs av Edielportalen. Nästa riktiga steg är att hämta/kopiera svaret i portalen och importera det under Filimport som inbound/TGT. Simulerat portalsvar är bara för intern övning och ska aldrig skickas till portalen.
 </p>
 ) : null}
 {shouldUseCustomerProdat ? (
 <p className="mt-2 rounded-xl border border-emerald-200 bg-white/70 px-3 py-2 text-xs text-emerald-900">
 PRODAT Z03/Z04 ska skapas från riktig kund/testkund i avsnittet Kundstyrd PRODAT ovan. TGT-guiden används här som checklista och för att importera portalens svar.
 </p>
 ) : null}
 {isAckLikeNextStep ? (
 <p className="mt-2 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs text-amber-900">
 {nextStep?.family} ska inte skapas från generiskt TGT-utkast här. Använd inbound-meddelandekortet för rätt CONTRL/APERAK-flöde. Detta skyddar mot fel som “Saknar BGM” på CONTRL.
 </p>
 ) : null}
 </div>
 <Badge tone={tone}>{nextActionKindLabel(nextAction.kind)}</Badge>
 </div>

 <div className="mt-3 flex flex-wrap gap-2">
 {!shouldUseCustomerProdat && !isAckLikeNextStep ? (
 <form action={runEdielTgtAutopilotAction}>
 <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
 <button className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
 Försök skapa nästa GridCore-utkast
 </button>
 </form>
 ) : null}

 {shouldUseCustomerProdat ? (
 <a href="#production-prodat" className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
 Gå till kundstyrd PRODAT
 </a>
 ) : null}

 {evaluation.definition && nextAction.canGenerateDraft && nextAction.stepNo && !shouldUseCustomerProdat && !isAckLikeNextStep ? (
 <form action={createEdielTgtDraftAction}>
 <input type="hidden" name="testSuite" value={evaluation.definition.suite} />
 <input type="hidden" name="roleCode" value={evaluation.definition.roleCode} />
 <input type="hidden" name="testCaseCode" value={evaluation.definition.testCaseCode} />
 <input type="hidden" name="stepNo" value={nextAction.stepNo} />
 <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
 Skapa fil för steg {nextAction.stepNo}
 </button>
 </form>
 ) : null}

 {evaluation.definition && nextAction.canGenerateDraft && nextAction.stepNo && isAckLikeNextStep ? (
 <div className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900">
 {nextStep?.family} skapas på inbound-kortet, inte här.
 </div>
 ) : null}

 {isWaitingForPortal ? (
 <form action={createMockPortalMessageForNextTgtStepAction}>
 <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
 <button className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50">
 Simulera portalens svar internt
 </button>
 </form>
 ) : null}

 <form action={markEdielTgtRunStatusAction} className="flex flex-wrap gap-2">
 <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
 <select name="status" className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-950">
 <option value="running">Markera som pågående</option>
 <option value="passed">Markera som godkänd i Gridex</option>
 <option value="failed">Markera som felad</option>
 <option value="cancelled">Arkivera/avbryt run</option>
 </select>
 <input name="failureReason" placeholder="Kommentar vid fel/arkivering" className="min-w-[180px] rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-950 placeholder:text-slate-500" />
 <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
 Uppdatera status
 </button>
 </form>
 </div>
 </div>
 )
}

function DraftOptionPanel({
 testCase,
 testRunId,
 compact = false,
}: {
 testCase: EdielTgtTestCaseDefinition
 testRunId?: string | null
 compact?: boolean
}) {
 const options = getEdielTgtDraftOptionsForCase(
 testCase.suite,
 testCase.roleCode,
 testCase.testCaseCode
 )
 const usesCustomerProdat = ['1.2.1', '1.2.2', '1.2.5'].includes(testCase.testCaseCode)
 const prodatOptions = options.filter((option) => option.canGenerate && option.family === 'PRODAT')
 const ackLikeOptions = options.filter((option) => option.canGenerate && isAckLikeFamily(option.family))
 const generatable = options.filter((option) =>
 option.canGenerate &&
 !isAckLikeFamily(option.family) &&
 (!usesCustomerProdat || option.family !== 'PRODAT')
 )

 if (generatable.length === 0) {
 if (prodatOptions.length > 0 && usesCustomerProdat && !compact) {
 return (
 <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
 PRODAT Z03/Z04 ska skapas från kundstyrd PRODAT ovan, inte från en separat testgenerator. Skapa först Edielportal-testkund och switchärende, använd sedan Z03/Z04-knapparna i kundstyrda panelen.
 </div>
 )
 }

 if (ackLikeOptions.length > 0 && !compact) {
 return (
 <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
 CONTRL, APERAK och UTILTS-ERR skapas inte som generiska TGT-utkast här. Importera först portalens meddelande och använd rätt åtgärd på inbound-kortet. Det förhindrar fel som “Saknar BGM” på CONTRL.
 </div>
 )
 }

 return compact ? null : (
 <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
 Det finns inga GridCore-steg att generera för detta testfall. Importera filerna från Edielportalen i stället.
 </div>
 )
 }

 return (
 <div className={compact ? 'mt-2 flex flex-wrap gap-2' : 'mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3'}>
 {!compact ? (
 <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
 <div>
 <div className="text-xs font-semibold text-emerald-950">Skapa TGT-filutkast</div>
 <div className="mt-1 text-xs text-emerald-800">
 Systemet skapar ett filutkast. Edielportalen är fortfarande slutligt facit.
 </div>
 </div>
 <Badge tone="emerald">generator</Badge>
 </div>
 ) : null}

 <div className="flex flex-wrap gap-2">
 {generatable.map((option) => (
 <form key={`${testCase.testCaseCode}-${option.stepNo}`} action={createEdielTgtDraftAction}>
 <input type="hidden" name="testSuite" value={testCase.suite} />
 <input type="hidden" name="roleCode" value={testCase.roleCode} />
 <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
 <input type="hidden" name="stepNo" value={option.stepNo} />
 {testRunId ? <input type="hidden" name="testRunId" value={testRunId} /> : null}
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
 Skapa steg {option.stepNo}: {option.family}/{option.code}{option.outcome ? ` ${option.outcome}` : ''}
 </button>
 </form>
 ))}
 </div>
 </div>
 )
}

function TestCaseCard({
 testCase,
 activeRunsForCase,
 dynamicTestDataRow,
}: {
 testCase: EdielTgtTestCaseDefinition
 activeRunsForCase: number
 dynamicTestDataRow: EdielTgtDynamicTestDataSummary | null
}) {
 const staticTestData = getEdielTgtTestDataForCase(testCase.suite, testCase.roleCode, testCase.testCaseCode)
 const testData = dynamicTestDataRow?.parsedPayload ?? staticTestData
 const hasDynamicData = Boolean(dynamicTestDataRow?.parsedPayload)

 return (
 <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm open:ring-2 open:ring-emerald-100">
 <summary className="cursor-pointer list-none p-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="flex flex-wrap gap-2">
 <Badge tone="emerald">{testCase.suite}</Badge>
 <Badge tone="emerald">{testCase.testCaseCode}</Badge>
 <Badge>{testCase.roleCode}</Badge>
 <Badge tone={definitionTone(testCase.status)}>{testCase.status}</Badge>
 {testData ? <Badge tone="emerald">testdata kopplad</Badge> : <Badge tone="amber">utan testdata</Badge>}
 <Badge tone={activeRunsForCase > 0 ? 'amber' : 'slate'}>{activeRunsForCase} aktiva runs</Badge>
 {isFirstRecommendedCase(testCase) ? <Badge tone="emerald">börja här</Badge> : null}
 </div>
 <h3 className="mt-3 text-sm font-semibold text-slate-950">{testCase.title}</h3>
 <p className="mt-1 text-sm text-slate-700">{testCase.purpose}</p>
 <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
 <span className="font-semibold">I Edielportalen:</span> {portalTestName(testCase)}
 </div>
 <p className="mt-2 text-xs font-medium text-emerald-700 group-open:hidden">
 Klicka här för att öppna ett fokuserat testfönster. Du behöver inte scrolla hela sidan.
 </p>
 </div>
 <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
 Öppna testfönster
 </div>
 </div>
 </summary>

 <div className="border-t border-slate-100 p-4">
 <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-emerald-950">Guidat arbetsfönster</div>
 <p className="mt-1 text-xs text-emerald-800">
 Jobba klart detta testfall här inne: skapa run, skapa fil, importera portalens svar och följ stegen tills allt är grönt.
 </p>
 </div>
 <form action={createEdielTgtRunFromTemplateAction}>
 <input type="hidden" name="testSuite" value={testCase.suite} />
 <input type="hidden" name="roleCode" value={testCase.roleCode} />
 <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
 Starta i GridCore
 </button>
 </form>
 </div>
 </div>

 <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
 <div><span className="font-semibold text-slate-800">Testdata:</span> {testCase.testDataHint}</div>
 <div className="mt-1"><span className="font-semibold text-slate-800">Version:</span> {testCase.approvalVersion}</div>
 </div>

 {isFirstRecommendedCase(testCase) ? (
 <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
 <div className="text-sm font-semibold text-emerald-950">Så matchar GridCore mot Edielportalens S1.2-steg</div>
 <p className="mt-1 text-xs text-emerald-900">
 Börja med steg 1. När portalen ger svar importerar du svaren via Filimport. GridCore skapar sedan svar på steg 5 och 6 via inbound-meddelandekortet.
 </p>
 <PortalTestStepTable />
 </div>
 ) : null}

 <details className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3" open={!hasDynamicData && !staticTestData}>
 <summary className="cursor-pointer text-xs font-semibold text-emerald-950">
 Importera/uppdatera testdata från Edielportalen
 </summary>
 <form action={saveEdielTgtPortalTestDataAction} className="mt-3 space-y-3">
 <input type="hidden" name="testSuite" value={testCase.suite} />
 <input type="hidden" name="roleCode" value={testCase.roleCode} />
 <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
 <input
 name="title"
 defaultValue={dynamicTestDataRow?.title ?? testCase.title}
 className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-950"
 placeholder="Rubrik, t.ex. 1.3.2 Fel nätområdesid"
 />
 <label className="block text-xs font-semibold text-emerald-950">
 Ladda upp Excel/CSV-export från Edielportalen
 <input
 name="testDataFile"
 type="file"
 multiple
 accept=".xlsx,.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
 className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-950 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
 />
 </label>
 <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
 eller klistra in testdata manuellt
 </div>
 <textarea
 name="rawText"
 defaultValue={dynamicTestDataRow?.rawText ?? ''}
 rows={8}
 className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-950 placeholder:text-slate-500"
 placeholder={"Klistra in testdata från Edielportalen, t.ex.\n209 Anläggningsid\t735999888000000079\n210 Avtal, startdatum\t202605100000\n217 Mätmetod\tZ03\n227 Kund-id\t196604072782"}
 />
 <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-[11px] leading-5 text-emerald-900">
 Generatorn läser importerad testdata före statiska bilagor. Du kan välja flera filer samtidigt. Importen slår ihop filerna och tar bort dubbletter baserat på anläggnings-id/kund-id/fullmaktsreferens. Filuppladdning kombineras med inklistrad text om båda anges. Scenario-regeln ändrar bara testfelet, t.ex. 1.3.2 skickar RFF+Z05:TEX trots att portalens normaldata säger TES.
 </div>
 <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
 Spara testdata för detta testfall
 </button>
 </form>
 </details>

 <details className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
 <summary className="cursor-pointer text-xs font-semibold text-emerald-950">
 Visa testdata som generatorn använder
 </summary>
 {hasDynamicData ? (
 <div className="mb-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-900">
 Datakälla: importerad från Edielportalen. Ingen hårdkodad testkund används för detta testfall.
 </div>
 ) : (
 <div className="mb-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900">
 Datakälla: statisk bilaga/fallback. För nya testfall ska du importera Edielportalens testdata ovan.
 </div>
 )}
 <TestDataSummary data={testData} />
 </details>

 <DraftOptionPanel testCase={testCase} />

 <div className="mt-4 space-y-2">
 {testCase.expectedSteps.map((step) => (
 <div key={step.stepNo} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
 <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-slate-700">
 {step.stepNo}
 </div>
 <div className="min-w-0 flex-1">
 <div className="font-semibold text-slate-900">{step.title}</div>
 <div className="mt-1 text-slate-700">{step.description}</div>
 <div className="mt-2 flex flex-wrap gap-2">
 <Badge>{directionLabel(step.direction)}</Badge>
 <Badge>{actorLabel(step.actor)}</Badge>
 <Badge>{step.family}</Badge>
 <Badge>{prodatStepCodeLabel(step)}</Badge>
 {step.outcome ? <Badge tone={step.outcome === 'positive' ? 'emerald' : 'red'}>{step.outcome}</Badge> : null}
 <Badge tone={step.required ? 'emerald' : 'slate'}>{step.required ? 'obligatorisk' : 'alternativ'}</Badge>
 {isAckLikeFamily(step.family) ? <Badge tone="amber">skapas på inbound-kort</Badge> : null}
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 </details>
 )
}

function RunEvaluationCard({
 evaluation,
 messages,
 dynamicTestDataMap,
}: {
 evaluation: EdielTgtRunEvaluation
 messages: EdielMessageRow[]
 dynamicTestDataMap: Map<string, EdielTgtDynamicTestDataSummary>
}) {
 const options = getRecentMessageOptions(messages)
 const dynamicTestDataRow = evaluation.definition ? dynamicRowForCase(dynamicTestDataMap, evaluation.definition) : null
 const testData = dynamicTestDataRow?.parsedPayload ?? (evaluation.definition
 ? getEdielTgtTestDataForCase(
 evaluation.definition.suite,
 evaluation.definition.roleCode,
 evaluation.definition.testCaseCode
 )
 : null)

 return (
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="flex flex-wrap gap-2">
 <Badge tone="emerald">{evaluation.testRun.test_suite}</Badge>
 <Badge tone="emerald">{evaluation.testRun.test_case_code}</Badge>
 <Badge>{evaluation.testRun.role_code}</Badge>
 <Badge tone={statusTone(evaluation.computedStatus)}>{evaluation.computedStatus}</Badge>
 <Badge tone={dbStatusTone(evaluation.testRun.status)}>DB: {evaluation.testRun.status}</Badge>
 {testData ? <Badge tone="emerald">testdata</Badge> : null}
 </div>
 <h3 className="mt-3 text-sm font-semibold text-slate-950">
 {evaluation.definition?.title ?? evaluation.testRun.title ?? 'Ej mappat testfall'}
 </h3>
 <p className="mt-1 text-xs text-slate-700">
 Skapad {formatDateTime(evaluation.testRun.created_at)} · ID {evaluation.testRun.id}
 </p>
 </div>
 <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
 {evaluation.passedSteps}/{evaluation.requiredSteps} obligatoriska steg klara
 </div>
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-3">
 <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
 <div className="font-semibold text-slate-950">1. Jobba här</div>
 <p className="mt-1">Följ bara nästa steg-kortet nedan. Skapa inte flera parallella runs för samma portaltest.</p>
 </div>
 <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
 <div className="font-semibold text-slate-950">2. Portalens svar</div>
 <p className="mt-1">CONTRL, APERAK och Z04 kommer från Edielportalen. Importera varje svar i Filimport.</p>
 </div>
 <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
 <div className="font-semibold text-slate-950">3. GridCore svarar</div>
 <p className="mt-1">När Z04 är importerad skapar GridCore CONTRL/APERAK via inbound-kortet, inte via generiskt TGT-utkast.</p>
 </div>
 </div>

 <GuidedNextActionPanel evaluation={evaluation} />
 <RunArchiveControls evaluation={evaluation} />

 {testData ? (
 <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
 <div className="font-semibold">{testData.title}</div>
 <div className="mt-1">{testData.sourceNote}</div>
 </div>
 ) : null}

 {evaluation.definition ? (
 <div className="mt-4 space-y-2">
 {evaluation.matches.map((match) => {
 const manualCandidates = getManualAttachCandidates(options, match.step)

 return (
 <div key={match.step.stepNo} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="flex flex-wrap gap-2">
 <Badge tone={match.status === 'passed' ? 'emerald' : match.status === 'mismatch' ? 'red' : 'amber'}>
 {matchStatusLabel(match.status)}
 </Badge>
 <Badge>Steg {match.step.stepNo}</Badge>
 <Badge>{directionLabel(match.step.direction)}</Badge>
 <Badge>{actorLabel(match.step.actor)}</Badge>
 <Badge>{match.step.family}</Badge>
 <Badge>{prodatStepCodeLabel(match.step)}</Badge>
 {match.step.outcome ? <Badge>{match.step.outcome}</Badge> : null}
 {isAckLikeFamily(match.step.family) ? <Badge tone="amber">använd inbound-kort</Badge> : null}
 </div>
 <div className="mt-2 text-sm font-semibold text-slate-900">{match.step.title}</div>
 <div className="mt-1 text-xs text-slate-700">{match.step.description}</div>
 {isAckLikeFamily(match.step.family) ? (
 <div className="mt-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900">
 Skapa inte {match.step.family} från TGT-workbench. Öppna/importera det inkommande PRODAT-meddelandet och använd kvittensknappen på inbound-kortet.
 </div>
 ) : null}
 {match.issues.length > 0 ? (
 <div className="mt-2 text-xs text-red-700">{match.issues.join(' · ')}</div>
 ) : null}
 {match.message ? (
 <Link
 href={`/admin/ediel/messages/${match.message.id}`}
 className="mt-2 inline-block text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
 >
 Öppna matchat meddelande
 </Link>
 ) : null}
 </div>
 <details className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-2">
 <summary className="cursor-pointer text-xs font-semibold text-slate-700">Avancerat: koppla manuellt</summary>
 <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] leading-5 text-amber-900">
 Öppna och kontrollera payloaden innan du kopplar. Koppla inte ett meddelande bara på datum — kontrollera family/code, riktning och referenser först.
 </div>

 <div className="mt-2 space-y-2">
 {manualCandidates.map((message) => (
 <div key={message.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex flex-wrap gap-1">
 <Badge tone={message.direction === match.step.direction ? 'emerald' : 'amber'}>{message.direction}</Badge>
 <Badge tone={message.message_family === match.step.family ? 'emerald' : 'amber'}>{message.message_family}/{String(message.message_code)}</Badge>
 <Badge>{message.status}</Badge>
 </div>
 <Link
 href={`/admin/ediel/messages/${message.id}`}
 className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
 >
 Öppna och läs
 </Link>
 </div>
 <div className="mt-2 grid gap-1 text-[11px] text-slate-700 md:grid-cols-2">
 <div>External: {message.external_reference ?? '—'}</div>
 <div>Transaction: {message.transaction_reference ?? '—'}</div>
 <div>Interchange: {message.interchange_reference ?? '—'}</div>
 <div>Skapad: {formatDateTime(message.created_at)}</div>
 </div>
 <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[11px] text-slate-700">{messagePreviewText(message)}</pre>
 </div>
 ))}
 </div>

 <form action={attachEdielMessageToTestRunAction} className="mt-2 flex flex-wrap items-center gap-2">
 <input type="hidden" name="testRunId" value={evaluation.testRun.id} />
 <input type="hidden" name="stepNo" value={match.step.stepNo} />
 <input type="hidden" name="expectedDirection" value={match.step.direction} />
 <input type="hidden" name="expectedFamily" value={match.step.family} />
 <input type="hidden" name="expectedCode" value={match.step.code} />
 <select name="edielMessageId" className="max-w-[420px] rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-950">
 <option value="">Välj kontrollerat Ediel-meddelande…</option>
 {manualCandidates.map((message) => (
 <option key={message.id} value={message.id}>
 {messageOptionLabel(message)}
 </option>
 ))}
 </select>
 <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
 Koppla valt meddelande
 </button>
 </form>
 </details>
 </div>
 </div>
 )
 })}
 </div>
 ) : (
 <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
 Testfallet finns inte i Batch 4C-registret ännu. Skapa det via en av mallarna ovan för automatisk stegutvärdering.
 </div>
 )}
 </div>
 )
}

function GroupedTestCasePanel({
 groups,
 evaluations,
 activeRunsForCase,
 dynamicTestDataMap,
}: {
 groups: TgtWorkbenchGroup[]
 evaluations: EdielTgtRunEvaluation[]
 activeRunsForCase: (definition: EdielTgtTestCaseDefinition) => number
 dynamicTestDataMap: Map<string, EdielTgtDynamicTestDataSummary>
}) {
 function groupStats(group: TgtWorkbenchGroup) {
 const codes = new Set(group.testCases.map((testCase) => testCase.testCaseCode))
 const groupEvaluations = evaluations.filter((evaluation) =>
 codes.has(evaluation.definition?.testCaseCode ?? evaluation.testRun.test_case_code)
 )

 return {
 active: group.testCases.reduce((sum, testCase) => sum + activeRunsForCase(testCase), 0),
 passed: groupEvaluations.filter((evaluation) => evaluation.computedStatus === 'passed').length,
 failed: groupEvaluations.filter((evaluation) => evaluation.computedStatus === 'failed').length,
 inProgress: groupEvaluations.filter((evaluation) => evaluation.computedStatus === 'in_progress').length,
 }
 }

 return (
 <div className="space-y-3">
 {groups.map((group) => {
 const stats = groupStats(group)

 return (
 <details key={group.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm open:ring-2 open:ring-emerald-100">
 <summary className="cursor-pointer list-none">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="flex flex-wrap gap-2">
 <Badge tone={group.tone}>{group.title}</Badge>
 <Badge tone="slate">{group.testCases.length} testfall</Badge>
 <Badge tone={stats.active > 0 ? 'amber' : 'slate'}>{stats.active} aktiva</Badge>
 <Badge tone={stats.passed > 0 ? 'emerald' : 'slate'}>{stats.passed} klara</Badge>
 <Badge tone={stats.failed > 0 ? 'red' : 'slate'}>{stats.failed} fel</Badge>
 <Badge tone={stats.inProgress > 0 ? 'amber' : 'slate'}>{stats.inProgress} pågår</Badge>
 </div>
 <p className="mt-3 text-xs leading-5 text-slate-700">{group.description}</p>
 </div>
 <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
 Öppna grupp
 </div>
 </div>
 </summary>

 <div className="mt-4 space-y-4">
 {group.testCases.map((definition) => (
 <TestCaseCard
 key={`${definition.suite}-${definition.roleCode}-${definition.testCaseCode}`}
 testCase={definition}
 activeRunsForCase={activeRunsForCase(definition)}
 dynamicTestDataRow={dynamicRowForCase(dynamicTestDataMap, definition)}
 />
 ))}
 </div>
 </details>
 )
 })}
 </div>
 )
}

function ArchivedRunsPanel({ archivedRuns }: { archivedRuns: EdielTestRunRow[] }) {
 if (archivedRuns.length === 0) return null

 return (
 <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <summary className="cursor-pointer text-sm font-semibold text-slate-800">
 Visa arkiverade/dolda TGT-runs ({archivedRuns.length})
 </summary>
 <div className="mt-3 max-h-80 space-y-2 overflow-auto pr-2">
 {archivedRuns.slice(0, 80).map((run) => (
 <div key={run.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="font-semibold text-slate-900">
 {run.test_suite} · {run.test_case_code} · {run.role_code}
 </div>
 <Badge tone="slate">{run.status}</Badge>
 </div>
 <div className="mt-1">{run.title ?? '—'}</div>
 <div className="mt-1">Skapad {formatDateTime(run.created_at)} · Avslutad {formatDateTime(run.completed_at)}</div>
 {run.failure_reason ? <div className="mt-1 text-slate-700">{run.failure_reason}</div> : null}
 </div>
 ))}
 </div>
 </details>
 )
}

export default function EdielTgtWorkbenchPanel({
 messages,
 testRuns,
 dynamicTestDataRows = [],
}: {
 messages: EdielMessageRow[]
 testRuns: EdielTestRunRow[]
 dynamicTestDataRows?: EdielTgtDynamicTestDataSummary[]
}) {
 const definitions = getEdielTgtTestCases()
 const dynamicTestDataMap = buildDynamicTestDataMap(dynamicTestDataRows)
 const coreDefinitions = definitions.filter((definition) => definition.scope === 'core')
 const groupedProdatDefinitions = getGroupedProdatDefinitions(coreDefinitions)
 const activeRuns = testRuns.filter((run) => run.status !== 'cancelled')
 const archivedRuns = testRuns.filter((run) => run.status === 'cancelled')
 const evaluations = activeRuns
 .filter((run) => run.test_suite === 'PRODAT' || run.test_suite === 'UTILTS')
 .slice(0, 20)
 .map((run) => evaluateEdielTgtRun(run, messages))
 const linkedTestDataCount = coreDefinitions.filter((definition) =>
 Boolean(dynamicRowForCase(dynamicTestDataMap, definition)?.parsedPayload ?? getEdielTgtTestDataForCase(definition.suite, definition.roleCode, definition.testCaseCode))
 ).length

 function activeRunsForCase(definition: EdielTgtTestCaseDefinition): number {
 return activeRuns.filter((run) =>
 run.test_suite === definition.suite &&
 run.role_code === definition.roleCode &&
 run.test_case_code === definition.testCaseCode
 ).length
 }

 return (
 <section className="rounded-2xl border border-slate-200 bg-white p-5">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">TGT guided mode, generator och run-cleanup</h2>
 <p className="mt-1 max-w-4xl text-sm text-slate-700">
 Workbenchen visar bara aktiva TGT-runs. Gamla eller felaktiga runs kan arkiveras så du slipper en rörig arbetsvy utan att tappa spårbarhet i databasen.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Badge tone="emerald">PRODAT testkunder</Badge>
 <Badge tone="emerald">UTILTS testanläggningar</Badge>
 <Badge tone="emerald">EDIFACT-utkast</Badge>
 <Badge tone="emerald">{linkedTestDataCount}/{coreDefinitions.length} mallar med testdata</Badge>
 <Badge tone={archivedRuns.length > 0 ? 'amber' : 'slate'}>{archivedRuns.length} arkiverade</Badge>
 </div>
 </div>

 <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
 Håll bara en aktiv run per Edielportal-test. Arkivera felaktiga eller gamla runs innan du kör vidare, annars blir matchning och felsökning rörig.
 </div>

 <PortalScopePanel />

 <CoverageDashboard evaluations={evaluations} definitions={coreDefinitions} archivedCount={archivedRuns.length} />
 <Batch5RunbookPanel />

 <div className="mt-5 grid gap-4 xl:grid-cols-2">
 <div>
 <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
 <h3 className="text-sm font-semibold text-slate-950">Testfall i grupper</h3>
 <Badge tone="emerald">dropdown-läge</Badge>
 </div>
 <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
 Öppna bara gruppen du arbetar med. S1.2-testen använder kundstyrd PRODAT ovan, medan S1.3 och framåt körs via TGT guided mode och generatorn när filsteget ägs av GridCore.
 </div>
 <GroupedTestCasePanel
 groups={groupedProdatDefinitions}
 evaluations={evaluations}
 activeRunsForCase={activeRunsForCase}
 dynamicTestDataMap={dynamicTestDataMap}
 />
 </div>

 <div>
 <h3 className="mb-3 text-sm font-semibold text-slate-950">Aktiva TGT-runs</h3>
 <div className="space-y-4">
 {evaluations.length === 0 ? (
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-700">
 Inga aktiva TGT-runs. Skapa första via en mall till vänster.
 </div>
 ) : (
 evaluations.map((evaluation) => (
 <RunEvaluationCard key={evaluation.testRun.id} evaluation={evaluation} messages={messages} dynamicTestDataMap={dynamicTestDataMap} />
 ))
 )}
 </div>
 <ArchivedRunsPanel archivedRuns={archivedRuns} />
 </div>
 </div>
 </section>
 )
}