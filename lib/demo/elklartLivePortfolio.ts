import { stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'
import type { DemoZone } from './elklartPortfolio'

// These are prepared DEMO profile assumptions, never billing or measured energy.
export const demoProfiles = {
  anna: { customer: 'Anna Lind', site: 'Villa', zone: 'SE4', kwh: 3 },
  workshop: { customer: 'Sjövik Verkstad AB', site: 'Verkstad', zone: 'SE4', kwh: 390 },
  warehouse: { customer: 'Sjövik Verkstad AB', site: 'Lager', zone: 'SE4', kwh: 205 },
  jonas: { customer: 'Jonas Vik', site: 'Bostad', zone: 'SE4', kwh: 2 },
  bergdala: { customer: 'Bergdala Fastigheter AB', site: 'Fastighet', zone: 'SE3', kwh: 110 },
} as const
export type DemoBinding = { profile: keyof typeof demoProfiles; customerId: string; meteringPointId: string }
export type DemoSupply = {
  companyId: string; customerId: string; meteringPointId: string
  startAt: string; endAt: string | null; confirmed: boolean; cancelled: boolean; updatedAt: string
}
export type DemoReading = {
  companyId: string; customerId: string; meteringPointId: string
  startAt: string; endAt: string; kwh: number; current: boolean
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function parseDemoBindings(value: string | undefined): DemoBinding[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 5) throw new Error('demo_bindings_invalid')
  const profiles = new Set<string>()
  const points = new Set<string>()
  return parsed.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('demo_bindings_invalid')
    const row = entry as Record<string, unknown>
    if (typeof row.profile !== 'string' || !Object.hasOwn(demoProfiles, row.profile)
      || typeof row.customerId !== 'string' || !uuid.test(row.customerId)
      || typeof row.meteringPointId !== 'string' || !uuid.test(row.meteringPointId)
      || profiles.has(row.profile) || points.has(row.meteringPointId.toLowerCase())) throw new Error('demo_bindings_invalid')
    profiles.add(row.profile)
    points.add(row.meteringPointId.toLowerCase())
    return { profile: row.profile as DemoBinding['profile'], customerId: row.customerId.toLowerCase(), meteringPointId: row.meteringPointId.toLowerCase() }
  })
}
export function demoDayBounds(value: string) {
  const date = strictIsoDate(value)
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    start: stockholmLocalToUtc({ year, month, day }).toISOString(),
    end: stockholmLocalToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }).toISOString(),
  }
}
function instant(value: string): number {
  const result = Date.parse(value)
  if (!Number.isFinite(result) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error('demo_timestamp_invalid')
  return result
}
function unionDuration(ranges: [number, number][]): number {
  const sorted = ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let total = 0; let end = -Infinity
  for (const [a, b] of sorted) {
    total += Math.max(0, b - Math.max(a, end))
    end = Math.max(end, b)
  }
  return total
}
export function buildLiveDemoPortfolio(input: {
  companyId: string; bindings: DemoBinding[]; supplies: DemoSupply[]; readings: DemoReading[]; day: string; zone: DemoZone
}) {
  const bindings = parseDemoBindings(JSON.stringify(input.bindings))
  const pointMap = new Map(bindings.map(row => [row.meteringPointId, row]))
  for (const row of [...input.supplies, ...input.readings]) {
    if (row.companyId !== input.companyId || pointMap.get(row.meteringPointId)?.customerId !== row.customerId) throw new Error('demo_scope_mismatch')
  }
  const supplies = input.supplies.filter(row => !row.cancelled).map(row => {
    const start = instant(row.startAt); const end = row.endAt ? instant(row.endAt) : Infinity
    if (end < start) throw new Error('demo_supply_bounds_invalid')
    return { ...row, start, end }
  })
  const readings = input.readings.filter(row => row.current).map(row => {
    const start = instant(row.startAt); const end = instant(row.endAt)
    if (end <= start || !Number.isFinite(row.kwh) || row.kwh < 0) throw new Error('demo_reading_invalid')
    return { ...row, start, end }
  }).sort((a, b) => a.start - b.start)
  const lastEnd = new Map<string, number>()
  for (const row of readings) {
    if ((lastEnd.get(row.meteringPointId) ?? -Infinity) > row.start) throw new Error('demo_current_reading_overlap')
    lastEnd.set(row.meteringPointId, row.end)
  }
  const bounds = demoDayBounds(input.day)
  const dayStart = instant(bounds.start); const dayEnd = instant(bounds.end)
  const quarterMs = 900_000
  const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' })
  return Array.from({ length: (dayEnd - dayStart) / quarterMs }, (_, index) => {
    const start = dayStart + index * quarterMs; const end = start + quarterMs
    const contributions = bindings.filter(row => demoProfiles[row.profile].zone === input.zone).map(binding => {
      const profile = demoProfiles[binding.profile]
      const periods = supplies.filter(row => row.meteringPointId === binding.meteringPointId && row.start < end && row.end > start)
      const confirmed = periods.filter(row => row.confirmed).map(row => [Math.max(start, row.start), Math.min(end, row.end)] as [number, number])
      const confirmedMs = unionDuration(confirmed)
      const allMs = unionDuration(periods.map(row => [Math.max(start, row.start), Math.min(end, row.end)]))
      let actual = 0; let coverage = 0
      for (const reading of readings.filter(row => row.meteringPointId === binding.meteringPointId && row.start < end && row.end > start)) {
        const duration = unionDuration(confirmed.map(([a, b]) => [Math.max(a, reading.start), Math.min(b, reading.end)]))
        // Do not invent a uniform distribution for a longer meter interval.
        if (duration === 0 || reading.start < start || reading.end > end || duration !== reading.end - reading.start) continue
        actual += reading.kwh
        coverage += duration
      }
      return {
        ...binding, customer: profile.customer, site: profile.site,
        forecastKwh: profile.kwh * confirmedMs / quarterMs,
        plannedKwh: profile.kwh * (allMs - confirmedMs) / quarterMs,
        actualKwh: coverage === confirmedMs ? actual : null,
        updatedAt: periods.map(row => row.updatedAt).sort().at(-1) ?? null,
      }
    })
    const sum = (key: 'forecastKwh' | 'plannedKwh') => contributions.reduce((total, row) => total + row[key], 0)
    const forecastKwh = sum('forecastKwh')
    const actualKwh = contributions.some(row => row.actualKwh === null) ? null : contributions.reduce((total, row) => total + (row.actualKwh ?? 0), 0)
    const purchasedKwh = input.zone === 'SE4' ? 450 : 125
    return { index, startAt: new Date(start).toISOString(), time: clock.format(start), contributions,
      forecastKwh, plannedKwh: sum('plannedKwh'), purchasedKwh, remainingKwh: forecastKwh - purchasedKwh,
      actualKwh, deviationKwh: actualKwh === null ? null : actualKwh - forecastKwh }
  })
}
