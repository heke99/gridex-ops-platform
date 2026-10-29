// SQL access for the T4 runner through psql (no pg driver is installed in node_modules).
// Reads and fixture writes go straight to the T4 database on 127.0.0.1:54322 only.
import { execFile } from 'node:child_process'

/** SQL string literal. null/undefined -> NULL, objects -> JSON text. */
export function lit(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `'${text.replaceAll("'", "''")}'`
}

export class SqlError extends Error {
  constructor(message, code, stderr) {
    super(message)
    this.name = 'SqlError'
    this.code = code
    this.stderr = stderr
  }
}

export function createSql(dbUrl) {
  if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(dbUrl)) throw new Error('T4 sql helper only talks to a loopback database')
  const psql = (query, extra = []) =>
    new Promise((resolve, reject) => {
      execFile('psql', [dbUrl, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...extra, '-c', query],
        { maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PGOPTIONS: process.env.T4_PGOPTIONS ?? '' } },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout)
          const match = /ERROR:\s+([0-9A-Z]{5}):\s*(.*)/.exec(stderr)
          reject(new SqlError(match ? match[2] : stderr.trim(), match ? match[1] : null, stderr))
        })
    })
  return {
    /** Execute statements (single implicit transaction); returns raw stdout. */
    exec: (query) => psql(query),
    /** Rows of a SELECT as an array of objects. */
    async rows(query) {
      const out = await psql(`select coalesce(json_agg(t),'[]'::json) from (${query}) t`)
      return JSON.parse(out.trim() || '[]')
    },
    async one(query) {
      const rows = await this.rows(query)
      return rows[0] ?? null
    },
    async scalar(query) {
      const row = await this.one(query)
      return row ? Object.values(row)[0] : null
    },
    /** Like exec, but resolves with {ok, code, message} instead of throwing (for negative probes). */
    async attempt(query) {
      try { await psql(query); return { ok: true, code: null, message: null } }
      catch (error) { return { ok: false, code: error.code ?? null, message: error.message } }
    },
  }
}
