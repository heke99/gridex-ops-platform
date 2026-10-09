// Real ediel.se export (2026-10-09) against a fake grid_owners port seeded from
// the production grid_owners snapshot taken the same day (ids synthetic).
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'
import { parseActorRegistryTxt } from '@/lib/actor-registry/parseActorRegistryTxt'
import { carryForwardTxtRegistryFacts, decodeRegistryUpload } from '@/lib/actor-registry/importActorRegistry'
import { applyGridOwnerReconciliation, planGridOwnerReconciliation, type GridOwnerInsert, type GridOwnerPatch, type GridOwnerPort, type GridOwnerRow } from '@/lib/actor-registry/gridOwnerReconciliation'

const dir = '__tests__/fixtures/ediel-actor-registry/'
const xmlActors = parseActorRegistryXml(decodeRegistryUpload(readFileSync(dir + 'companies.xml'), 'companies_xml'))
const txtActors = parseActorRegistryTxt(decodeRegistryUpload(readFileSync(dir + 'companies.txt'), 'companies_txt'))
type SeedRow = GridOwnerRow & { manual_review_required: boolean; technical_owner_only: boolean; has_manual_channels: boolean }
const seed = (): SeedRow[] => JSON.parse(readFileSync(dir + 'grid-owners-2026-10-09.json', 'utf8'))

function fakePort(rows: Array<Record<string, unknown>>): GridOwnerPort & { rows: Array<Record<string, unknown>>; writes: number } {
  const port = {
    rows, writes: 0,
    async listGridOwners() { return structuredClone(rows) as unknown as GridOwnerRow[] },
    async updateGridOwner(id: string, expected: GridOwnerPatch, patch: GridOwnerPatch) {
      const row = rows.find(r => r.id === id)
      if (!row || Object.entries(expected).some(([k, v]) => (row[k] ?? null) !== (v ?? null))) return false
      Object.assign(row, patch); port.writes += 1; return true
    },
    async insertGridOwner(row: GridOwnerInsert) {
      const id = `00000000-0000-4000-a000-${String(rows.length + 1).padStart(12, '0')}`
      rows.push({ id, company_id: null, ...row }); port.writes += 1; return { id }
    },
  }
  return port
}
const byId = (rows: Array<Record<string, unknown>>, id: string) => rows.filter(r => r.ediel_id === id)
const protectedCols = (rows: Array<Record<string, unknown>>) => rows.map(r => [r.id, r.verified_for_customer_flow, r.manual_review_required, r.technical_owner_only, r.has_manual_channels, r.is_active])

describe('parsers on the real 2026-10-09 ediel.se export', () => {
  it('parses all 704 companies in both formats with identical identities and market split', () => {
    expect(xmlActors).toHaveLength(704); expect(txtActors).toHaveLength(704)
    const key = (a: { edielId?: string | null; market?: string | null; name: string }) => `${a.market}|${a.edielId}|${a.name}`
    expect(new Set(txtActors.map(key))).toEqual(new Set(xmlActors.map(key)))
    expect(xmlActors.filter(a => a.market === 'GAS')).toHaveLength(46)
    expect(xmlActors.filter(a => a.market === 'EL' && a.roles.includes('grid_owner'))).toHaveLength(175)
  })
  it('keeps Swedish characters, EIC, OrgNo, roles and PRODAT/UTILTS transport', () => {
    const alvesta = xmlActors.find(a => a.edielId === '16900' && a.market === 'EL')!
    expect(alvesta).toMatchObject({ name: 'Alvesta Elnät AB', orgNumber: '5565256210', eic: '46X000000000246I', countryCode: 'SE', roles: ['grid_owner'] })
    expect(alvesta.routes.map(r => [r.messageFamily, r.subaddress ?? null, r.communicationAddress])).toEqual([['PRODAT', null, '16900@kalmarenergi.se'], ['UTILTS', null, '16900@tvlab.se']])
    const fortum = xmlActors.find(a => a.edielId === '40900' && a.market === 'EL')!
    expect(fortum.roles).toEqual(['electricity_supplier', 'balance_responsible'])
    expect(xmlActors.find(a => a.edielId === '53200')).toMatchObject({ name: 'Coala AB', roles: ['grid_owner'], orgNumber: '5560934340' })
  })
  it('TXT: trims names, lower-cases SMTP like XML and drops transport-less family labels (was: whole apply aborted)', () => {
    expect(txtActors.every(a => a.name === a.name.trim() && !a.name.includes(' '))).toBe(true)
    const routes = txtActors.flatMap(a => a.routes)
    expect(routes.every(r => r.communicationAddress && r.partyId && r.interchangePartyId)).toBe(true)
    expect(routes.every(r => r.communicationAddress === r.communicationAddress!.toLowerCase())).toBe(true)
    const battery = txtActors.find(a => a.edielId === '92040')!
    expect(battery.routes.map(r => r.messageFamily)).toEqual(['UTILTS'])
    expect(battery.raw.diagnostics).toContain('declared_family_without_transport:PRODAT')
    // Overlapping PRODAT/UTILTS transport is identical in both formats.
    const wire = (a: typeof xmlActors[number]) => a.routes.filter(r => ['PRODAT', 'UTILTS'].includes(r.messageFamily)).map(r => [r.messageFamily, r.subaddress ?? null, r.communicationAddress, r.partyId, r.interchangePartyId]).sort().join('|')
    const xmlBy = new Map(xmlActors.map(a => [`${a.market}|${a.edielId}`, a]))
    const differing = txtActors.filter(a => a.edielId && wire(a) !== wire(xmlBy.get(`${a.market}|${a.edielId}`)!))
    expect(differing.map(a => a.edielId)).toEqual([])
  })
  it('TXT carry-forward keeps registered roles and OrgNo instead of replacing them with []', () => {
    const current = xmlActors.filter(a => a.edielId).map(a => ({ edielId: a.edielId, market: a.market, roles: a.roles, orgNumber: a.orgNumber, routes: a.routes as unknown as Array<Record<string, unknown>> }))
    const carried = carryForwardTxtRegistryFacts(txtActors, current)
    const alvesta = carried.find(a => a.edielId === '16900' && a.market === 'EL')!
    expect(alvesta).toMatchObject({ roles: ['grid_owner'], orgNumber: '5565256210' })
    expect(alvesta.raw.carriedForwardFromRegistry).toMatchObject({ roles: ['grid_owner'], orgNumber: '5565256210' })
    expect(alvesta.routes.map(r => [r.messageFamily, r.ediCharset, r.partyIdQualifier, r.communicationType, r.applicationReference ?? null])).toEqual([['PRODAT', 'UNOC', '160', 'SMTP', null], ['UTILTS', 'UNOC', 'SVK', 'SMTP', null]])
    expect(carryForwardTxtRegistryFacts(txtActors, [])).toEqual(txtActors)
  })
})

describe('grid_owners reconciliation with the real XML against the production snapshot', () => {
  it('updates, links, flags and creates without duplicates; second import is a no-op', async () => {
    const port = fakePort(seed())
    const protectedBefore = protectedCols(port.rows)
    const plan = planGridOwnerReconciliation({ actors: xmlActors, sourceKind: 'companies_xml', gridOwners: await port.listGridOwners() })
    if (process.env.GRID_OWNER_PLAN_DUMP) writeFileSync(process.env.GRID_OWNER_PLAN_DUMP, JSON.stringify(plan))
    const first = await applyGridOwnerReconciliation({ actors: xmlActors, sourceKind: 'companies_xml', port, expectedPlanSha256: plan.planSha256 })
    expect(first.staleSkipped).toEqual([])
    const rows = port.rows
    // no duplicate ediel ids / names
    const ids = rows.map(r => r.ediel_id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    // updates
    expect(byId(rows, '16900')[0]).toMatchObject({ communication_email: '16900@kalmarenergi.se' })
    expect(byId(rows, '11600')[0]).toMatchObject({ communication_email: 'ediel@edi.luleaenergi.se' })
    // Pre-existing duplicate row ('Trelleborg Elnät AB\r\n' without id) is flagged, never linked to 35400 twice.
    expect(byId(rows, '35400')).toHaveLength(1)
    expect(plan.flags).toContainEqual(expect.objectContaining({ code: 'name_match_ediel_id_taken', edielId: '35400' }))
    // No-id rows whose legal-form-insensitive name equals an already linked Netowner are duplicates for review.
    for (const id of ['17700', '18100', '14900', '17800']) expect(byId(rows, id)).toHaveLength(1)
    expect(plan.counts).toMatchObject({ updated: 4, created: 2, linked: 0 })
    expect(byId(rows, '16800')[0]).toMatchObject({ name: 'Fågelås Elnät AB' })
    expect(byId(rows, '16900')[0]).toMatchObject({ default_prodat_subaddress: null })
    expect(byId(rows, '16900')[0].org_number).toBe('556525-6210')
    // created exactly once, fail-closed
    for (const [id, name] of [['53200', 'Coala AB'], ['53100', 'Vindlänken Elnät AB']]) {
      expect(byId(rows, id)).toHaveLength(1)
      expect(byId(rows, id)[0]).toMatchObject({ name, verified_for_customer_flow: false, manual_review_required: true })
    }
    // wrong-role ids flagged, not relinked or rewritten
    for (const id of ['40900', '40100', '45310', '45510', '35300']) {
      expect(plan.flags).toContainEqual(expect.objectContaining({ code: 'ediel_id_role_mismatch', edielId: id }))
      expect(plan.updates.some(u => u.edielId === id)).toBe(false)
    }
    // not-in-file rows untouched
    for (const id of ['50400', '123456', '36880']) expect(plan.updates.some(u => u.edielId === id)).toBe(false)
    expect(plan.flags).toContainEqual(expect.objectContaining({ code: 'ediel_id_gas_market_only', edielId: '50400' }))
    // name links only for unambiguous Netowner names
    for (const link of plan.updates.filter(u => u.matchedBy !== 'ediel_id')) {
      const actor = xmlActors.find(a => a.edielId === link.edielId && a.market === 'EL')!
      expect(actor.roles).toContain('grid_owner')
    }
    // protected verification/manual columns never change
    expect(protectedCols(rows.slice(0, protectedBefore.length))).toEqual(protectedBefore)
    // idempotent
    const writes = port.writes
    const second = await applyGridOwnerReconciliation({ actors: xmlActors, sourceKind: 'companies_xml', port })
    expect(second).toMatchObject({ updated: 0, created: 0 }); expect(port.writes).toBe(writes)
    // TXT after XML: no org-number loss, no role-driven change, no creation
    const orgs = rows.map(r => [r.id, r.org_number])
    const knownRoles = new Map(xmlActors.filter(a => a.market === 'EL' && a.edielId).map(a => [a.edielId!, a.roles]))
    const txt = await applyGridOwnerReconciliation({ actors: txtActors, sourceKind: 'companies_txt', port, knownRoles })
    expect(txt).toMatchObject({ updated: 0, created: 0 })
    expect(rows.map(r => [r.id, r.org_number])).toEqual(orgs)
    const txtNoRoles = planGridOwnerReconciliation({ actors: txtActors, sourceKind: 'companies_txt', gridOwners: await port.listGridOwners() })
    expect(txtNoRoles.updates).toEqual([]); expect(txtNoRoles.creates).toEqual([])
  })
})
