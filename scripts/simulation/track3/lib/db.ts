// DB-snapshot-hjälpare (läser lokala stacken via psql). Före/efter-jämförelse av ediel-tabeller.
import { lit, sql, sqlJson } from './seed.mjs'

export const EDIEL_TABLES = [
  'public.inbound_email_messages', 'public.inbound_ediel_parse_results', 'public.inbound_processing_jobs',
  'public.ediel_messages', 'public.ediel_message_events', 'public.ediel_outbox',
  'gridex_ediel_transport.attempts', 'gridex_outbound_dispatch.attempts',
] as const
export type Snapshot = Record<string, string[]>

/** id-mängd per tabell. */
export function snapshotIds(tables: readonly string[] = EDIEL_TABLES): Snapshot {
  const out: Snapshot = {}
  for (const t of tables) out[t] = (sqlJson(`SELECT coalesce(jsonb_agg(id::text ORDER BY id::text),'[]'::jsonb) FROM ${t}`) as string[]) ?? []
  return out
}
export const countRows = (snap: Snapshot) => Object.fromEntries(Object.entries(snap).map(([t, ids]) => [t, ids.length]))
/** Nya rader sedan 'before' (full to_jsonb-rad, utan stora råfält som ändå sparas i evidens). */
export function newRows(before: Snapshot, tables: readonly string[] = EDIEL_TABLES): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {}
  for (const t of tables) {
    const known = new Set(before[t] ?? [])
    const now = (sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id::text),'[]'::jsonb) FROM ${t} x`) as Record<string, unknown>[]) ?? []
    out[t] = now.filter((r) => !known.has(String(r.id)))
  }
  return out
}
export const rowById = (table: string, id: string) => sqlJson(`SELECT to_jsonb(x) FROM ${table} x WHERE id=${lit(id)}`) as Record<string, unknown> | null
export { sql, sqlJson, lit }

/** Gör den delade brevlådan omedelbart "due" (annars väntar cron på poll_interval_minutes). Ändrar bara schemaläggningsfält. */
export function resetMailboxSchedule(environment: 'test' | 'production'): void {
  sql(`UPDATE public.ediel_mailboxes SET last_polled_at=NULL, locked_at=NULL, locked_by=NULL
       WHERE company_id IS NULL AND environment=${lit(environment)} AND COALESCE(metadata->>'scope','')='platform_shared'`)
}
