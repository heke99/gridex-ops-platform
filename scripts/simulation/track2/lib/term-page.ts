// Läsning av adminsidans avtalsflik (/admin/customers/[id]?tab=contracts) via HTTP med admin-session.
// Kopierad i mönster från scenarios/term01.test.ts (readShown/pageText/svDateToIso); den filen är ett testskript och kan inte importeras.
import type { AppSession } from './session'

const MONTHS = (() => {
  const map = new Map<string, number>()
  for (let i = 0; i < 12; i += 1) {
    for (const style of ['short', 'long'] as const) {
      const name = new Intl.DateTimeFormat('sv-SE', { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2020, i, 15)))
      map.set(name.replace(/\.$/, '').toLowerCase(), i + 1)
    }
  }
  return map
})()
const DATE_TOKEN = String.raw`(?:—|\d{1,2}\s+[^\s\d]+\s+\d{4}(?:\s+\d{2}:\d{2})?)`
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function pageText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[   ]/g, ' ')
}

export function svDateToIso(token: string | undefined): string | null {
  if (!token || token.trim() === '—') return null
  const m = /(\d{1,2})\s+([^\s\d]+?)\.?\s+(\d{4})/.exec(token)
  if (!m) throw new Error(`oläsbart datum på sidan: ${token}`)
  const month = MONTHS.get(m[2].replace(/\.$/, '').toLowerCase())
  if (!month) throw new Error(`okänd månad på sidan: ${m[2]}`)
  return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`
}

function labelled(text: string, label: string): string | null {
  const m = new RegExp(String.raw`${label}:\s*(${DATE_TOKEN})`).exec(text)
  if (!m) throw new Error(`fält saknas på adminsidan: ${label}`)
  return svDateToIso(m[1])
}

export type ContractPageView = { start: string | null; aktuelltSlutdatum: string | null; uppsagningMottagen: string | null; explicitSlut: string | null; nextRenewal: string | null }

export async function readContractPage(session: AppSession, customerId: string): Promise<ContractPageView> {
  const res = await session.fetch(`/admin/customers/${customerId}?tab=contracts`)
  const text = pageText(await res.text())
  if (res.status !== 200) throw new Error(`admin-sidan svarade ${res.status}; Location=${res.headers.get('location')}`)
  return {
    start: labelled(text, 'Start'),
    aktuelltSlutdatum: labelled(text, 'Aktuellt slutdatum'),
    uppsagningMottagen: labelled(text, 'Uppsägning mottagen'),
    explicitSlut: labelled(text, 'Explicit slut'),
    nextRenewal: labelled(text, 'Nästa förlängning'),
  }
}
