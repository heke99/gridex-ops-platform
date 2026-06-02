import { randomUUID } from 'crypto'

function compactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 35)
}

export function generateEdielInterchangeReference(prefix = 'UNB'): string {
  return sanitize(`${prefix}${compactTimestamp()}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`)
}

export function generateEdielMessageReference(prefix = 'MSG'): string {
  return sanitize(`${prefix}${compactTimestamp()}${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`)
}

export function generateEdielTransactionReference(prefix = 'TRX'): string {
  return sanitize(`${prefix}${compactTimestamp()}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`)
}
