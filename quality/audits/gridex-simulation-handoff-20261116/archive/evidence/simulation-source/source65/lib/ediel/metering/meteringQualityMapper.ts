import type { MeteringValueQuality } from '@/lib/ediel/metering/meteringEngine'

export function mapMeteringQuality(value: string | null | undefined): MeteringValueQuality {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['46', 'MISSING', 'SAKNAS'].includes(normalized)) return 'missing'
  if (['E', 'ESTIMATED', 'ESTIMERAD'].includes(normalized)) return 'estimated'
  if (['C', 'CORRECTED', 'RATTAD', 'RÄTTAD'].includes(normalized)) return 'corrected'
  if (['136', 'OK', 'MEASURED', 'MÄTT', 'MATT'].includes(normalized)) return 'measured'
  return 'unknown'
}
