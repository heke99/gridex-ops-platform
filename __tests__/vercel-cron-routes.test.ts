import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('Vercel cron route integrity', () => {
  const vercel = JSON.parse(readFileSync(`${root}/vercel.json`, 'utf8')) as {
    crons: Array<{ path: string; schedule: string }>
  }

  it.each(vercel.crons)('$path resolves to an authenticated route', ({ path }) => {
    const pathname = path.split('?')[0]
    const routePath = `${root}/app${pathname}/route.ts`
    expect(existsSync(routePath), `Missing route for ${path}: ${routePath}`).toBe(true)

    const source = readFileSync(routePath, 'utf8')
    expect(
      /authorizeScheduledRequest|isAnalyticsCronAuthorized|CRON_SECRET|cronSecret|timingSafeEqual|authorization/i.test(source),
      `${path} does not contain an explicit scheduler authentication gate`,
    ).toBe(true)
  })
})
