import { describe, expect, it } from 'vitest'
import { kwhToAverageMw } from '@/lib/analytics/power'
import { resolveElklartDemoConfig } from '@/lib/demo/elklartConfig'
import { demoPortfolio } from '@/lib/demo/elklartPortfolio'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

describe('Elklart demo', () => {
  it('limits the demo to an explicitly configured company and hostname', () => {
    const config = { ELKLART_DEMO_ENABLED: 'true', ELKLART_DEMO_COMPANY_ID: '00000000-0000-0000-0000-000000000001' }
    expect(resolveElklartDemoConfig(config, 'demo.gridex.se')).toMatchObject({
      companyId: config.ELKLART_DEMO_COMPANY_ID,
      portalOrigin: 'https://mina-sidor-demo.gridex.se',
    })
    expect(resolveElklartDemoConfig(config, 'app.gridex.se')).toBeNull()
    expect(resolveElklartDemoConfig(config, 'localhost:3000')).toBeNull()
    expect(resolveElklartDemoConfig({}, 'demo.gridex.se')).toBeNull()
  })

  it('moves planned consumption into the forecast from the start interval', () => {
    const baseline = demoPortfolio('SE4', 'baseline', 15)
    const confirmed = demoPortfolio('SE4', 'confirmed', 15)
    expect(baseline[47]).toEqual(confirmed[47])
    expect(baseline[48]).toMatchObject({ forecastKwh: 597, plannedKwh: 3, actualKwh: null })
    expect(confirmed[48]).toMatchObject({ forecastKwh: 600, plannedKwh: 0, purchasedKwh: 450, remainingKwh: 150 })
    expect(kwhToAverageMw(confirmed[48].forecastKwh, 0.25)).toBe(2.4)
  })

  it('preserves historical forecast and uses a separate actual series', () => {
    const evening = demoPortfolio('SE4', 'evening', 15)
    const measured = demoPortfolio('SE4', 'measured', 15)
    const ended = demoPortfolio('SE4', 'ended', 15)
    expect(measured[48]).toMatchObject({ forecastKwh: 600, actualKwh: 640, deviationKwh: 40 })
    expect(evening[72]).toMatchObject({ forecastKwh: 680, actualKwh: null })
    expect(ended[71]).toEqual(measured[71])
    expect(ended[72]).toMatchObject({ forecastKwh: 678 })
    expect(demoPortfolio('SE3', 'confirmed', 15)[48]).toMatchObject({ forecastKwh: 110, remainingKwh: -15 })
  })

  it('adds energy by hour and uses actual elapsed hours for average power', () => {
    expect(demoPortfolio('SE4', 'confirmed', 60)[12]).toMatchObject({ forecastKwh: 2400, remainingKwh: 600 })
    expect(kwhToAverageMw(2400, 1)).toBe(2.4)
    const bounds = stockholmMonthBounds('2026-10')
    const hours = (Date.parse(bounds.end) - Date.parse(bounds.start)) / 3_600_000
    expect(hours).toBe(745)
    expect(kwhToAverageMw(745_000, hours)).toBe(1)
    expect(() => kwhToAverageMw(600, 0)).toThrow(RangeError)
  })
})

it('uses the paired local TLS portal only in development', () => {
  const environment = { NODE_ENV: 'development', ELKLART_DEMO_ENABLED: 'true', ELKLART_DEMO_COMPANY_ID: '00000000-0000-0000-0000-000000000001', ELKLART_DEMO_PORTAL_ORIGIN: 'https://localhost:3001' }
  expect(resolveElklartDemoConfig(environment, 'localhost:3000')?.portalOrigin).toBe('https://localhost:3001')
  expect(resolveElklartDemoConfig({ ...environment, ELKLART_DEMO_PORTAL_ORIGIN: 'https://evil.example' }, 'localhost:3000')).toBeNull()
  expect(resolveElklartDemoConfig({ ...environment, NODE_ENV: 'production' }, 'localhost:3000')).toBeNull()
})
