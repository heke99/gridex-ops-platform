import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Every supabase-js upsert onConflict target must match a non-partial unique
// index or unique constraint on exactly those columns. Postgres cannot infer a
// partial index for a plain ON CONFLICT column list, and a missing index makes
// the upsert fail (42P10) or lets duplicates through.

const schema = fs.readFileSync('supabase/schema.sql', 'utf8')

// Known drift owned by the Ediel test tooling: production has these columns
// and unique keys, the repository schema does not yet. Remove an entry once
// its migration lands; new entries are not allowed.
const KNOWN_DRIFT = new Set([
  'ediel_message_validation_issues(coalesce_field_path,coalesce_metering_point_id,coalesce_transaction_reference,message_id,rule_key)',
  'ediel_aperak_error_details(application_error,coalesce_free_text_code,coalesce_metering_point_id,coalesce_transaction_reference,rule_key,source_message_id)',
  'ediel_tgt_test_data(role_code,test_case_code,test_suite)',
])

function uniqueColumnSets(): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>()
  const add = (table: string, cols: string) => {
    const key = cols.split(',').map((c) => c.trim().replace(/"/g, '')).sort().join(',')
    if (!sets.has(table)) sets.set(table, new Set())
    sets.get(table)!.add(key)
  }
  for (const m of schema.matchAll(/^CREATE UNIQUE INDEX \S+ ON public\.(\w+) USING btree \(([^)]*)\);$/gm)) {
    add(m[1], m[2])
  }
  for (const m of schema.matchAll(/^ALTER TABLE ONLY public\.(\w+)\n\s+ADD CONSTRAINT \S+ (?:UNIQUE|PRIMARY KEY) \(([^)]*)\)/gm)) {
    add(m[1], m[2])
  }
  return sets
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function upsertTargets() {
  const targets: Array<{ table: string; columns: string; file: string }> = []
  for (const file of [...sourceFiles('lib'), ...sourceFiles('app')]) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/onConflict\s*:\s*['"]([a-z0-9_, ]+)['"]/g)) {
      const before = text.slice(0, m.index)
      const from = [...before.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g)].pop()
      if (!from) continue
      targets.push({ table: from[1], columns: m[1].split(',').map((c) => c.trim()).sort().join(','), file })
    }
  }
  return targets
}

describe('upsert conflict targets', () => {
  it('finds the upserts it is meant to guard', () => {
    expect(upsertTargets().length).toBeGreaterThan(40)
  })

  it('each target has a matching non-partial unique index in the schema', () => {
    const sets = uniqueColumnSets()
    const missing = upsertTargets()
      .filter((t) => sets.has(t.table) || schema.includes(`CREATE TABLE public.${t.table} (`))
      .filter((t) => !sets.get(t.table)?.has(t.columns))
      .filter((t) => !KNOWN_DRIFT.has(`${t.table}(${t.columns})`))
      .map((t) => `${t.table}(${t.columns}) in ${t.file}`)
    expect(missing).toEqual([])
  })
})
