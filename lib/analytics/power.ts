export function kwhToAverageMw(energyKwh: number, durationHours: number): number {
  if (!Number.isFinite(energyKwh) || !Number.isFinite(durationHours) || durationHours <= 0) {
    throw new RangeError('Medeleffekt kräver en energivolym och ett positivt tidsintervall.')
  }
  return energyKwh / 1000 / durationHours
}

export function formatAverageMw(energyKwh: number, durationHours: number): string {
  const value = kwhToAverageMw(energyKwh, durationHours)
  return `${new Intl.NumberFormat('sv-SE', { maximumSignificantDigits: 4 }).format(value)} MW`
}
