import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
  EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE,
  EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  EDIEL_TGT_TESTSYSTEM_EMAIL,
  GRIDEX_TGT_EDIEL_ID,
} from '@/lib/ediel/fileEngine'
import { getEdielTgtTestDataForCase } from '@/lib/ediel/tgtTestData'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

type AnyRow = Record<string, unknown>

type PortalRegister = {
  label: string
  annualEnergyKwh: number | null
  meterConstant: string | null
  meterDigits: string | null
  meterTimeInterval: string | null
  resolution: string | null
}

export type CreateEdielPortalTestCustomerInput = {
  actorUserId: string
  companyId: string
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  agreementStartDateTime?: string | null
  powerOfAttorneyReference?: string | null
  powerOfAttorneyStatus?: 'draft' | 'sent' | 'signed' | 'expired' | 'revoked' | null
  balanceResponsibleId?: string | null
  priceAreaCode?: string | null
  customerFirstName?: string | null
  customerLastName?: string | null
  customerName?: string | null
  customerPersonalNumber?: string | null
  customerIdCodeListQualifier?: string | null
  reasonForTransaction?: string | null
  customerBirthDate?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerPostalCode?: string | null
  customerCity?: string | null
  customerCountry?: string | null
  billingRecipientId?: string | null
  billingRecipientName?: string | null
  billingRecipientAddress?: string | null
  billingRecipientPostalCode?: string | null
  billingRecipientCity?: string | null
  billingRecipientCountry?: string | null
  billingRecipientEmail?: string | null
  billingRecipientPhone?: string | null
  facilityId?: string | null
  siteAddress?: string | null
  sitePostalCode?: string | null
  siteCity?: string | null
  siteCountry?: string | null
  gridAreaId?: string | null
  annualEnergyKwh?: string | null
  annualEnergyUnit?: string | null
  meteringMethod?: string | null
  reportingFrequency?: string | null
  meterNumber?: string | null
  productCode?: string | null
  settlementMethod?: string | null
  installationStatus?: string | null
  tariffCode?: string | null
  priority?: string | null
  register1AnnualEnergyKwh?: string | null
  register1MeterConstant?: string | null
  register1MeterDigits?: string | null
  register1MeterTimeInterval?: string | null
  register1Resolution?: string | null
  register2AnnualEnergyKwh?: string | null
  register2MeterConstant?: string | null
  register2MeterDigits?: string | null
  register2MeterTimeInterval?: string | null
  register2Resolution?: string | null
}

export type CreateEdielPortalTestCustomerResult = {
  customerId: string
  siteId: string
  meteringPointId: string
  gridOwnerId: string
  communicationRouteId: string
  powerOfAttorneyId: string
  switchRequestId: string
  reusedExistingSwitch: boolean
}

type PortalTestCustomerData = {
  testLabel: string
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  customerId: string
  customerIdCodeListQualifier: string
  reasonForTransaction: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  birthDate: string | null
  customerAddress: string | null
  customerPostalCode: string | null
  customerCity: string | null
  customerCountry: string | null
  billingRecipientId: string | null
  billingRecipientName: string | null
  billingRecipientAddress: string | null
  billingRecipientPostalCode: string | null
  billingRecipientCity: string | null
  billingRecipientCountry: string | null
  billingRecipientEmail: string | null
  billingRecipientPhone: string | null
  facilityId: string
  siteAddress: string | null
  sitePostalCode: string | null
  siteCity: string | null
  siteCountry: string | null
  gridAreaId: string
  agreementStartDate: string
  agreementStartDateTime: string
  annualEnergyKwh: number | null
  annualEnergyUnit: string
  meteringMethod: string | null
  reportingFrequency: string | null
  meterNumber: string | null
  productCode: string | null
  settlementMethod: string | null
  installationStatus: string | null
  tariffCode: string | null
  priority: string | null
  balanceResponsibleId: string | null
  powerOfAttorneyReference: string
  powerOfAttorneyStatus: 'draft' | 'sent' | 'signed' | 'expired' | 'revoked'
  priceAreaCode: string | null
  registers: PortalRegister[]
}

type PortalTestCaseOverrides = {
  meteringMethod?: string
  reasonForTransaction?: string
  customerIdCodeListQualifier?: string
}

const PORTAL_TEST_CASE_OVERRIDES: Record<string, PortalTestCaseOverrides> = {
  // Bara fält som är bevisat testfallsspecifika ska ligga här. Mätmetod ska
  // normalt komma från portalens testdata/formuläret. Vi behåller Z03 för
  // 1.2.1 eftersom det testet redan är verifierat mot portalen, men vi
  // tvingar inte 1.2.2 till Z03; Z03LK testkund 20 kräver Z04.
  'PRODAT:supplier:1.2.1': {
    meteringMethod: 'Z03',
    reasonForTransaction: 'Z22',
    customerIdCodeListQualifier: 'SE2',
  },
  'PRODAT:supplier:1.2.2': {
    reasonForTransaction: 'Z23',
    customerIdCodeListQualifier: 'SE1',
  },
  'PRODAT:supplier:2.5.1': {
    meteringMethod: 'Z04',
    reasonForTransaction: 'E64',
  },
  'PRODAT:supplier:2.5.2': {
    meteringMethod: 'Z03',
    reasonForTransaction: 'E32',
  },
  'PRODAT:supplier:2.5.3': {
    reasonForTransaction: 'Z70',
  },
}

function portalTestCaseKey(input: Pick<CreateEdielPortalTestCustomerInput, 'testSuite' | 'roleCode' | 'testCaseCode'>): string {
  return [input.testSuite, input.roleCode, input.testCaseCode].join(':')
}

function getPortalTestCaseOverrides(input: Pick<CreateEdielPortalTestCustomerInput, 'testSuite' | 'roleCode' | 'testCaseCode'>): PortalTestCaseOverrides {
  return PORTAL_TEST_CASE_OVERRIDES[portalTestCaseKey(input)] ?? {}
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/^Fel\s+[^=]+=\s*/i, '')
    .trim() || null
}

function firstToken(value: unknown): string | null {
  const cleaned = clean(value)
  if (!cleaned) return null
  return cleaned.split(/\s+/)[0]?.trim() || null
}

function digits(value: unknown): string | null {
  const token = firstToken(value)
  if (!token) return null
  const only = token.replace(/\D/g, '')
  return only || null
}

function toNumber(value: unknown): number | null {
  const token = digits(value)
  if (!token) return null
  const parsed = Number(token)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeAgreementDateTime(value: string | null | undefined): string | null {
  const token = digits(value)
  if (!token || !/^\d{8,12}$/.test(token)) return null
  return token.length >= 12 ? token.slice(0, 12) : `${token.slice(0, 8)}0000`
}

function dateOnlyFromEdiel(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function getFieldValue(
  data: NonNullable<ReturnType<typeof getEdielTgtTestDataForCase>> | null,
  fieldCode: string,
  columnHints: string[] = []
): string | null {
  if (!data) return null

  const hints = columnHints.map((hint) => hint.toLowerCase())

  for (const group of data.groups) {
    const field = group.fields.find((candidate) => candidate.fieldCode === fieldCode)
    if (!field) continue

    const selectedColumns = hints.length > 0
      ? group.columns.filter((column) => hints.some((hint) => column.name.toLowerCase().includes(hint)))
      : group.columns

    for (const column of selectedColumns) {
      const value = clean(field.values[column.name])
      if (value) return value
    }

    for (const value of Object.values(field.values)) {
      const cleaned = clean(value)
      if (cleaned) return cleaned
    }
  }

  return null
}

function optionalNumber(value: string | null | undefined): number | null {
  return toNumber(value)
}

function valueOrTest(inputValue: unknown, testValue: unknown): string | null {
  return clean(inputValue) ?? clean(testValue)
}

function digitsOrTest(inputValue: unknown, testValue: unknown): string | null {
  return digits(inputValue) ?? digits(testValue)
}

function tokenOrTest(inputValue: unknown, testValue: unknown): string | null {
  return firstToken(inputValue) ?? firstToken(testValue)
}

function normalizeReasonForTransaction(value: unknown): string | null {
  const token = firstToken(value)?.toUpperCase()
  if (!token) return null
  if (token === 'L') return 'Z22'
  if (token === 'LK') return 'Z23'
  if (token === 'F' || token === 'Z09F') return 'E64'
  if (token === 'G' || token === 'Z09G') return 'E32'
  if (token === 'D' || token === 'Z09D') return 'Z70'
  if (['Z22', 'Z23', 'E64', 'E32', 'Z70'].includes(token)) return token
  return null
}

function normalizeCustomerIdCodeListQualifier(value: unknown): string | null {
  const token = firstToken(value)?.toUpperCase()
  if (!token) return null
  if (token === 'ORG' || token === 'ORGANISATIONSNUMMER') return 'SE1'
  if (token === 'PERSON' || token === 'PERSONNUMMER') return 'SE2'
  if (token === 'BIRTHDATE' || token === 'FODELSEDATUM' || token === 'FÖDELSEDATUM') return '1'
  if (token === 'SE1' || token === 'SE2' || token === '1') return token
  return null
}

function inferCustomerIdCodeListQualifier(customerId: string | null, birthDate: string | null): 'SE1' | 'SE2' | '1' {
  if (customerId && /^\d{10}$/.test(customerId)) return 'SE1'
  if (customerId && /^\d{12}$/.test(customerId)) return 'SE2'
  if (!customerId && birthDate && /^\d{8}$/.test(birthDate)) return '1'
  return 'SE2'
}

function normalizePowerOfAttorneyStatus(value: unknown): 'draft' | 'sent' | 'signed' | 'expired' | 'revoked' {
  const normalized = clean(value)?.toLowerCase()
  if (normalized === 'draft' || normalized === 'sent' || normalized === 'signed' || normalized === 'expired' || normalized === 'revoked') {
    return normalized
  }
  return 'signed'
}

function buildManualRegisters(input: CreateEdielPortalTestCustomerInput): PortalRegister[] {
  const registers: PortalRegister[] = []
  const candidates = [
    {
      label: 'register_1',
      annualEnergyKwh: input.register1AnnualEnergyKwh,
      meterConstant: input.register1MeterConstant,
      meterDigits: input.register1MeterDigits,
      meterTimeInterval: input.register1MeterTimeInterval,
      resolution: input.register1Resolution,
    },
    {
      label: 'register_2',
      annualEnergyKwh: input.register2AnnualEnergyKwh,
      meterConstant: input.register2MeterConstant,
      meterDigits: input.register2MeterDigits,
      meterTimeInterval: input.register2MeterTimeInterval,
      resolution: input.register2Resolution,
    },
  ]

  for (const candidate of candidates) {
    const annualEnergyKwh = optionalNumber(candidate.annualEnergyKwh)
    const meterConstant = firstToken(candidate.meterConstant)
    const meterDigits = firstToken(candidate.meterDigits)
    const meterTimeInterval = firstToken(candidate.meterTimeInterval)
    const resolution = firstToken(candidate.resolution)

    if (!annualEnergyKwh && !meterConstant && !meterDigits && !meterTimeInterval && !resolution) continue

    registers.push({
      label: candidate.label,
      annualEnergyKwh,
      meterConstant,
      meterDigits,
      meterTimeInterval,
      resolution,
    })
  }

  return registers
}


function buildRegisters(
  data: NonNullable<ReturnType<typeof getEdielTgtTestDataForCase>> | null
): PortalRegister[] {
  if (!data) return []
  const registers: PortalRegister[] = []

  for (const group of data.groups) {
    for (const column of group.columns) {
      const lowerName = column.name.toLowerCase()
      const isRegisterColumn = lowerName.includes('register') || lowerName.includes('z04')
      if (!isRegisterColumn) continue

      const byCode = (code: string) => {
        const field = group.fields.find((candidate) => candidate.fieldCode === code)
        return field ? clean(field.values[column.name]) : null
      }

      const annualEnergyKwh = toNumber(byCode('213'))
      const meterTimeInterval = firstToken(byCode('259'))
      const meterConstant = firstToken(byCode('214'))
      const meterDigits = firstToken(byCode('218'))
      const resolution = firstToken(byCode('508b')) ?? firstToken(byCode('508'))

      if (!annualEnergyKwh && !meterTimeInterval && !meterConstant && !meterDigits) continue

      registers.push({
        label: column.name,
        annualEnergyKwh,
        meterConstant,
        meterDigits,
        meterTimeInterval,
        resolution,
      })
    }
  }

  return registers.length > 0
    ? registers
    : [{ label: 'register_1', annualEnergyKwh: toNumber(getFieldValue(data, '213')), meterConstant: null, meterDigits: null, meterTimeInterval: null, resolution: null }]
}

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: fullName, lastName: null }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1] ?? null,
  }
}

function inferSiteType(testCaseCode: string): 'consumption' | 'mixed' {
  return testCaseCode === '1.2.5' || testCaseCode === '2.5.3' ? 'mixed' : 'consumption'
}

function inferMeasurementType(testCaseCode: string): 'consumption' | 'mixed' {
  return testCaseCode === '1.2.5' || testCaseCode === '2.5.3' ? 'mixed' : 'consumption'
}

function normalizeReadingFrequency(value: string | null): 'hourly' | 'daily' | 'monthly' | 'manual' {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'M') return 'monthly'
  if (normalized === 'D') return 'daily'
  if (normalized === 'H' || normalized === 'Q') return 'hourly'
  return 'manual'
}

function buildPortalTestData(input: CreateEdielPortalTestCustomerInput): PortalTestCustomerData {
  const testData = getEdielTgtTestDataForCase(input.testSuite, input.roleCode, input.testCaseCode)
  const testCaseOverrides = getPortalTestCaseOverrides(input)
  const agreementStartDateTime = normalizeAgreementDateTime(input.agreementStartDateTime)
  if (!agreementStartDateTime) {
    throw new Error('Avtalsstart måste anges i format YYYYMMDD eller YYYYMMDDHHMM, till exempel 202605150000.')
  }

  const powerOfAttorneyReference = clean(input.powerOfAttorneyReference)
  if (!powerOfAttorneyReference) {
    throw new Error('Fullmakts-/avtalsreferens måste anges. Använd värdet från Edielportalen eller er egen testreferens.')
  }

  const manualFullName = clean(input.customerName)
  const manualNameFromParts = [clean(input.customerFirstName), clean(input.customerLastName)].filter(Boolean).join(' ')
  const customerName = manualFullName ?? clean(manualNameFromParts) ?? clean(getFieldValue(testData, '228'))
  const customerContactEmail = clean(input.customerEmail)
  const customerContactPhone = clean(input.customerPhone)
  const customerId = digitsOrTest(input.customerPersonalNumber, getFieldValue(testData, '227'))
  const birthDate = digitsOrTest(input.customerBirthDate, getFieldValue(testData, '249'))
  const reasonForTransaction =
    normalizeReasonForTransaction(input.reasonForTransaction) ??
    normalizeReasonForTransaction(testCaseOverrides.reasonForTransaction) ??
    normalizeReasonForTransaction(getFieldValue(testData, '223')) ??
    'Z22'
  const customerIdCodeListQualifier =
    normalizeCustomerIdCodeListQualifier(input.customerIdCodeListQualifier) ??
    normalizeCustomerIdCodeListQualifier(testCaseOverrides.customerIdCodeListQualifier) ??
    inferCustomerIdCodeListQualifier(customerId, birthDate)
  const facilityId = digitsOrTest(input.facilityId, getFieldValue(testData, '209')) ?? digits(getFieldValue(testData, '233'))
  const gridAreaId = tokenOrTest(input.gridAreaId, getFieldValue(testData, '260'))

  const missing: string[] = []
  if (!customerName) missing.push('kundnamn')
  if (!customerId) missing.push('personnummer/kund-id')
  if (!customerContactEmail && !customerContactPhone) missing.push('e-post eller telefon')
  if (!facilityId) missing.push('anläggnings-id')
  if (!gridAreaId) missing.push('nätområdes-id')

  if (missing.length > 0) {
    throw new Error(`Fyll i obligatoriska fält innan testkunden skapas: ${missing.join(', ')}.`)
  }

  const manualRegisters = buildManualRegisters(input)
  const importedRegisters = buildRegisters(testData)
  const registers = manualRegisters.length > 0
    ? manualRegisters
    : importedRegisters.length > 0
      ? importedRegisters
      : [{ label: 'register_1', annualEnergyKwh: toNumber(input.annualEnergyKwh), meterConstant: null, meterDigits: null, meterTimeInterval: null, resolution: null }]
  const annualEnergyKwh = toNumber(input.annualEnergyKwh) ?? toNumber(getFieldValue(testData, '213', ['Z03'])) ?? registers[0]?.annualEnergyKwh ?? null

  return {
    testLabel: testData?.title ?? `Manuellt skapad Edielportal-testkund ${input.testSuite}/${input.roleCode}/${input.testCaseCode}`,
    testSuite: input.testSuite,
    roleCode: input.roleCode,
    testCaseCode: input.testCaseCode,
    customerId: customerId!,
    customerIdCodeListQualifier,
    reasonForTransaction,
    customerName: customerName!,
    customerEmail: customerContactEmail,
    customerPhone: customerContactPhone,
    birthDate,
    customerAddress: valueOrTest(input.customerAddress, getFieldValue(testData, '229')),
    customerPostalCode: digitsOrTest(input.customerPostalCode, getFieldValue(testData, '231')),
    customerCity: valueOrTest(input.customerCity, getFieldValue(testData, '232')),
    customerCountry: tokenOrTest(input.customerCountry, getFieldValue(testData, '316')) ?? 'SE',
    billingRecipientId: digitsOrTest(input.billingRecipientId, getFieldValue(testData, '250')),
    billingRecipientName: valueOrTest(input.billingRecipientName, getFieldValue(testData, '251')),
    billingRecipientAddress: valueOrTest(input.billingRecipientAddress, getFieldValue(testData, '252')),
    billingRecipientPostalCode: digitsOrTest(input.billingRecipientPostalCode, getFieldValue(testData, '253')),
    billingRecipientCity: valueOrTest(input.billingRecipientCity, getFieldValue(testData, '317')),
    billingRecipientCountry: tokenOrTest(input.billingRecipientCountry, getFieldValue(testData, '318')) ?? 'SE',
    billingRecipientEmail: clean(input.billingRecipientEmail),
    billingRecipientPhone: clean(input.billingRecipientPhone),
    facilityId: facilityId!,
    siteAddress: valueOrTest(input.siteAddress, getFieldValue(testData, '234')),
    sitePostalCode: digitsOrTest(input.sitePostalCode, getFieldValue(testData, '235')),
    siteCity: valueOrTest(input.siteCity, getFieldValue(testData, '236')),
    siteCountry: tokenOrTest(input.siteCountry, getFieldValue(testData, '237')) ?? 'SE',
    gridAreaId: gridAreaId!,
    agreementStartDate: dateOnlyFromEdiel(agreementStartDateTime),
    agreementStartDateTime,
    annualEnergyKwh,
    annualEnergyUnit: tokenOrTest(input.annualEnergyUnit, getFieldValue(testData, 'Enhet för uppskattad årsenergi')) ?? 'KWH',
    meteringMethod: tokenOrTest(testCaseOverrides.meteringMethod, tokenOrTest(input.meteringMethod, getFieldValue(testData, '217'))),
    reportingFrequency: tokenOrTest(input.reportingFrequency, getFieldValue(testData, '222')),
    meterNumber: tokenOrTest(input.meterNumber, getFieldValue(testData, '224')),
    productCode: tokenOrTest(input.productCode, getFieldValue(testData, '242')),
    settlementMethod: tokenOrTest(input.settlementMethod, getFieldValue(testData, '254')),
    installationStatus: tokenOrTest(input.installationStatus, getFieldValue(testData, '306')),
    tariffCode: tokenOrTest(input.tariffCode, getFieldValue(testData, '307')),
    priority: tokenOrTest(input.priority, getFieldValue(testData, '220')),
    balanceResponsibleId: clean(input.balanceResponsibleId) ?? firstToken(getFieldValue(testData, '262')),
    powerOfAttorneyReference,
    powerOfAttorneyStatus: normalizePowerOfAttorneyStatus(input.powerOfAttorneyStatus),
    priceAreaCode: clean(input.priceAreaCode),
    registers,
  }
}


async function maybeSingle<T = AnyRow>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const { data, error } = await query
  if (error) throw error
  return (data as T | null) ?? null
}

async function ensureGridOwner(
  supabase: SupabaseClient,
  data: PortalTestCustomerData,
  companyId: string,
  actorUserId: string
): Promise<AnyRow> {
  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('grid_owners')
      .select('*')
      .eq('name', `Edielportal testnät ${data.gridAreaId}`)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  if (existing) {
    const needsUpdate = existing.ediel_id !== EDIEL_TGT_TESTSYSTEM_EDIEL_ID || existing.is_active !== true
    if (!needsUpdate) return existing

    const { data: updated, error } = await supabase
      .from('grid_owners')
      .update({
        ediel_id: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
        is_active: true,
        updated_by: actorUserId,
      })
      .eq('id', String(existing.id))
      .select('*')
      .single()

    if (error) throw error
    return updated as AnyRow
  }

  const { data: inserted, error } = await supabase
    .from('grid_owners')
    .insert({
      company_id: companyId,
      name: `Edielportal testnät ${data.gridAreaId}`,
      owner_code: data.gridAreaId,
      ediel_id: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      org_number: null,
      contact_name: 'Edielportalen TGT',
      email: '91100@ediel.se',
      phone: null,
      address_line_1: null,
      address_line_2: null,
      postal_code: null,
      city: null,
      country: 'SE',
      notes: `Skapad automatiskt som testnätägare för ${data.testSuite}/${data.roleCode}/${data.testCaseCode}.`,
      is_active: true,
      created_by: actorUserId,
      updated_by: actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return inserted as AnyRow
}

async function ensureTgtRouteProfile(
  supabase: SupabaseClient,
  communicationRouteId: string,
  companyId: string,
  actorUserId: string,
  roleCode: EdielTestRoleCode
): Promise<void> {
  const applicationReference = roleCode === 'esco'
    ? EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE
    : EDIEL_TGT_PRODAT_APPLICATION_REFERENCE
  const payload = {
    company_id: companyId,
    communication_route_id: communicationRouteId,
    is_enabled: true,
    sender_ediel_id: GRIDEX_TGT_EDIEL_ID,
    sender_name: 'GridCore',
    sender_sub_address: EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
    receiver_ediel_id: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiver_name: 'Edielportalen test',
    receiver_sub_address: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
    application_reference: applicationReference,
    default_message_version: '26A',
    default_test_flag: 1,
    default_timezone: 1,
    environment: 'test',
    message_standard: 'edifact',
    ack_mode: 'contrl_and_aperak',
    smtp_host: null,
    smtp_port: null,
    imap_host: null,
    imap_port: null,
    mailbox: 'INBOX',
    encryption_mode: 'none',
    payload_format: 'edifact',
    notes: `TGT SMTP-profil enligt PRODAT 26.A: 92825:ZZ:PRODAT till 91100:ZZ:PRODAT, SMTP 91100@ediel.se och Application Reference ${applicationReference}.`,
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  }

  const { data: existing, error: existingError } = await supabase
    .from('ediel_route_profiles')
    .select('id')
    .eq('communication_route_id', communicationRouteId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.id) {
    const { error } = await supabase
      .from('ediel_route_profiles')
      .update(payload)
      .eq('id', String(existing.id))

    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('ediel_route_profiles')
    .insert({
      ...payload,
      created_by: actorUserId,
    })

  if (error) throw error
}

async function ensureRoute(
  supabase: SupabaseClient,
  gridOwner: AnyRow,
  data: PortalTestCustomerData,
  companyId: string,
  actorUserId: string
): Promise<AnyRow> {
  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('communication_routes')
      .select('*')
      .eq('route_scope', 'supplier_switch')
      .eq('grid_owner_id', String(gridOwner.id))
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  const endpoint = `smtp://${EDIEL_TGT_TESTSYSTEM_EMAIL}`
  let route: AnyRow

  if (existing) {
    const needsUpdate =
      existing.is_active !== true ||
      existing.endpoint !== endpoint ||
      existing.route_type !== 'ediel_partner' ||
      existing.target_system !== 'ediel_portal_tgt' ||
      existing.target_email !== EDIEL_TGT_TESTSYSTEM_EMAIL

    if (!needsUpdate) {
      route = existing
    } else {
      const { data: updated, error } = await supabase
        .from('communication_routes')
        .update({
          company_id: companyId,
          is_active: true,
          route_type: 'ediel_partner',
          target_system: 'ediel_portal_tgt',
          endpoint,
          target_email: EDIEL_TGT_TESTSYSTEM_EMAIL,
          supported_payload_version: 'edifact',
          notes: `SMTP-route för Edielportalen TGT ${data.testSuite}/${data.roleCode}/${data.testCaseCode}.`,
          updated_by: actorUserId,
        })
        .eq('id', String(existing.id))
        .select('*')
        .single()

      if (error) throw error
      route = updated as AnyRow
    }
  } else {
    const { data: inserted, error } = await supabase
      .from('communication_routes')
      .insert({
        company_id: companyId,
        route_name: `Edielportal TGT · ${data.gridAreaId}`,
        is_active: true,
        route_scope: 'supplier_switch',
        route_type: 'ediel_partner',
        grid_owner_id: String(gridOwner.id),
        target_system: 'ediel_portal_tgt',
        endpoint,
        target_email: EDIEL_TGT_TESTSYSTEM_EMAIL,
        auth_config: {},
        supported_payload_version: 'edifact',
        notes: `SMTP-route för Edielportalen TGT ${data.testSuite}/${data.roleCode}/${data.testCaseCode}.`,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select('*')
      .single()

    if (error) throw error
    route = inserted as AnyRow
  }

  await ensureTgtRouteProfile(supabase, String(route.id), companyId, actorUserId, data.roleCode)
  return route
}

async function ensureCustomer(
  supabase: SupabaseClient,
  data: PortalTestCustomerData,
  companyId: string,
  actorUserId: string
): Promise<AnyRow> {
  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('customers')
      .select('*')
      .eq('personal_number', data.customerId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  if (existing) return existing

  const { firstName, lastName } = splitName(data.customerName)
  const { data: inserted, error } = await supabase
    .from('customers')
    .insert({
      company_id: companyId,
      customer_type: 'private',
      status: 'draft',
      first_name: firstName,
      last_name: lastName,
      full_name: data.customerName,
      company_name: null,
      email: data.customerEmail,
      phone: data.customerPhone,
      personal_number: data.customerId,
      org_number: null,
      source: 'ediel_portal_test',
      customer_number: null,
      apartment_number: null,
      created_by: actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return inserted as AnyRow
}

async function ensureCustomerAddress(
  supabase: SupabaseClient,
  params: {
    companyId: string
    customerId: string
    type: 'registered' | 'billing' | 'facility'
    street: string | null
    postalCode: string | null
    city: string | null
    country: string | null
  }
): Promise<void> {
  if (!params.street && !params.postalCode && !params.city) return

  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('customer_addresses')
      .select('id')
      .eq('customer_id', params.customerId)
      .eq('company_id', params.companyId)
      .eq('type', params.type)
      .eq('street_1', params.street ?? '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  if (existing) return

  const { error } = await supabase
    .from('customer_addresses')
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      type: params.type,
      street_1: params.street ?? '',
      street_2: null,
      postal_code: params.postalCode,
      city: params.city,
      country: params.country ?? 'SE',
      municipality: null,
      moved_in_at: null,
      moved_out_at: null,
      is_active: true,
    })

  if (error) throw error
}

async function ensureBillingContact(
  supabase: SupabaseClient,
  data: PortalTestCustomerData,
  companyId: string,
  customerId: string
): Promise<void> {
  if (!data.billingRecipientName && !data.billingRecipientId) return

  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('customer_contacts')
      .select('id')
      .eq('customer_id', customerId)
      .eq('company_id', companyId)
      .eq('type', 'billing')
      .eq('name', data.billingRecipientName ?? data.billingRecipientId ?? '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  if (existing) return

  const { error } = await supabase
    .from('customer_contacts')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      type: 'billing',
      name: data.billingRecipientName ?? data.billingRecipientId,
      email: data.billingRecipientEmail,
      phone: data.billingRecipientPhone,
      title: data.billingRecipientId ? `Fakturamottagare-id ${data.billingRecipientId}` : 'Fakturamottagare',
      is_primary: false,
    })

  if (error) throw error
}

async function ensureSite(
  supabase: SupabaseClient,
  data: PortalTestCustomerData,
  companyId: string,
  customerId: string,
  gridOwnerId: string,
  actorUserId: string
): Promise<AnyRow> {
  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('customer_sites')
      .select('*')
      .eq('customer_id', customerId)
      .eq('company_id', companyId)
      .eq('facility_id', data.facilityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  const payload = {
    company_id: companyId,
    site_name: `Edielportal ${data.testCaseCode} · ${data.facilityId}`,
    site_type: inferSiteType(data.testCaseCode),
    status: 'draft',
    grid_owner_id: gridOwnerId,
    price_area_code: data.priceAreaCode,
    move_in_date: data.agreementStartDate,
    annual_consumption_kwh: data.annualEnergyKwh,
    current_supplier_name: 'Edielportalen test',
    current_supplier_org_number: null,
    street: data.siteAddress,
    postal_code: data.sitePostalCode,
    city: data.siteCity,
    country: data.siteCountry ?? 'SE',
    care_of: null,
    internal_notes: `Edielportal-test ${data.testSuite}/${data.roleCode}/${data.testCaseCode}. Grid area ${data.gridAreaId}.`,
    updated_by: actorUserId,
  }

  if (existing) {
    const { data: updated, error } = await supabase
      .from('customer_sites')
      .update(payload)
      .eq('id', String(existing.id))
      .select('*')
      .single()

    if (error) throw error
    return updated as AnyRow
  }

  const { data: inserted, error } = await supabase
    .from('customer_sites')
    .insert({
      ...payload,
      customer_id: customerId,
      facility_id: data.facilityId,
      moved_from_street: null,
      moved_from_postal_code: null,
      moved_from_city: null,
      moved_from_supplier_name: null,
      created_by: actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return inserted as AnyRow
}

async function ensureMeteringPoint(
  supabase: SupabaseClient,
  data: PortalTestCustomerData,
  companyId: string,
  customerId: string,
  siteId: string,
  gridOwnerId: string,
  actorUserId: string
): Promise<AnyRow> {
  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('metering_points')
      .select('*')
      .eq('site_id', siteId)
      .eq('company_id', companyId)
      .eq('meter_point_id', data.facilityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  const payload = {
    company_id: companyId,
    customer_id: customerId,
    site_facility_id: data.facilityId,
    ediel_reference: data.facilityId,
    status: 'draft',
    measurement_type: inferMeasurementType(data.testCaseCode),
    reading_frequency: normalizeReadingFrequency(data.reportingFrequency),
    grid_owner_id: gridOwnerId,
    price_area_code: data.priceAreaCode,
    start_date: data.agreementStartDate,
    end_date: null,
    is_settlement_relevant: true,
    updated_by: actorUserId,
  }

  if (existing) {
    const { data: updated, error } = await supabase
      .from('metering_points')
      .update(payload)
      .eq('id', String(existing.id))
      .select('*')
      .single()

    if (error) throw error
    return updated as AnyRow
  }

  const { data: inserted, error } = await supabase
    .from('metering_points')
    .insert({
      ...payload,
      site_id: siteId,
      meter_point_id: data.facilityId,
      created_by: actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return inserted as AnyRow
}

async function ensurePowerOfAttorney(
  supabase: SupabaseClient,
  data: PortalTestCustomerData,
  companyId: string,
  customerId: string,
  siteId: string,
  actorUserId: string
): Promise<AnyRow> {
  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('powers_of_attorney')
      .select('*')
      .eq('customer_id', customerId)
      .eq('company_id', companyId)
      .eq('site_id', siteId)
      .eq('scope', 'supplier_switch')
      .eq('reference', data.powerOfAttorneyReference)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  if (existing) {
    if (existing.status === data.powerOfAttorneyStatus) return existing

    const { data: updated, error } = await supabase
      .from('powers_of_attorney')
      .update({
        company_id: companyId,
        status: data.powerOfAttorneyStatus,
        signed_at: data.powerOfAttorneyStatus === 'signed' ? new Date().toISOString() : null,
        valid_from: data.agreementStartDate,
        notes: `Fullmaktstatus ${data.powerOfAttorneyStatus} för Edielportal-test ${data.testCaseCode}.`,
        updated_by: actorUserId,
      })
      .eq('id', String(existing.id))
      .select('*')
      .single()

    if (error) throw error
    return updated as AnyRow
  }

  const { data: inserted, error } = await supabase
    .from('powers_of_attorney')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      site_id: siteId,
      scope: 'supplier_switch',
      status: data.powerOfAttorneyStatus,
      signed_at: data.powerOfAttorneyStatus === 'signed' ? new Date().toISOString() : null,
      valid_from: data.agreementStartDate,
      valid_to: null,
      document_path: null,
      reference: data.powerOfAttorneyReference,
      notes: `Skapad från Edielportal-test ${data.testSuite}/${data.roleCode}/${data.testCaseCode}. Fullmaktstatus: ${data.powerOfAttorneyStatus}.`,
      created_by: actorUserId,
      updated_by: actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return inserted as AnyRow
}

async function ensureSwitchRequest(
  supabase: SupabaseClient,
  params: {
    data: PortalTestCustomerData
    companyId: string
    customerId: string
    siteId: string
    meteringPointId: string
    gridOwnerId: string
    powerOfAttorneyId: string
    actorUserId: string
  }
): Promise<{ row: AnyRow; reused: boolean }> {
  const automationKey = [
    'ediel_portal_test',
    params.data.testSuite,
    params.data.roleCode,
    params.data.testCaseCode,
    params.data.customerId,
    params.data.facilityId,
  ].join(':')

  const existing = await maybeSingle<AnyRow>(
    supabase
      .from('supplier_switch_requests')
      .select('*')
      .eq('automation_key', automationKey)
      .eq('company_id', params.companyId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )

  const validationSnapshot = {
    isReady: true,
    source: 'ediel_portal_test_customer_onboarding',
    testSuite: params.data.testSuite,
    roleCode: params.data.roleCode,
    testCaseCode: params.data.testCaseCode,
    testLabel: params.data.testLabel,
    portalData: {
      customerId: params.data.customerId,
      customerIdCodeListQualifier: params.data.customerIdCodeListQualifier,
      reasonForTransaction: params.data.reasonForTransaction,
      customerName: params.data.customerName,
      birthDate: params.data.birthDate,
      customerAddress: params.data.customerAddress,
      customerPostalCode: params.data.customerPostalCode,
      customerCity: params.data.customerCity,
      customerCountry: params.data.customerCountry,
      powerOfAttorneyReference: params.data.powerOfAttorneyReference,
      siteAddress: params.data.siteAddress,
      sitePostalCode: params.data.sitePostalCode,
      siteCity: params.data.siteCity,
      siteCountry: params.data.siteCountry,
      facilityId: params.data.facilityId,
      gridAreaId: params.data.gridAreaId,
      agreementStartDateTime: params.data.agreementStartDateTime,
      meteringMethod: params.data.meteringMethod,
      testCaseOverrides: getPortalTestCaseOverrides(params.data),
      annualEnergyKwh: params.data.annualEnergyKwh,
      annualEnergyUnit: params.data.annualEnergyUnit,
      meterNumber: params.data.meterNumber,
      productCode: params.data.productCode,
      settlementMethod: params.data.settlementMethod,
      installationStatus: params.data.installationStatus,
      tariffCode: params.data.tariffCode,
      priority: params.data.priority,
      balanceResponsibleId: params.data.balanceResponsibleId,
      billingRecipient: {
        id: params.data.billingRecipientId,
        name: params.data.billingRecipientName,
        address: params.data.billingRecipientAddress,
        postalCode: params.data.billingRecipientPostalCode,
        city: params.data.billingRecipientCity,
        country: params.data.billingRecipientCountry,
      },
      registers: params.data.registers,
    },
    checkedAt: new Date().toISOString(),
  }

  if (existing) {
    const { data: updated, error } = await supabase
      .from('supplier_switch_requests')
      .update({
        requested_start_date: params.data.agreementStartDate,
        grid_owner_id: params.gridOwnerId,
        price_area_code: params.data.priceAreaCode,
        validation_snapshot: validationSnapshot,
        updated_by: params.actorUserId,
      })
      .eq('id', String(existing.id))
      .select('*')
      .single()

    if (error) throw error

    await supabase.from('supplier_switch_events').insert({
      switch_request_id: String(updated.id),
      event_type: 'ediel_portal_test_customer_updated',
      event_status: 'success',
      message: 'Edielportal-testkundens switchärende uppdaterades med aktuell TGT-testdata.',
      payload: validationSnapshot,
      created_by: params.actorUserId,
    })

    return { row: updated as AnyRow, reused: true }
  }

  const { data: inserted, error } = await supabase
    .from('supplier_switch_requests')
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      power_of_attorney_id: params.powerOfAttorneyId,
      authorization_document_id: null,
      request_type: 'switch',
      status: 'queued',
      requested_start_date: params.data.agreementStartDate,
      current_supplier_name: 'Edielportalen test',
      current_supplier_org_number: null,
      incoming_supplier_name: 'Gridex',
      incoming_supplier_org_number: null,
      grid_owner_id: params.gridOwnerId,
      price_area_code: params.data.priceAreaCode,
      validation_snapshot: validationSnapshot,
      external_reference: `TGT-${params.data.testCaseCode}-${params.data.customerId}`,
      submitted_at: null,
      completed_at: null,
      failed_at: null,
      failure_reason: null,
      automation_origin: 'ediel_portal_test_customer',
      automation_key: automationKey,
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error

  await supabase.from('supplier_switch_events').insert({
    switch_request_id: String(inserted.id),
    event_type: 'ediel_portal_test_customer_created',
    event_status: 'success',
    message: `Edielportal-testkund och switchärende skapades för ${params.data.testSuite}/${params.data.roleCode}/${params.data.testCaseCode}.`,
    payload: validationSnapshot,
    created_by: params.actorUserId,
  })

  return { row: inserted as AnyRow, reused: false }
}

export async function createEdielPortalTestCustomerGraph(
  supabase: SupabaseClient,
  input: CreateEdielPortalTestCustomerInput
): Promise<CreateEdielPortalTestCustomerResult> {
  const data = buildPortalTestData(input)
  const companyId = input.companyId
  const gridOwner = await ensureGridOwner(supabase, data, companyId, input.actorUserId)
  const route = await ensureRoute(supabase, gridOwner, data, companyId, input.actorUserId)
  const customer = await ensureCustomer(supabase, data, companyId, input.actorUserId)
  const customerId = String(customer.id)

  await ensureCustomerAddress(supabase, {
    companyId,
    customerId,
    type: 'registered',
    street: data.customerAddress,
    postalCode: data.customerPostalCode,
    city: data.customerCity,
    country: data.customerCountry,
  })
  await ensureCustomerAddress(supabase, {
    companyId,
    customerId,
    type: 'billing',
    street: data.billingRecipientAddress,
    postalCode: data.billingRecipientPostalCode,
    city: data.billingRecipientCity,
    country: data.billingRecipientCountry,
  })
  await ensureBillingContact(supabase, data, companyId, customerId)

  const site = await ensureSite(supabase, data, companyId, customerId, String(gridOwner.id), input.actorUserId)
  const meteringPoint = await ensureMeteringPoint(supabase, data, companyId, customerId, String(site.id), String(gridOwner.id), input.actorUserId)
  const poa = await ensurePowerOfAttorney(supabase, data, companyId, customerId, String(site.id), input.actorUserId)
  const switchRequest = await ensureSwitchRequest(supabase, {
    data,
    companyId,
    customerId,
    siteId: String(site.id),
    meteringPointId: String(meteringPoint.id),
    gridOwnerId: String(gridOwner.id),
    powerOfAttorneyId: String(poa.id),
    actorUserId: input.actorUserId,
  })

  return {
    customerId,
    siteId: String(site.id),
    meteringPointId: String(meteringPoint.id),
    gridOwnerId: String(gridOwner.id),
    communicationRouteId: String(route.id),
    powerOfAttorneyId: String(poa.id),
    switchRequestId: String(switchRequest.row.id),
    reusedExistingSwitch: switchRequest.reused,
  }
}
