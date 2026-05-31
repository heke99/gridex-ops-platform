export function compareForecastToActual(forecastKwh: number | null | undefined, actualKwh: number | null | undefined) {
  const forecast = Number(forecastKwh ?? 0)
  const actual = Number(actualKwh ?? 0)
  const diffKwh = actual - forecast
  return {
    diffKwh,
    diffPercent: forecast ? (diffKwh / forecast) * 100 : null,
  }
}
