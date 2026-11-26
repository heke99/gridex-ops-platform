export const EDIEL_OPERATIONAL_CASE_SOURCES = [
  'ediel_inbound_state_machine',
  'ediel_supply_end_effect',
  'ediel_supply_end_legacy',
] as const
type OperationalCaseSource = typeof EDIEL_OPERATIONAL_CASE_SOURCES[number]

export function isEdielOperationalCaseSource(value: string | null): value is OperationalCaseSource {
  return EDIEL_OPERATIONAL_CASE_SOURCES.some(source => source === value)
}
