import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  cancelEdielMessageAction,
  createEdielPortalTestCustomerAction,
  prepareSwitchZ03Action,
  prepareSwitchZ04Action,
  prepareSwitchZ09Action,
  pollMailboxAction,
  sendEdielMessageAction,
  updateEdielPortalSwitchTestDataAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  getEdielTgtTestCases,
  type EdielTgtTestCaseDefinition,
} from '@/lib/ediel/tgtRegistry'
import type {
  EdielProdatCandidateIssue,
  EdielProdatProductionCandidate,
} from '@/lib/ediel/prodatContext'

type BadgeTone = 'slate' | 'green' | 'yellow' | 'red' | 'blue' | 'indigo'

type ProdatCatalogGroupConfig = {
  id: string
  title: string
  description: string
  tone: BadgeTone
  prefixes: string[]
}

type ProdatCatalogGroup = ProdatCatalogGroupConfig & {
  testCases: EdielTgtTestCaseDefinition[]
}

const PORTAL_FORM_CASE_CODES = new Set(['1.2.1', '1.2.2', '1.2.5', '2.5.1', '2.5.2', '2.5.3'])

const PRODAT_PORTAL_GROUPS: ProdatCatalogGroupConfig[] = [
  {
    id: 's1-2',
    title: 'S1.2 – Korrekt PRODAT för produktion och portaltest',
    description:
      'Positiva huvudtester för Z03/Z04. Dessa är kärnflödena för leverantörsbyte och mikroproduktion.',
    tone: 'green',
    prefixes: ['1.2'],
  },
  {
    id: 's1-3',
    title: 'S1.3 – Negativ APERAK för Z03',
    description:
      'Fångar affärsfel i Z03, till exempel fel anläggnings-id, nätområdes-id, transaktionstyp eller datum.',
    tone: 'red',
    prefixes: ['1.3'],
  },
  {
    id: 's1-4',
    title: 'S1.4 – Negativ APERAK för Z04',
    description:
      'Verifierar att Z04-fel fångas korrekt, till exempel saknade referenser eller felaktiga uppgifter.',
    tone: 'red',
    prefixes: ['1.4'],
  },
  {
    id: 's1-5',
    title: 'S1.5 – Syntaxfel / negativ CONTRL',
    description:
      'Används för att verifiera att syntaxfel ger negativ CONTRL i stället för APERAK.',
    tone: 'yellow',
    prefixes: ['1.5'],
  },
  {
    id: 's2-1',
    title: 'S2.1 – Korrekt PRODAT för Z06',
    description:
      'Ändringar av avräkningsmetod, mätmetod, räkneverkstyp och adressuppgifter.',
    tone: 'blue',
    prefixes: ['2.1'],
  },
  {
    id: 's2-2',
    title: 'S2.2 – Felaktigt PRODAT för Z06',
    description:
      'Negativa Z06-varianter med felaktigt anläggnings-id eller ofullständig mätarinformation.',
    tone: 'red',
    prefixes: ['2.2'],
  },
  {
    id: 's2-3',
    title: 'S2.3 – Korrekt PRODAT för Z10',
    description:
      'Positiva testfall för mätarbyte.',
    tone: 'blue',
    prefixes: ['2.3'],
  },
  {
    id: 's2-4',
    title: 'S2.4 – Felaktigt PRODAT för Z10',
    description:
      'Negativa testfall för mätarbyte, till exempel saknad konstant.',
    tone: 'red',
    prefixes: ['2.4'],
  },
  {
    id: 's2-5',
    title: 'S2.5 – Korrekt PRODAT för Z09',
    description:
      'Korrekta testfall för Z09, inklusive mikroproduktionsavtal.',
    tone: 'blue',
    prefixes: ['2.5'],
  },
  {
    id: 's3-1',
    title: 'S3.1 – Korrekt PRODAT för Z05',
    description:
      'Positiva testfall för Z05L och Z05LK.',
    tone: 'blue',
    prefixes: ['3.1'],
  },
  {
    id: 's3-2',
    title: 'S3.2 – Negativ APERAK för Z05',
    description:
      'Verifierar att Z05 med felaktigt anläggnings-id avvisas korrekt.',
    tone: 'red',
    prefixes: ['3.2'],
  },
]

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
  const classes = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    yellow: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-rose-200 bg-rose-50 text-rose-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  }[tone]

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  )
}

function SmtpModeNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-800'
          : 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800'
      }
    >
      TGT/systemtest skickas okrypterat som application/EDIFACT base64
    </div>
  )
}

function issueTone(issue: EdielProdatCandidateIssue): BadgeTone {
  if (issue.severity === 'error') return 'red'
  if (issue.severity === 'warning') return 'yellow'
  return 'blue'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function compareTestCaseCodes(a: string, b: string): number {
  return a.localeCompare(b, 'sv-SE', { numeric: true, sensitivity: 'base' })
}

function isProdatSupplierCoreCase(testCase: EdielTgtTestCaseDefinition): boolean {
  return (
    testCase.suite === 'PRODAT' &&
    testCase.roleCode === 'supplier' &&
    testCase.scope === 'core'
  )
}

function matchesPrefix(code: string, prefix: string): boolean {
  return code === prefix || code.startsWith(`${prefix}.`)
}

function getProdatCatalogGroups(): ProdatCatalogGroup[] {
  const allCases = getEdielTgtTestCases()
    .filter(isProdatSupplierCoreCase)
    .sort((a, b) => compareTestCaseCodes(a.testCaseCode, b.testCaseCode))

  return PRODAT_PORTAL_GROUPS.map((group) => ({
    ...group,
    testCases: allCases.filter((testCase) =>
      group.prefixes.some((prefix) => matchesPrefix(testCase.testCaseCode, prefix))
    ),
  })).filter((group) => group.testCases.length > 0)
}

function candidateMessageCount(
  messages: EdielMessageRow[],
  candidate: EdielProdatProductionCandidate,
  code: 'Z03' | 'Z04'
) {
  return messages.filter(
    (message) =>
      message.switch_request_id === candidate.switchRequestId &&
      message.message_family === 'PRODAT' &&
      message.message_code === code &&
      message.status !== 'cancelled'
  ).length
}

function candidatePreparedMessages(
  messages: EdielMessageRow[],
  candidate: EdielProdatProductionCandidate
) {
  return messages.filter(
    (message) =>
      message.switch_request_id === candidate.switchRequestId &&
      message.message_family === 'PRODAT' &&
      message.status !== 'cancelled'
  )
}

function Field({
  label,
  value,
}: {
  label: string
  value: string | number | null | undefined
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-xs font-semibold text-slate-900">
        {value ?? '—'}
      </div>
    </div>
  )
}

function FormInput({
  name,
  label,
  required = false,
  placeholder,
  defaultValue,
  type = 'text',
}: {
  name: string
  label: string
  required?: boolean
  placeholder?: string
  defaultValue?: string
  type?: string
}) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        type={type}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950 placeholder:text-slate-400"
      />
    </label>
  )
}

function FormSelect({
  name,
  label,
  children,
  defaultValue,
  required = false,
}: {
  name: string
  label: string
  children: ReactNode
  defaultValue?: string
  required?: boolean
}) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950"
      >
        {children}
      </select>
    </label>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-950">{title}</div>
      {description ? <p className="mt-1 text-[11px] text-slate-500">{description}</p> : null}
      <div className="mt-3 grid gap-2 md:grid-cols-2">{children}</div>
    </div>
  )
}

function PortalTestCatalogPanel() {
  const groups = getProdatCatalogGroups()
  const totalCases = groups.reduce((sum, group) => sum + group.testCases.length, 0)
  const formCases = groups.reduce(
    (sum, group) =>
      sum +
      group.testCases.filter((testCase) => PORTAL_FORM_CASE_CODES.has(testCase.testCaseCode)).length,
    0
  )
  const guidedCases = totalCases - formCases

  return (
    <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 open:ring-2 open:ring-slate-100">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Testkatalog för portaltest och kommande coverage
            </h3>
            <p className="mt-1 max-w-4xl text-xs text-slate-600">
              Här visas alla PRODAT-tester ni bör kunna köra, men i kompakt dropdown-format så
              sidan inte blir lång. 1.2.x och 2.5.x öppnas som riktiga kundformulär här nedan. Z09-testen är
              outbound aktör→portal: GridCore skapar och skickar PRODAT Z09, och portalen
              svarar med CONTRL och APERAK.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">{groups.length} grupper</Badge>
            <Badge tone="green">{formCases} formulärtest</Badge>
            <Badge tone="indigo">{guidedCases} TGT-test</Badge>
            <Badge tone="slate">{totalCases} totalt</Badge>
          </div>
        </div>
      </summary>

      <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-900">
        <div className="font-semibold">Arbetssätt</div>
        <p className="mt-1">
          <strong>Formulär här nedan</strong> används för verklig kund-/switchuppsättning i era
          riktiga tabeller. För Z09 betyder det: skapa testkund/ärende, klicka
          <strong> Skapa Z09-utkast</strong> och skicka PRODAT från GridCore till portalen.
          <strong> TGT guided mode</strong> används för övriga testfall som checklista,
          run-hantering och vidare testcoverage.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {groups.map((group) => (
          <details
            key={group.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm open:ring-2 open:ring-slate-100"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={group.tone}>{group.title}</Badge>
                    <Badge tone="slate">{group.testCases.length} testfall</Badge>
                    <Badge tone="green">
                      {
                        group.testCases.filter((testCase) =>
                          PORTAL_FORM_CASE_CODES.has(testCase.testCaseCode)
                        ).length
                      }{' '}
                      formulär
                    </Badge>
                    <Badge tone="indigo">
                      {
                        group.testCases.filter(
                          (testCase) => !PORTAL_FORM_CASE_CODES.has(testCase.testCaseCode)
                        ).length
                      }{' '}
                      TGT
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-600">{group.description}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                  Öppna grupp
                </div>
              </div>
            </summary>

            <div className="mt-4 space-y-3">
              {group.testCases.map((testCase) => {
                const usesForm = PORTAL_FORM_CASE_CODES.has(testCase.testCaseCode)

                return (
                  <div
                    key={`${testCase.suite}-${testCase.roleCode}-${testCase.testCaseCode}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="blue">{testCase.testCaseCode}</Badge>
                          <Badge>{testCase.suite}</Badge>
                          <Badge tone={usesForm ? 'green' : 'indigo'}>
                            {usesForm ? 'formulär här nedan' : 'TGT guided mode'}
                          </Badge>
                          <Badge tone={testCase.status === 'ready_for_file_engine' ? 'green' : 'yellow'}>
                            {testCase.status === 'ready_for_file_engine'
                              ? 'redo i filmotor'
                              : 'manuell senare'}
                          </Badge>
                        </div>

                        <div className="mt-3 text-sm font-semibold text-slate-950">
                          {testCase.title}
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{testCase.testDataHint}</p>
                        <p className="mt-2 text-[11px] text-slate-500">
                          {testCase.purpose}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                        {usesForm ? 'Öppnas nedan' : 'Kör via TGT'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

function EdielPortalTestCustomerOnboardingPanel() {
  const testCases = getEdielTgtTestCases()
    .filter(
      (testCase) =>
        isProdatSupplierCoreCase(testCase) &&
        PORTAL_FORM_CASE_CODES.has(testCase.testCaseCode)
    )
    .sort((a, b) => compareTestCaseCodes(a.testCaseCode, b.testCaseCode))

  return (
    <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-indigo-950">
            Skapa Edielportal-testkund som riktig kund
          </h3>
          <p className="mt-1 max-w-4xl text-xs text-indigo-800">
            Här fyller du in kunduppgifterna från Edielportalen manuellt. Testdataregistret kan
            hjälpa senare, men formuläret är källan till sanningen. När kunden skapas hamnar kund,
            fakturamottagare, anläggning, mätpunkt, route, fullmakt och switchärende i era riktiga
            tabeller.
          </p>
        </div>
        <Badge tone="indigo">formulär → riktig kunddata · testläge</Badge>
      </div>

      <div className="mt-4 space-y-4">
        {testCases.map((testCase) => (
          <details
            key={`${testCase.suite}-${testCase.roleCode}-${testCase.testCaseCode}`}
            className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm open:ring-2 open:ring-indigo-100"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="blue">{testCase.testCaseCode}</Badge>
                    <Badge>{testCase.suite}</Badge>
                    <Badge tone="indigo">öppna formulär</Badge>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-950">
                    {testCase.title}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{testCase.testDataHint}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                  Fyll kunddata
                </div>
              </div>
            </summary>

            <form action={createEdielPortalTestCustomerAction} className="mt-4 space-y-4">
              <input type="hidden" name="testSuite" value={testCase.suite} />
              <input type="hidden" name="roleCode" value={testCase.roleCode} />
              <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />

              <FormSection
                title="1. Kund"
                description="Detta blir riktig kund i customers. För Edielportalens test använder du testkundens personnummer/kund-id från portalen."
              >
                <FormInput
                  name="customerFirstName"
                  label="Förnamn"
                  required
                  placeholder="Ex. MARGIT"
                />
                <FormInput
                  name="customerLastName"
                  label="Efternamn"
                  required
                  placeholder="Ex. PAULSSON"
                />
                <FormInput
                  name="customerPersonalNumber"
                  label="Personnummer / kund-id"
                  required
                  placeholder="Ex. 194507018820 eller 5560143041"
                />
                <FormSelect name="customerIdCodeListQualifier" label="Kund-id typ / DE 1131">
                  <option value="">Auto från testfall/personnummer</option>
                  <option value="SE2">Personnummer = SE2</option>
                  <option value="SE1">Organisationsnummer = SE1</option>
                  <option value="1">Födelsedatum = 1</option>
                </FormSelect>
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 md:col-span-2">
                  För 1.2.1 Z03L med personnummer används normalt SE2. För 1.2.2 Z03LK med
                  organisationsnummer 5560143041 ska kund-id typ vara SE1.
                </div>
                <FormInput
                  name="customerBirthDate"
                  label="Födelsedatum"
                  placeholder="YYYYMMDD, ex. 19450501"
                />
                <FormInput
                  name="customerEmail"
                  label="E-post (krävs om telefon saknas)"
                  type="email"
                  placeholder="Ex. testkund.com"
                />
                <FormInput
                  name="customerPhone"
                  label="Telefonnummer (krävs om e-post saknas)"
                  placeholder="Ex. 0700000000"
                />
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-2">
                  Minst en kontaktuppgift krävs eftersom outbound-valideringen stoppar PRODAT om
                  både kundens e-post och telefon saknas.
                </div>
                <FormInput
                  name="customerAddress"
                  label="Kundadress"
                  placeholder="Ex. STORA VÄGEN 25"
                />
                <FormInput
                  name="customerPostalCode"
                  label="Postnummer kund"
                  placeholder="Ex. 62020"
                />
                <FormInput
                  name="customerCity"
                  label="Postort kund"
                  placeholder="Ex. KLINTEHAMN"
                />
                <FormInput
                  name="customerCountry"
                  label="Land kund"
                  defaultValue="SE"
                  placeholder="SE"
                />
              </FormSection>

              <FormSection
                title="2. Fakturamottagare / ombud"
                description="Fyll bara om portalen/testkunden har separat fakturamottagare. Lämna annars tomt."
              >
                <FormInput
                  name="billingRecipientId"
                  label="Fakturamottagare-id"
                  placeholder="Ex. 10011"
                />
                <FormInput
                  name="billingRecipientName"
                  label="Namn fakturamottagare"
                  placeholder="Ex. CONNY PAULSSON"
                />
                <FormInput
                  name="billingRecipientEmail"
                  label="E-post fakturamottagare"
                  type="email"
                  placeholder="Valfritt"
                />
                <FormInput
                  name="billingRecipientPhone"
                  label="Telefon fakturamottagare"
                  placeholder="Valfritt"
                />
                <FormInput
                  name="billingRecipientAddress"
                  label="Fakturaadress"
                  placeholder="Ex. ÅGATAN 145"
                />
                <FormInput
                  name="billingRecipientPostalCode"
                  label="Postnummer faktura"
                  placeholder="Ex. 11543"
                />
                <FormInput
                  name="billingRecipientCity"
                  label="Postort faktura"
                  placeholder="Ex. STOCKHOLM"
                />
                <FormInput
                  name="billingRecipientCountry"
                  label="Land faktura"
                  defaultValue="SE"
                  placeholder="SE"
                />
              </FormSection>

              <FormSection
                title="3. Anläggning och mätpunkt"
                description="Detta blir customer_sites och metering_points. Obligatoriskt för att PRODAT ska kunna skapas från riktig kunddata."
              >
                <FormInput
                  name="facilityId"
                  label="Anläggnings-ID / mätpunkt-ID"
                  required
                  placeholder="Ex. 735999888000000017"
                />
                <FormInput
                  name="gridAreaId"
                  label="Nätområdes-ID"
                  required
                  placeholder="Ex. TES"
                />
                <FormInput
                  name="siteAddress"
                  label="Anläggningsadress"
                  placeholder="Ex. VÄDERMYREN 1:22"
                />
                <FormInput
                  name="sitePostalCode"
                  label="Postnummer anläggning"
                  placeholder="Ex. 62020"
                />
                <FormInput
                  name="siteCity"
                  label="Postort anläggning"
                  placeholder="Ex. KLINTEHAMN"
                />
                <FormInput
                  name="siteCountry"
                  label="Land anläggning"
                  defaultValue="SE"
                  placeholder="SE"
                />
                <FormInput
                  name="meteringMethod"
                  label="Mätmetod"
                  placeholder="Ex. Z01"
                />
                <FormInput
                  name="meterNumber"
                  label="Mätarnummer"
                  placeholder="Ex. M12345"
                />
                <FormInput
                  name="annualEnergyKwh"
                  label="Uppskattad årsenergi"
                  placeholder="Ex. 5800"
                />
                <FormInput
                  name="annualEnergyUnit"
                  label="Enhet årsenergi"
                  defaultValue="KWH"
                  placeholder="KWH"
                />
                <FormInput
                  name="reportingFrequency"
                  label="Rapporteringsfrekvens"
                  placeholder="Ex. M"
                />
                <FormInput name="priority" label="Prioritet" placeholder="Ex. A" />
              </FormSection>

              <FormSection
                title="4. Avtal, fullmakt och Ediel-styrning"
                description="Dessa fält krävs för att switchärendet ska bli redo och för att rätt referenser ska hamna i PRODAT."
              >
                <FormInput
                  name="agreementStartDateTime"
                  label="Avtalsstart från portalen"
                  required
                  placeholder="YYYYMMDDHHMM, ex. 202605150000"
                />
                <FormSelect name="reasonForTransaction" label="Transaktionstyp / fält 223">
                  <option value="">Auto från testfall</option>
                  <option value="Z22">L = leverantörsbyte = Z22</option>
                  <option value="Z23">LK = leverantörs- och kundbyte = Z23</option>
                  <option value="E64">Z09F = E64</option>
                  <option value="E32">Z09G = E32</option>
                  <option value="Z70">Z09D = Z70</option>
                  <option value="E64">Z09F = avtal om 15-minutersvärden = E64</option>
                  <option value="E32">Z09G = avtal om 15-minutersvärden upphör = E32</option>
                  <option value="Z70">Z09D = nytt avtal om mikroproduktion = Z70</option>
                </FormSelect>
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 md:col-span-2">
                  Välj L/Z22 för vanligt leverantörsbyte, t.ex. 1.2.1 Z03L. Välj LK/Z23 för
                  leverantörs- och kundbyte, t.ex. 1.2.2 Z03LK. För Z09-testerna används
                  E64 = Z09F, E32 = Z09G och Z70 = Z09D.
                </div>
                <FormSelect
                  name="powerOfAttorneyStatus"
                  label="Fullmaktstatus"
                  defaultValue="signed"
                >
                  <option value="signed">Signerad - får användas för Ediel</option>
                  <option value="draft">Utkast - spärrar Ediel</option>
                  <option value="sent">Skickad - spärrar Ediel tills signerad</option>
                  <option value="expired">Utgången - spärrar Ediel</option>
                  <option value="revoked">Återkallad - spärrar Ediel</option>
                </FormSelect>
                <FormInput
                  name="powerOfAttorneyReference"
                  label="Avtals-/fullmaktsreferens"
                  required
                  placeholder="Ex. AVTAL01"
                />
                <FormInput
                  name="balanceResponsibleId"
                  label="Balansansvarig"
                  placeholder="Ex. 91109"
                />
                <FormSelect name="priceAreaCode" label="Prisområde">
                  <option value="">Ej satt</option>
                  <option value="SE1">SE1</option>
                  <option value="SE2">SE2</option>
                  <option value="SE3">SE3</option>
                  <option value="SE4">SE4</option>
                </FormSelect>
                <FormInput
                  name="productCode"
                  label="Produktkod"
                  placeholder="Ex. L917"
                />
                <FormInput
                  name="settlementMethod"
                  label="Avräkningsmetod"
                  placeholder="Ex. Z31"
                />
                <FormInput
                  name="installationStatus"
                  label="Installationsstatus"
                  placeholder="Ex. Z12"
                />
                <FormInput name="tariffCode" label="Tariffkod" placeholder="Ex. 25A" />
              </FormSection>

              <FormSection
                title="5. Register och mätarvärden"
                description="För 1.2.5 Z04D fyller du båda registren. För enklare Z03-test räcker register 1 eller årsenergi ovan."
              >
                <FormInput
                  name="register1AnnualEnergyKwh"
                  label="Register 1 · årsenergi"
                  placeholder="Ex. 5800"
                />
                <FormInput
                  name="register1MeterConstant"
                  label="Register 1 · mätarkonstant"
                  placeholder="Ex. 1"
                />
                <FormInput
                  name="register1MeterDigits"
                  label="Register 1 · antal siffror"
                  placeholder="Ex. 6"
                />
                <FormInput
                  name="register1MeterTimeInterval"
                  label="Register 1 · tidsintervall"
                  placeholder="Ex. 201"
                />
                <FormInput
                  name="register1Resolution"
                  label="Register 1 · upplösning"
                  placeholder="Ex. 1"
                />
                <FormInput
                  name="register2AnnualEnergyKwh"
                  label="Register 2 · årsenergi"
                  placeholder="Ex. 2800"
                />
                <FormInput
                  name="register2MeterConstant"
                  label="Register 2 · mätarkonstant"
                  placeholder="Ex. 1"
                />
                <FormInput
                  name="register2MeterDigits"
                  label="Register 2 · antal siffror"
                  placeholder="Ex. 6"
                />
                <FormInput
                  name="register2MeterTimeInterval"
                  label="Register 2 · tidsintervall"
                  placeholder="Ex. 202"
                />
                <FormInput
                  name="register2Resolution"
                  label="Register 2 · upplösning"
                  placeholder="Ex. 1"
                />
              </FormSection>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Kontrollera uppgifterna innan du skapar. Om du har valt fel kund senare ska ej
                skickade utkast avbrytas/arkiveras, inte hårdraderas. Skickade meddelanden ska
                alltid ligga kvar för spårbarhet.
              </div>

              <button className="w-full rounded-xl bg-indigo-700 px-3 py-3 text-xs font-semibold text-white hover:bg-indigo-800">
                Skapa testkund + switchärende
              </button>
            </form>
          </details>
        ))}
      </div>
    </div>
  )
}

function ProductionCandidateCard({
  candidate,
  messages,
}: {
  candidate: EdielProdatProductionCandidate
  messages: EdielMessageRow[]
}) {
  const z03Count = candidateMessageCount(messages, candidate, 'Z03')
  const z04Count = candidateMessageCount(messages, candidate, 'Z04')
  const preparedMessages = candidatePreparedMessages(messages, candidate)
  const blockingIssues = candidate.issues.filter((issue) => issue.severity === 'error')
  const warningIssues = candidate.issues.filter((issue) => issue.severity !== 'error')

  return (
    <details className="rounded-2xl border border-slate-200 bg-white shadow-sm open:ring-2 open:ring-emerald-100">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={candidate.readyForPortalOrProduction ? 'green' : 'red'}>
                {candidate.readyForPortalOrProduction ? 'redo för Ediel-utkast' : 'spärrad'}
              </Badge>
              <Badge>{candidate.requestType}</Badge>
              <Badge tone="blue">{candidate.switchStatus}</Badge>
              {z03Count > 0 ? (
                <Badge tone="yellow">Z03 finns: {z03Count}</Badge>
              ) : (
                <Badge tone="slate">ingen Z03</Badge>
              )}
              {z04Count > 0 ? (
                <Badge tone="yellow">Z04 finns: {z04Count}</Badge>
              ) : (
                <Badge tone="slate">ingen Z04</Badge>
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-slate-950">
              {candidate.customerLabel}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              {candidate.siteLabel} · Anläggning {candidate.facilityId ?? 'saknas'} · Mätpunkt{' '}
              {candidate.meteringPointId ?? 'saknas'}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>Startdatum</div>
            <div className="mt-1 font-semibold text-slate-900">
              {formatDate(candidate.requestedStartDate)}
            </div>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-100 p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Kund-ID/person/org" value={candidate.customerIdentifier} />
          <Field label="E-post" value={candidate.customerEmail} />
          <Field label="Telefon" value={candidate.customerPhone} />
          <Field label="Anläggningsadress" value={candidate.siteAddress} />
          <Field
            label="Årsförbrukning"
            value={
              candidate.annualConsumptionKwh
                ? `${candidate.annualConsumptionKwh} kWh`
                : null
            }
          />
          <Field label="Nätägare" value={candidate.gridOwnerName} />
          <Field label="Nätägarens Ediel-ID" value={candidate.gridOwnerEdielId} />
          <Field label="Route" value={candidate.communicationRouteName} />
          <Field label="Route-typ" value={candidate.communicationRouteType} />
          <Field label="Fullmakt" value={candidate.powerOfAttorneyStatus} />
          <Field label="Fullmaktsreferens" value={candidate.powerOfAttorneyReference} />
          <Field label="Mätmetod/typ" value={candidate.meteringMethod} />
          <Field label="Rapporteringsfrekvens" value={candidate.readingFrequency} />
        </div>

        {blockingIssues.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold text-rose-950">Spärr innan skickning</div>
            <div className="mt-2 space-y-2">
              {blockingIssues.map((issue) => (
                <div
                  key={issue.code}
                  className="rounded-xl border border-rose-100 bg-white px-3 py-2 text-xs text-rose-800"
                >
                  <div className="font-semibold">{issue.title}</div>
                  <div className="mt-1">{issue.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <div className="font-semibold">Portal-ready check godkänd</div>
            <p className="mt-1">
              Kund, person/orgnummer, anläggning, mätpunkt, nätägare, route, startdatum och
              fullmakt finns. Systemet tillåter filutkast.
            </p>
          </div>
        )}

        {warningIssues.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {warningIssues.map((issue) => (
              <Badge key={issue.code} tone={issueTone(issue)}>
                {issue.title}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <form
            action={updateEdielPortalSwitchTestDataAction}
            className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-3"
          >
            <input type="hidden" name="switchRequestId" value={candidate.switchRequestId} />
            <div className="text-xs font-semibold text-indigo-950">
              Justera Edielportal-testdata för detta ärende
            </div>
            <p className="mt-1 text-[11px] leading-5 text-indigo-800">
              Använd detta när portalen säger att testdata inte matchar, utan att behöva skapa om
              kund/anläggning. När du sparar avbryts gamla oskickade PRODAT-utkast automatiskt.
              Skapa sedan nytt PRODAT-utkast.
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <label className="block text-xs font-semibold text-slate-700">
                Mätmetod / fält 217
                <select
                  name="meteringMethod"
                  defaultValue={candidate.portalMeteringMethod ?? ''}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950"
                >
                  <option value="">Behåll</option>
                  <option value="Z01">Z01</option>
                  <option value="Z02">Z02</option>
                  <option value="Z03">Z03</option>
                  <option value="Z04">Z04 — kvart/15 min</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Transaktionstyp / fält 223
                <select
                  name="reasonForTransaction"
                  defaultValue={candidate.portalReasonForTransaction ?? ''}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950"
                >
                  <option value="">Behåll</option>
                  <option value="Z22">L = leverantörsbyte = Z22</option>
                  <option value="Z23">LK = leverantörs- och kundbyte = Z23</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Kund-id typ / DE 1131
                <select
                  name="customerIdCodeListQualifier"
                  defaultValue={candidate.portalCustomerIdCodeListQualifier ?? ''}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950"
                >
                  <option value="">Behåll</option>
                  <option value="SE1">Organisationsnummer = SE1</option>
                  <option value="SE2">Personnummer = SE2</option>
                  <option value="1">Födelsedatum = 1</option>
                </select>
              </label>
              <FormInput
                name="customerName"
                label="Namn exakt enligt portalen"
                defaultValue={candidate.customerLabel}
                placeholder="Ex. BOLAGET XXX"
              />
            </div>
            <div className="mt-3 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-[11px] leading-5 text-indigo-900">
              För 1.2.2 Z03LK ska du normalt ha: <strong>Z04</strong>, <strong>Z23</strong> och{' '}
              <strong>SE1</strong>. Raw PRODAT ska då innehålla{' '}
              <code>CCI++Z04&apos; CAV+Z04&apos;</code>, <code>CAV+Z23&apos;</code> och{' '}
              <code>NAD+UD+5560143041:SE1:260</code>.
            </div>
            <button className="mt-3 rounded-xl bg-indigo-700 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-800">
              Spara testdata på ärendet
            </button>
          </form>

          <form action={prepareSwitchZ03Action}>
            <input type="hidden" name="switchRequestId" value={candidate.switchRequestId} />
            <input type="hidden" name="environment" value="test" />
            <input type="hidden" name="forceRegenerate" value="true" />
            {candidate.communicationRouteId ? (
              <input
                type="hidden"
                name="communicationRouteId"
                value={candidate.communicationRouteId}
              />
            ) : null}
            <button
              disabled={!candidate.canCreateZ03}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Skapa Z03-utkast
            </button>
          </form>

          <form action={prepareSwitchZ04Action}>
            <input type="hidden" name="switchRequestId" value={candidate.switchRequestId} />
            <input type="hidden" name="environment" value="test" />
            <input type="hidden" name="forceRegenerate" value="true" />
            {candidate.communicationRouteId ? (
              <input
                type="hidden"
                name="communicationRouteId"
                value={candidate.communicationRouteId}
              />
            ) : null}
            <button
              disabled={!candidate.canCreateZ04}
              className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              Skapa Z04-utkast
            </button>
          </form>

          <form action={prepareSwitchZ09Action}>
            <input type="hidden" name="switchRequestId" value={candidate.switchRequestId} />
            <input type="hidden" name="environment" value="test" />
            <input type="hidden" name="forceRegenerate" value="true" />
            {candidate.communicationRouteId ? (
              <input
                type="hidden"
                name="communicationRouteId"
                value={candidate.communicationRouteId}
              />
            ) : null}
            <button
              disabled={!candidate.readyForPortalOrProduction}
              className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
            >
              Skapa Z09-utkast
            </button>
          </form>

          {candidate.communicationRouteId ? (
            <form action={pollMailboxAction}>
              <input type="hidden" name="communicationRouteId" value={candidate.communicationRouteId} />
              <input type="hidden" name="limit" value="10" />
              <button className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100">
                Hämta svar från IMAP
              </button>
            </form>
          ) : null}

          {candidate.customerId ? (
            <Link
              href={`/admin/customers/${candidate.customerId}`}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Öppna kundkort
            </Link>
          ) : null}

          <Link
            href="/admin/operations/switches"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Öppna switchlista
          </Link>
        </div>

        {preparedMessages.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-900">
              Skapade utkast/meddelanden för detta ärende
            </div>
            <div className="mt-2 space-y-2">
              {preparedMessages.slice(0, 6).map((message) => (
                <div
                  key={message.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900">
                      {message.message_family}/{message.message_code}
                    </span>
                    <span className="ml-2 text-slate-500">
                      {message.status} · {message.external_reference ?? 'utan extern ref'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/ediel/messages/${message.id}`}
                      className="font-semibold text-indigo-700 hover:underline"
                    >
                      Öppna
                    </Link>

                    {['draft', 'queued', 'prepared', 'failed'].includes(message.status) ? (
                      <form
                        action={sendEdielMessageAction}
                        className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2"
                      >
                        <input type="hidden" name="edielMessageId" value={message.id} />
                        <SmtpModeNotice compact />
                        <button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
                          Skicka EDIFACT base64
                        </button>
                      </form>
                    ) : null}

                    {['draft', 'queued', 'prepared', 'failed'].includes(message.status) ? (
                      <form action={cancelEdielMessageAction}>
                        <input type="hidden" name="edielMessageId" value={message.id} />
                        <input
                          type="hidden"
                          name="reason"
                          value="Avbrutet från kundstyrd Ediel-panel. Fel kund/underlag eller nytt utkast ska skapas. Historik behålls."
                        />
                        <button className="font-semibold text-rose-700 hover:underline">
                          Avbryt utkast
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  )
}

export default function EdielProductionProdatPanel({
  candidates,
  messages,
}: {
  candidates: EdielProdatProductionCandidate[]
  messages: EdielMessageRow[]
}) {
  const ready = candidates.filter((candidate) => candidate.readyForPortalOrProduction).length
  const blocked = candidates.length - ready

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Kundstyrd PRODAT för produktion och portaltest
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            Välj ett riktigt switchärende. Systemet kontrollerar kund, anläggning, mätpunkt,
            nätägare, route, startdatum och fullmakt innan Z03/Z04 får skapas. Felaktiga utkast
            avbryts utan att historiken raderas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">redo: {ready}</Badge>
          <Badge tone={blocked > 0 ? 'red' : 'green'}>spärrade: {blocked}</Badge>
          <Badge tone="blue">kandidater: {candidates.length}</Badge>
        </div>
      </div>

      <PortalTestCatalogPanel />
      <EdielPortalTestCustomerOnboardingPanel />

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-semibold">1. Välj kundunderlag</div>
          <p className="mt-1">
            Utgå från ett switchärende så kund, avtal, anläggning och mätpunkt hänger ihop.
          </p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <div className="font-semibold">2. Kontrollera spärrar</div>
          <p className="mt-1">
            Saknas personnummer, kontaktuppgift, fullmakt, route eller mätpunkt blockeras
            filskapande direkt.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="font-semibold">3. Skapa utkast</div>
          <p className="mt-1">
            Utkastet sparas som Ediel-meddelande. Skickade meddelanden raderas aldrig; fel hanteras
            via avbruten status och auditspår.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {candidates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Inga switchärenden hittades. Skapa kund, anläggning, mätpunkt, fullmakt och
            switchärende först.
          </div>
        ) : (
          candidates.map((candidate) => (
            <ProductionCandidateCard
              key={candidate.switchRequestId}
              candidate={candidate}
              messages={messages}
            />
          ))
        )}
      </div>
    </section>
  )
}