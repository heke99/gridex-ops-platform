#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

const sqlFile = process.argv[2]
if (!sqlFile) {
  console.error('Usage: node scripts/run-tenant-sql.mjs <sql-file>')
  process.exit(2)
}

const loaded = {
  ...parseEnvFile(resolve('.env')),
  ...parseEnvFile(resolve('.env.local')),
}
const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  loaded.DATABASE_URL ||
  loaded.SUPABASE_DB_URL ||
  loaded.POSTGRES_URL_NON_POOLING ||
  loaded.POSTGRES_URL

if (!databaseUrl) {
  console.error([
    'DATABASE_URL saknas.',
    'Lägg Supabase/PostgreSQL-anslutningen i shell-miljön eller i .env.local, exempel:',
    'DATABASE_URL="postgresql://.../postgres?sslmode=require"',
    'Ingen lokal PostgreSQL-anslutning försöktes.',
  ].join('\n'))
  process.exit(2)
}

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  console.error('DATABASE_URL måste vara en postgresql://- eller postgres://-URL.')
  process.exit(2)
}

const result = spawnSync(
  'psql',
  [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlFile],
  { stdio: 'inherit', env: process.env },
)

if (result.error?.code === 'ENOENT') {
  console.error('psql hittades inte. Installera PostgreSQL-klienten och kör igen.')
  process.exit(127)
}
if (result.error) {
  console.error(`Kunde inte starta psql: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
