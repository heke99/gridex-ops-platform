import { NextResponse } from 'next/server'
import { strictIsoDate } from '@/lib/time/stockholm'

export function resolveAnalyticsCronMonth(input: string | null, defaultMonth: string): string | null {
  if (input === null) return defaultMonth

  const value = input.trim()
  const date = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value
  try {
    return `${strictIsoDate(date, 'month').slice(0, 7)}-01`
  } catch {
    return null
  }
}

export function invalidAnalyticsCronMonth() {
  return NextResponse.json(
    { ok: false, error: 'Ange en giltig månad som YYYY-MM eller ett giltigt datum som YYYY-MM-DD.' },
    { status: 400 },
  )
}
