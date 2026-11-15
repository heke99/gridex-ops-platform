export const demoDay = '2026-11-10'
export const demoZones = ['SE3', 'SE4'] as const
export const demoStages = ['baseline', 'confirmed', 'evening', 'measured', 'ended'] as const

export type DemoZone = typeof demoZones[number]
export type DemoStage = typeof demoStages[number]
export type DemoResolution = 15 | 60

const intervalCount = 96
const annaStart = 48
const jonasEnd = 72

const sites = [
  { customer: 'Anna Lind', site: 'Villa', zone: 'SE4', baseKwh: 3, actualDelta: 1 },
  { customer: 'Sjövik Verkstad AB', site: 'Verkstad', zone: 'SE4', baseKwh: 390, actualDelta: 35 },
  { customer: 'Sjövik Verkstad AB', site: 'Lager', zone: 'SE4', baseKwh: 205, actualDelta: 4 },
  { customer: 'Jonas Vik', site: 'Bostad', zone: 'SE4', baseKwh: 2, actualDelta: 0 },
  { customer: 'Bergdala Fastigheter AB', site: 'Fastighet', zone: 'SE3', baseKwh: 110, actualDelta: 5 },
] as const

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function demoPortfolio(zone: DemoZone, stage: DemoStage, resolution: DemoResolution) {
  const quartersPerRow = resolution / 15
  const measured = stage === 'measured' || stage === 'ended'
  const eveningShift = stage === 'evening' || measured
  return Array.from({ length: intervalCount / quartersPerRow }, (_, index) => {
    const firstQuarter = index * quartersPerRow
    const contributions = sites.filter(site => site.zone === zone).map(site => {
      let forecastKwh = 0
      let plannedKwh = 0
      let actualKwh = 0
      for (let quarter = firstQuarter; quarter < firstQuarter + quartersPerRow; quarter++) {
        if (site.customer === 'Anna Lind') {
          if (quarter < annaStart) continue
          if (stage === 'baseline') {
            plannedKwh += site.baseKwh
            continue
          }
        }
        if (site.customer === 'Jonas Vik' && stage === 'ended' && quarter >= jonasEnd) continue
        const extraKwh = eveningShift && site.site === 'Verkstad' && quarter >= 72 && quarter < 88 ? 80 : 0
        forecastKwh += site.baseKwh + extraKwh
        actualKwh += site.baseKwh + extraKwh + site.actualDelta
      }
      return { customer: site.customer, site: site.site, forecastKwh, plannedKwh, actualKwh: measured ? actualKwh : null }
    })
    const forecastKwh = sum(contributions.map(site => site.forecastKwh))
    const purchasedKwh = (zone === 'SE4' ? 450 : 125) * quartersPerRow
    const actualKwh = measured ? sum(contributions.map(site => site.actualKwh ?? 0)) : null
    const hour = String(Math.floor(firstQuarter / 4)).padStart(2, '0')
    const minute = String((firstQuarter % 4) * 15).padStart(2, '0')
    return {
      index, time: `${hour}:${minute}`, contributions, forecastKwh, purchasedKwh, actualKwh,
      plannedKwh: sum(contributions.map(site => site.plannedKwh)),
      remainingKwh: forecastKwh - purchasedKwh,
      deviationKwh: actualKwh === null ? null : actualKwh - forecastKwh,
    }
  })
}
