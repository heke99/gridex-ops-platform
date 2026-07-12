import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

function clean(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function sameSecret(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function authorizeScheduledRequest(input: {
  request: NextRequest
  dedicatedSecretEnv: string
  allowVercelCron?: boolean
}): boolean {
  const dedicatedSecret = clean(process.env[input.dedicatedSecretEnv])
  const schedulerSecret = input.allowVercelCron === false ? null : clean(process.env.CRON_SECRET)
  const accepted = [dedicatedSecret, schedulerSecret].filter((value): value is string => Boolean(value))
  if (accepted.length === 0) return false

  const authorization = input.request.headers.get('authorization') ?? ''
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? clean(authorization.slice('bearer '.length))
    : null
  const dedicatedHeader = clean(input.request.headers.get('x-cron-secret'))
  const token = bearer ?? dedicatedHeader
  return Boolean(token && accepted.some((secret) => sameSecret(token, secret)))
}
