'use strict'

const { randomBytes } = require('node:crypto')
// Deterministic comparison marker. Restores use a fresh random key instead.
const RESTRICT_TOKEN = 'gridexCanonicalSchemaSnapshot'

function boundaries(dump) {
  if (typeof dump !== 'string') throw new TypeError('schema dump must be text')
  const lines = dump.split('\n')
  let firstSql = 0
  while (firstSql < lines.length && (
    /^\s*$/.test(lines[firstSql]) || /^--/.test(lines[firstSql]) ||
    /^\\restrict\s+\S+$/.test(lines[firstSql])
  )) firstSql++
  const openings = lines.slice(0, firstSql).flatMap((line, i) => /^\\restrict\s+\S+$/.test(line) ? [i] : [])
  let lastContent = lines.length - 1
  while (lastContent >= 0 && (/^\s*$/.test(lines[lastContent]) || /^--/.test(lines[lastContent]))) lastContent--
  const closing = lastContent >= firstSql && /^\\unrestrict\s+\S+$/.test(lines[lastContent]) ? lastContent : null
  if (openings.length > 1 || (openings.length === 1) !== (closing !== null)) {
    throw new Error('schema dump restriction guard is incomplete')
  }
  const opening = openings[0] ?? null
  if (opening !== null && lines[opening].split(/\s+/)[1] !== lines[closing].split(/\s+/)[1]) {
    throw new Error('schema dump restriction keys disagree')
  }
  return { lines, firstSql, opening, closing }
}

function normalizeDump(dump) {
  const { lines, firstSql, opening, closing } = boundaries(dump)
  // Only pg_dump's leading metadata and its two outer guards may change.
  // In particular, repeated blank lines or banner-looking text inside SQL
  // function bodies and dollar-quoted string literals must remain byte-exact.
  return lines.flatMap((line, index) => {
    if (index < firstSql && /^-- Dumped (from database version|by pg_dump version)/.test(line)) return []
    if (index === opening) return [`\\restrict ${RESTRICT_TOKEN}`]
    if (index === closing) return [`\\unrestrict ${RESTRICT_TOKEN}`]
    return [line]
  }).join('\n').replace(/\n*$/, '\n')
}

function prepareRestore(dump) {
  const { lines, opening, closing } = boundaries(dump)
  if (opening === null) throw new Error('restricted schema restore requires outer guards')
  const token = randomBytes(32).toString('hex')
  lines[opening] = `\\restrict ${token}`
  lines[closing] = `\\unrestrict ${token}`
  return lines.join('\n')
}

module.exports = { normalizeDump, prepareRestore, RESTRICT_TOKEN }
