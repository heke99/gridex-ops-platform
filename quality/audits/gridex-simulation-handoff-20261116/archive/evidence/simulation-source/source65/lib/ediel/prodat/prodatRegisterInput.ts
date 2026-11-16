/** Canonical ordered register inventory. Message-global LIN sequence is never
 * accepted as a register index. Explicit indices must be complete and correct. */
export type ProdatMeterRegisterInput = {
  registerIndex?: string | number | null
  annualConsumption?: string | number | null
  annualConsumptionUnit?: string | null
  meterConstant?: string | number | null
  meterDigitCount?: string | number | null
  meterTimeFrame?: string | number | null
}
export type ProdatMeterRegister = { [K in keyof ProdatMeterRegisterInput]?: string | null }
const aliases = {
  registerIndex:['registerIndex'],
  annualConsumption:['annualConsumption','annualEnergyKwh'],
  annualConsumptionUnit:['annualConsumptionUnit','annualEnergyUnit'],
  meterConstant:['meterConstant'],
  meterDigitCount:['meterDigitCount','meterDigits'],
  meterTimeFrame:['meterTimeFrame','meterTimeInterval'],
} as const
/** P26.A LIN/C212/3055: validate at runtime before either builder interpolates
 * caller input. Nullish means the existing default; no coercion or sanitizing. */
export function prodatObjectIdentityAgency(value: unknown): '9' | '89' {
  if (value == null) return '9'
  if (value !== '9' && value !== '89') throw new Error('prodat_register_identity_agency_invalid')
  return value
}
function record(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('prodat_register_input_invalid')
  return value as Record<string,unknown>
}
function scalar(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return String(value)
  throw new Error('prodat_register_value_invalid')
}
function ownValue(row: Record<string,unknown>, keys: readonly string[]): unknown {
  const supplied = keys.filter(key => Object.prototype.hasOwnProperty.call(row,key) && row[key] !== undefined)
  const values = supplied.map(key => scalar(row[key]))
  if (new Set(values).size > 1) throw new Error('prodat_register_alias_conflict')
  return values[0]
}
export function normalizeProdatRegister(row: unknown): ProdatMeterRegister {
  const data = record(row)
  return Object.fromEntries(Object.entries(aliases).map(([key,names]) => [key,ownValue(data,names)]))
}
export function normalizeProdatRegisters(value: unknown): ProdatMeterRegister[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 999999) throw new Error('prodat_register_inventory_invalid')
  // No filtering or deduplication. Empty/malformed rows remain visible errors.
  return value.map(normalizeProdatRegister)
}
/** Snapshot arrays are authoritative. Null/empty is not permission to use stale
 * fallback data; missing individual fields never borrow another register. */
export function resolveProdatRegisterInputs(context: object, portal?: Record<string,unknown> | null): ProdatMeterRegister[] {
  const data = record(context)
  // Older non-register TGT snapshots use [] to mean no register detail.
  const nonRegisterSnapshot = !['Z04','Z06','Z10'].includes(String(data.code)) && Array.isArray(portal?.registers) && portal.registers.length === 0
  if (portal?.registers !== undefined && !nonRegisterSnapshot) return normalizeProdatRegisters(portal.registers)
  if (data.registers !== undefined) return normalizeProdatRegisters(data.registers)
  const row: Record<string,unknown> = {}
  for (const [key,names] of Object.entries(aliases)) {
    const override = portal ? ownValue(portal,names) : undefined
    row[key] = override !== undefined ? override : ownValue(data,names)
  }
  return [normalizeProdatRegister(row)]
}
