/** V1 enumerates business-write inputs, not arbitrary normalized diagnostics.
 * Source/actor/invocation lineage is deliberately outside reusable content. */
export type UtiltsConsumptionAttribution = {
  capability: 'write' | 'skip'
  reason: string | null
  customerId: string | null
  siteId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  sourceRequestId: string | null
}
export type UtiltsBillingContext = UtiltsConsumptionAttribution & {
  requestScope: string | null
  periodStart: string | null
  periodEnd: string | null
  month: number | null
  year: number | null
  status: 'received'
  sourceSystem: 'ediel_utilts'
  currency: 'SEK'
}
export type UtiltsConsumptionObservation = {
  ordinal: number
  sourceOrdinal: number
  quantity: number
  periodStart: string
  periodEnd: string
  readAt: string
  resolution: string | null
  unit: 'kWh'
  quality: string | null
  readingType: 'consumption' | 'production' | 'estimated' | 'adjustment'
  direction: 'consumption' | 'production'
  registerCode: string | null
  productCode: string | null
  sourceLineReference: string | null
  externalPoint: string | null
  gridArea: string | null
}
export type UtiltsConsumptionContractV1 = {
  version: 1
  projectionVersion: 'utilts-consumption-v1'
  attributionVersion: 'tenant-match-v1'
  companyId: string
  environment: 'test' | 'production'
  messageCode: string
  transactionId: string
  seriesKind: string
  profileKey: string | null
  profileVersion: string | null
  rulePackHash: string | null
  guideRevision: string
  interpretation: {
    localPeriodStart: string | null
    localPeriodEnd: string | null
    localRegistration: string | null
    resolutionValue: string | null
    resolutionFormat: string | null
    timezoneRaw: string | null
    timezoneFormat: '406' | null
    offsetMinutes: number | null
    timestampPolicy: 'explicit-offset-v1' | 'no-consumption-v1'
  }
  observations: UtiltsConsumptionObservation[]
  metering: UtiltsConsumptionAttribution
  billing: UtiltsBillingContext
  billingContributionOrdinals: number[]
  sourceType: 'ediel_utilts'
}

export function consumptionConflict(reason: string): never {
  throw new Error(`utilts_consumption_binding_conflict:${reason}`)
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) consumptionConflict('object_required')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: string) {
  if (Object.keys(value).sort().join(',') !== expected.split(' ').sort().join(',')) consumptionConflict('contract_keys')
}
function text(value: unknown, nullable = true) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !value || value !== value.trim()) consumptionConflict('text_required')
}
export function canonicalAbsoluteInstant(value: unknown): string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) consumptionConflict('absolute_instant_required')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) consumptionConflict('invalid_instant')
  return parsed.toISOString()
}
function instant(value: unknown) {
  if (canonicalAbsoluteInstant(value) !== value) consumptionConflict('noncanonical_instant')
}
function attribution(value: unknown, billing = false) {
  const a = object(value)
  keys(a, 'capability reason customerId siteId customerSiteId meteringPointId gridOwnerId sourceRequestId' +
    (billing ? ' requestScope periodStart periodEnd month year status sourceSystem currency' : ''))
  for (const key of ['reason', 'customerId', 'siteId', 'customerSiteId', 'meteringPointId', 'gridOwnerId', 'sourceRequestId']) text(a[key])
  if (!['write', 'skip'].includes(String(a.capability))) consumptionConflict('capability')
  if (a.capability === 'skip' && !a.reason) consumptionConflict('skip_reason')
  if (a.capability === 'write' && (!a.customerId || (!billing && !a.meteringPointId) || a.reason !== null)) consumptionConflict('write_attribution')
  if (billing) {
    text(a.requestScope)
    if (a.periodStart !== null) instant(a.periodStart)
    if (a.periodEnd !== null) instant(a.periodEnd)
    if (a.month !== null && (!Number.isInteger(a.month) || Number(a.month) < 1 || Number(a.month) > 12)) consumptionConflict('billing_month')
    if (a.year !== null && (!Number.isInteger(a.year) || Number(a.year) < 1900 || Number(a.year) > 9999)) consumptionConflict('billing_year')
    if (a.status !== 'received' || a.sourceSystem !== 'ediel_utilts' || a.currency !== 'SEK') consumptionConflict('billing_constants')
    if (a.capability === 'write' && (!a.sourceRequestId || a.requestScope !== 'billing_underlay' || !a.periodEnd || a.month === null || a.year === null)) consumptionConflict('billing_context')
    const date = a.periodEnd ?? a.periodStart
    if (date !== null && (new Date(String(date)).getUTCMonth() + 1 !== a.month || new Date(String(date)).getUTCFullYear() !== a.year)) consumptionConflict('billing_calendar')
  }
}
export function validateUtiltsConsumptionContract(value: unknown): UtiltsConsumptionContractV1 {
  const c = object(value)
  keys(c, 'version projectionVersion attributionVersion companyId environment messageCode transactionId seriesKind profileKey profileVersion rulePackHash guideRevision interpretation observations metering billing billingContributionOrdinals sourceType')
  if (c.version !== 1 || c.projectionVersion !== 'utilts-consumption-v1' || c.attributionVersion !== 'tenant-match-v1' || c.sourceType !== 'ediel_utilts') consumptionConflict('unsupported_version')
  for (const key of ['companyId', 'messageCode', 'transactionId', 'seriesKind', 'guideRevision']) text(c[key], false)
  text(c.profileKey)
  text(c.profileVersion); text(c.rulePackHash)
  if (!['test', 'production'].includes(String(c.environment))) consumptionConflict('environment')
  const i = object(c.interpretation)
  keys(i, 'localPeriodStart localPeriodEnd localRegistration resolutionValue resolutionFormat timezoneRaw timezoneFormat offsetMinutes timestampPolicy')
  for (const key of ['localPeriodStart', 'localPeriodEnd', 'localRegistration', 'resolutionValue', 'resolutionFormat', 'timezoneRaw']) text(i[key])
  if (i.timezoneFormat !== null && i.timezoneFormat !== '406') consumptionConflict('timezone_format')
  if (i.offsetMinutes !== null && (!Number.isInteger(i.offsetMinutes) || Math.abs(Number(i.offsetMinutes)) > 840)) consumptionConflict('timezone_offset')
  if (!['explicit-offset-v1', 'no-consumption-v1'].includes(String(i.timestampPolicy))) consumptionConflict('timestamp_policy')
  attribution(c.metering); attribution(c.billing, true)
  if (!Array.isArray(c.observations) || !Array.isArray(c.billingContributionOrdinals)) consumptionConflict('observation_array')
  const sourceOrdinals = new Set<number>()
  for (const [index, value] of c.observations.entries()) {
    const o = object(value)
    keys(o, 'ordinal sourceOrdinal quantity periodStart periodEnd readAt resolution unit quality readingType direction registerCode productCode sourceLineReference externalPoint gridArea')
    if (o.ordinal !== index || !Number.isInteger(o.sourceOrdinal) || Number(o.sourceOrdinal) < 0 || sourceOrdinals.has(Number(o.sourceOrdinal))) consumptionConflict('observation_order')
    sourceOrdinals.add(Number(o.sourceOrdinal))
    if (typeof o.quantity !== 'number' || !Number.isFinite(o.quantity)) consumptionConflict('quantity')
    instant(o.periodStart); instant(o.periodEnd); instant(o.readAt)
    if (String(o.periodStart) >= String(o.periodEnd)) consumptionConflict('period_order')
    for (const key of ['resolution', 'quality', 'registerCode', 'productCode', 'sourceLineReference', 'externalPoint', 'gridArea']) text(o[key])
    if (o.unit !== 'kWh' || !['consumption', 'production', 'estimated', 'adjustment'].includes(String(o.readingType)) || o.direction !== (o.readingType === 'production' ? 'production' : 'consumption')) consumptionConflict('observation_constants')
  }
  const billing = object(c.billing)
  const expected = billing.capability === 'write' ? c.observations.map((_, index) => index) : []
  if (!consumptionEqual(c.billingContributionOrdinals, expected)) consumptionConflict('billing_contributions')
  if (i.timestampPolicy === 'no-consumption-v1' && (c.observations.length || object(c.metering).capability !== 'skip' || billing.capability !== 'skip')) consumptionConflict('no_consumption')
  return value as UtiltsConsumptionContractV1
}
/** JSON object order is immaterial; observation/contribution array order is not. */
export function consumptionEqual(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}
