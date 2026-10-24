import { describe, expect, it, vi } from 'vitest'

import { fieldRulesForMessage, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { normalizeRegistryRequirement } from '@/lib/ediel/rulebook/fieldRuleRegistry'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { s01L359AggregateWire } from '../scripts/helpers/utiltsS01AggregateFixture'

const PLANNING_MATRIX = {
  S02: {
    '505': 'required', '209': 'required', '260a': 'required', '262': 'forbidden',
    '510': 'forbidden', '506': 'required', '511': 'forbidden', '245': 'required',
    '532': 'required', '508': 'required', '223': 'required', '264': 'required',
    '226': 'optional', '254': 'forbidden', '513': 'forbidden', '507a': 'forbidden',
    '514': 'required', '515': 'required', '520': 'dependent', '507b': 'forbidden',
  },
  S03: {
    '505': 'required', '209': 'forbidden', '260a': 'required', '262': 'dependent',
    '510': 'dependent', '506': 'required', '511': 'required', '245': 'required',
    '532': 'required', '508': 'required', '223': 'required', '264': 'required',
    '226': 'forbidden', '254': 'required', '513': 'required', '507a': 'dependent',
    '514': 'required', '515': 'required', '520': 'forbidden', '507b': 'dependent',
  },
  S04: {
    '505': 'required', '209': 'forbidden', '260a': 'required', '262': 'dependent',
    '510': 'forbidden', '506': 'required', '511': 'required', '245': 'required',
    '532': 'required', '508': 'required', '223': 'required', '264': 'required',
    '226': 'forbidden', '254': 'forbidden', '513': 'forbidden', '507a': 'forbidden',
    '514': 'required', '515': 'required', '520': 'forbidden', '507b': 'forbidden',
  },
} as const

const HEADER_FIELDS = ['311', '312', '202', '203', '204', '313', '205', '206', '501', '502', '207', '208', '509']

// Independent oracle: Swedish original b76a…, p54 field209 is “–” for S01.
// The C3 native S01 fixture retains this E66 LOC+172; keep it as a negative,
// never as proof of a supported aggregate or bilateral business capability.
const U5_POINT_FORBIDDEN = 'UTILTS_FIELD_209_FORBIDDEN'
const U5_PRIMARY_ORIGINAL = 'b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2'
const U5_ADMISSION = '2026-10-20T20:00:00Z'

function pointGuideSource(code: 'E66' | 'S01'): EdielMessageRow {
  const source = energyHandoffMessage('2026-10-20', '11111111-1111-4111-8111-111111111111')
  if (code === 'E66') return source
  // Same physical transformation as consumption-native511–521. Other guide
  // defects may remain; this regression specifically requires field209.
  const lines = source.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace('DTM+597:202607010020:203', 'DTM+368:202607010020:203')
    .split('\n').filter(line => !line.startsWith('DTM+597:'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  return { ...source, message_code: 'S01', application_reference: '23-DDK-S01-S',
    customer_id: null, site_id: null, metering_point_id: null, raw_payload: lines.join('\n') }
}

function mixedPointGuideSource(pointFirst: boolean): EdielMessageRow {
  const source = pointGuideSource('S01'), lines = source.raw_payload!.split('\n')
  const first = lines.findIndex(line => line.startsWith('IDE+24+'))
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const point = lines.slice(first, unt).map(line => line.replaceAll('GRIDEX2607E66001', 'U5-POINT'))
  const other = point.filter(line => !line.startsWith('LOC+172+')).map(line => line.replaceAll('U5-POINT', 'U5-OTHER'))
  const rebuilt = [...lines.slice(0, first), ...(pointFirst ? [...point, ...other] : [...other, ...point]), ...lines.slice(unt)]
  const unh = rebuilt.findIndex(line => line.startsWith('UNH+'))
  const last = rebuilt.findIndex(line => line.startsWith('UNT+'))
  rebuilt[last] = `UNT+${last - unh + 1}+1'`
  return { ...source, raw_payload: rebuilt.join('\n') }
}

async function actualPointGuideProbe(source: EdielMessageRow) {
  const [{ resolveCanonicalEdielPolicy }, { validateRulebookMessage }, { runUtiltsRuntimeForMessage }] = await Promise.all([
    import('@/lib/ediel/rulebook/canonicalEdielPolicy'),
    import('@/lib/ediel/rulebook/validator'),
    import('@/lib/ediel/utiltsEngine'),
  ])
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: source.message_code!, direction: 'inbound',
    referenceDate: '2026-10-20', applicationReference: source.application_reference, mode: 'parse' })
  const whole = validateRulebookMessage({ family: 'UTILTS', code: source.message_code!, direction: 'inbound', mode: 'parse',
    rawPayload: source.raw_payload!, applicationReference: source.application_reference, admissionAt: U5_ADMISSION,
    companyId: source.company_id, environment: source.environment, messageRow: source })
  const guideOnly = runUtiltsRuntimeForMessage(source, { canonicalPolicy: policy, guideOnly: true })
  const full = runUtiltsRuntimeForMessage(source, { canonicalPolicy: policy })
  const observed = JSON.stringify({ raw: source.raw_payload, selectedGuide: policy.guide.guideRevision,
    publicPolicy: whole.canonicalPolicy?.guide.guideRevision, publicIssues: whole.issues,
    guideValidation: guideOnly.validation, guideDispositions: guideOnly.transactionDispositions,
    fullValidation: full.validation, fullDispositions: full.transactionDispositions })
  return { source, policy, whole, guideOnly, full, observed }
}

describe('Swedish U5 S01 field209 actual entrypoints', () => {
  it.each(['MG', 'SE'])('projects received %s text for every actual negative field before APERAK rendering', async qualifier => {
    const source = observationHandoffMessage('2026-10-20', '11111111-1111-4111-8111-111111111111')
    source.message_code = 'S01'; source.application_reference = '23-DDK-S01-S'
    source.raw_payload = source.raw_payload!.replace('BGM+E66::260', 'BGM+S01:SVK:260')
      .replace('23-DDQ-E66-S', '23-DDK-S01-S')
      .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000008::9')
      .replace('RFF+MG:', `RFF+${qualifier}:`)
    const probe = await actualPointGuideProbe(source)
    const { isUtiltsAperakSourceText } = await import('@/lib/ediel/utilts/aperakSourceText')
    expect(probe.full.ackPlan.aperakApplicationErrors).toContainEqual(expect.objectContaining({
      ercCode: '42', fieldCode: '224', text: 'INCORRECT DATA M-GRIDEX-2607-01',
      referenceNumber: 'GRIDEX2607E66001',
    }))
    for (const error of probe.full.ackPlan.aperakApplicationErrors) {
      expect(isUtiltsAperakSourceText(error.ercCode, error.text), JSON.stringify(error)).toBe(true)
    }
  })

  it('executes the selected E66 forbidden latest-update field through public and runtime entrypoints', async () => {
    const source = pointGuideSource('E66')
    const lines = source.raw_payload!.replace("DTM+597:202607010020:203'", "DTM+597:202607010020:203'\nDTM+368:202607010020:203'").split('\n')
    const unh = lines.findIndex(line => line.startsWith('UNH+')), unt = lines.findIndex(line => line.startsWith('UNT+'))
    lines[unt] = `UNT+${unt - unh + 1}+1'`
    source.raw_payload = lines.join('\n')
    const probe = await actualPointGuideProbe(source)
    expect(probe.full.validation.syntaxOk, probe.observed).toBe(true)
    expect(probe.whole.issues, probe.observed).toContainEqual(expect.objectContaining({ code: 'UTILTS_FIELD_532_FORBIDDEN' }))
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.validation.issues, probe.observed).toContainEqual(expect.objectContaining({ code: 'UTILTS_FIELD_532_FORBIDDEN', aperakFieldCode: '532', referenceNumber: 'GRIDEX2607E66001' }))
      expect(runtime.transactionDispositions, probe.observed).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
    }
  })

  it('executes the selected required S01 time-series-product component without borrowing its segment', async () => {
    const probe = await actualPointGuideProbe(pointGuideSource('S01'))
    expect(probe.whole.issues, probe.observed).toContainEqual(expect.objectContaining({ code: 'UTILTS_FIELD_511_MISSING' }))
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.validation.issues, probe.observed).toContainEqual(expect.objectContaining({ code: 'UTILTS_FIELD_511_MISSING', aperakFieldCode: '511', referenceNumber: 'GRIDEX2607E66001' }))
    }
  })

  it('the public whole-guide entrypoint rejects the actual supplied forbidden field', async () => {
    const probe = await actualPointGuideProbe(pointGuideSource('S01'))
    // These must pass before a missing209 diagnostic counts as meaningful RED:
    // a source/registry/import hold is not the behavior under test.
    expect(probe.whole.canonicalPolicy?.code, probe.observed).toBe('S01')
    expect(probe.whole.canonicalPolicy?.guide.guideRevision, probe.observed).toBe('25-A-5')
    expect(probe.whole.canonicalPolicy?.guide.primarySource?.sha256, probe.observed).toBe(U5_PRIMARY_ORIGINAL)
    const original = probe.whole.canonicalPolicy?.fieldRules.find(rule => 'fieldNo' in rule && rule.fieldNo === '209')
    expect(original && 'requirements' in original ? original.requirements.S01 : null, probe.observed).toBe('X')
    expect(probe.whole.issues.some(issue => issue.code === U5_POINT_FORBIDDEN && issue.fieldPath?.includes('LOC+172')), probe.observed).toBe(true)
    expect(probe.whole.blocking, probe.observed).toBe(true)
  })

  it.each(['guideOnly', 'full'] as const)('the real %s engine rejects the same physical S01 field209', async entrypoint => {
    const probe = await actualPointGuideProbe(pointGuideSource('S01')), runtime = probe[entrypoint]
    expect(probe.policy.guide.guideRevision, probe.observed).toBe('25-A-5')
    expect(runtime.validation.issues.filter(issue => issue.code === U5_POINT_FORBIDDEN), probe.observed)
      .toMatchObject([{ kind: 'application', aperakFieldCode: '209', referenceNumber: 'GRIDEX2607E66001' }])
    expect(runtime.transactionDispositions, probe.observed).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
    expect(runtime.ackPlan.aperakOutcome, probe.observed).not.toBe('positive')
  })

  it.each([true, false])('attributes field209 only to its own physical IDE, point-first=%s', async pointFirst => {
    const probe = await actualPointGuideProbe(mixedPointGuideSource(pointFirst))
    for (const runtime of [probe.guideOnly, probe.full]) {
      const own = runtime.validation.issues.filter(issue => issue.code === U5_POINT_FORBIDDEN)
      expect(own.map(issue => issue.referenceNumber), probe.observed).toEqual(['U5-POINT'])
      expect(runtime.transactionDispositions.find(item => item.transactionId === 'U5-POINT'), probe.observed)
        .toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
      expect(own.some(issue => issue.referenceNumber === 'U5-OTHER'), probe.observed).toBe(false)
    }
    // No claim that the other S01 IDE has qualified product/area/object authority.
  })

  it('preserves original diagnostic quantities but consumes none for the rejected IDE', async () => {
    const probe = await actualPointGuideProbe(pointGuideSource('S01'))
    const { buildUtiltsTransactionPersistencePayload } = await import('@/lib/ediel/utilts/transactionPersistence')
    const { prepareUtiltsConsumptionContracts } = await import('@/lib/ediel/utilts/consumptionPreparation')
    expect(probe.guideOnly.facts.transactions[0].quantities.length, probe.observed).toBeGreaterThan(0)
    const payload = buildUtiltsTransactionPersistencePayload({ messageCode: 'S01', transactions: probe.guideOnly.facts.transactions,
      dispositions: probe.guideOnly.transactionDispositions, matches: [] })
    // This transport payload retains received diagnostics. Economic authority
    // belongs to the actual consumption projection and negative disposition.
    expect(payload[0], probe.observed).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak',
      quantities: [{ qualifier: '136', value: 500, raw: 'QTY+136:500' }] })
    const contracts = await prepareUtiltsConsumptionContracts({ message: probe.source, runtime: probe.full, policy: probe.policy,
      matches: [], dataRequest: null, fallback: { customerId: null, siteId: null, meteringPointId: null, gridOwnerId: null },
      // Even a caller requesting consumption cannot promote a rejected IDE.
      allowConsumption: true })
    expect(probe.full.transactionDispositions.filter(item => item.disposition === 'accepted'), probe.observed).toEqual([])
    expect(contracts, probe.observed).toMatchObject([{ observations: [], metering: { capability: 'skip' },
      billing: { capability: 'skip' }, billingContributionOrdinals: [], interpretation: { timestampPolicy: 'no-consumption-v1' } }])
    expect(probe.source.raw_payload, probe.observed).toContain('QTY+136:500')
  })

  it('retains the actual E66 LOC172 guide control without a forbidden209 finding', async () => {
    const probe = await actualPointGuideProbe(pointGuideSource('E66'))
    expect(probe.whole.canonicalPolicy?.guide.guideRevision, probe.observed).toBe('25-A-5')
    expect(probe.whole.ok, probe.observed).toBe(true)
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.validation.issues.some(issue => issue.code === U5_POINT_FORBIDDEN), probe.observed).toBe(false)
      expect(runtime.validation.ok, probe.observed).toBe(true)
    }
  })

  it('does not turn E66 conditional LOC175 into a forbidden or required LOC172', async () => {
    const source = pointGuideSource('E66')
    source.raw_payload = source.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9')
    const probe = await actualPointGuideProbe(source)
    expect(probe.whole.canonicalPolicy?.code, probe.observed).toBe('E66')
    expect(probe.whole.issues.some(issue => issue.code === U5_POINT_FORBIDDEN), probe.observed).toBe(false)
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.validation.issues.some(issue => issue.code === U5_POINT_FORBIDDEN || issue.code === 'UTILTS_METERING_POINT_ID_MISSING'), probe.observed).toBe(false)
    }
    // Pure guide qualification does not approve the object's business owner.
  })
})

describe('S01 source-qualified product conditions actual entrypoints', () => {
  function sourceForProduct(unknownFirst?: boolean): EdielMessageRow {
    const original = pointGuideSource('E66')
    const ids = unknownFirst === undefined ? ['PRODUCT-OWN'] : unknownFirst ? ['PRODUCT-UNKNOWN', 'PRODUCT-CLEAN'] : ['PRODUCT-CLEAN', 'PRODUCT-UNKNOWN']
    const raw = s01L359AggregateWire(original.raw_payload!, ids.map(transactionId => ({ transactionId, latestUpdateDate: '202607010040', quantity: '500' })))
    let own = ''
    return { ...original, message_code: 'S01', application_reference: '23-DDK-S01-S', customer_id: null, site_id: null, metering_point_id: null,
      raw_payload: raw.split('\n').map(line => {
        if (line.startsWith('IDE+24+')) own = line
        return own.includes('PRODUCT-UNKNOWN') ? line.replace('Z02:OT', 'X50:OT') : line
      }).join('\n') }
  }
  function wireChange(source: EdielMessageRow, change: (lines: string[]) => string[]): EdielMessageRow {
    const lines = change(source.raw_payload!.split('\n')).flatMap(line => line.split('\n'))
    const unh = lines.findIndex(line => line.startsWith('UNH+')), unt = lines.findIndex(line => line.startsWith('UNT+'))
    lines[unt] = `UNT+${unt - unh + 1}+1'`
    return { ...source, raw_payload: lines.join('\n') }
  }
  it('keeps the source-qualified L359 monthly energy transaction accepted', async () => {
    const probe = await actualPointGuideProbe(sourceForProduct())
    expect(probe.whole.ok, probe.observed).toBe(true)
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.validation.ok, probe.observed).toBe(true)
      expect(runtime.transactionDispositions, probe.observed).toMatchObject([{ transactionId: 'PRODUCT-OWN', disposition: 'accepted', responseType: 'positive_aperak' }])
    }
  })
  it.each([['260a', 'LOC+239+'], ['264', 'MEA+']] as const)('rejects missing L359 field%s through public and both real runtimes', async (field, prefix) => {
    const probe = await actualPointGuideProbe(wireChange(sourceForProduct(), lines => lines.filter(line => !line.startsWith(prefix))))
    expect(probe.whole.issues, probe.observed).toContainEqual(expect.objectContaining({ code: `UTILTS_FIELD_${field}_MISSING`, blocking: true }))
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.validation.issues, probe.observed).toContainEqual(expect.objectContaining({ code: `UTILTS_FIELD_${field}_MISSING`, aperakErcCode: '41', aperakFieldCode: field }))
      expect(runtime.transactionDispositions, probe.observed).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
    }
  })
  it.each(['absent', 'blank-first', 'missing-last', 'reordered'] as const)('preserves source-level missing/invalid PIA distinction: %s', async defect => {
    const source = wireChange(sourceForProduct(), lines => defect === 'absent' ? lines.filter(line => !line.startsWith('PIA+')) : lines.map(line => {
      if (!line.startsWith('PIA+')) return line
      if (defect === 'blank-first') return line.replace('Z04:PC', ':PC')
      if (defect === 'missing-last') return line.replace('+Z05:BAP:SVK:260', '')
      return line.replace('Z04:PC:SVK:260+U46:PT:SVK:260', 'U46:PT:SVK:260+Z04:PC:SVK:260')
    }))
    const probe = await actualPointGuideProbe(source)
    const field = defect === 'blank-first' ? '511a' : defect === 'missing-last' ? '511e' : '511'
    const kind = defect === 'reordered' ? 'INVALID' : 'MISSING'
    expect(probe.whole.issues.filter(issue => issue.code === `UTILTS_FIELD_${field}_${kind}`), probe.observed).toHaveLength(1)
    for (const runtime of [probe.guideOnly, probe.full]) {
      const issues = runtime.validation.issues.filter(issue => issue.code.startsWith('UTILTS_FIELD_511'))
      expect(issues, probe.observed).toMatchObject([{ code: `UTILTS_FIELD_${field}_${kind}`, aperakFieldCode: field, aperakErcCode: kind === 'MISSING' ? '41' : '42' }])
      expect(issues, probe.observed).toHaveLength(1)
      expect(runtime.transactionDispositions[0], probe.observed).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
    }
  })
  it('holds an otherwise well-shaped unknown five-part product without a fabricated national negative', async () => {
    const message = wireChange(sourceForProduct(), lines => lines.map(line => line.replace('Z02:OT', 'X50:OT')))
    const probe = await actualPointGuideProbe(message)
    expect(probe.whole.blocking, probe.observed).toBe(true)
    expect(probe.whole.issues, probe.observed).toContainEqual(expect.objectContaining({ code: 'UTILTS_PRODUCT_CONDITIONS_UNAVAILABLE', severity: 'warning', blocking: true }))
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.transactionDispositions, probe.observed).toMatchObject([{ disposition: 'internal_review', responseType: 'none' }])
      expect(runtime.validation.ok, probe.observed).toBe(false)
      expect(runtime.validation.issues.some(issue => issue.severity === 'error'), probe.observed).toBe(false)
      expect(runtime.ackPlan, probe.observed).toMatchObject({ shouldSendAperak: false, aperakOutcome: null, shouldSendUtiltsErr: false })
    }
  })
  it.each([true, false])('keeps unknown product held while a physical clean sibling reaches full functional processing, unknown-first=%s', async unknownFirst => {
    const probe = await actualPointGuideProbe(sourceForProduct(unknownFirst))
    for (const runtime of [probe.guideOnly, probe.full]) {
      const expected = unknownFirst ? ['internal_review', 'accepted'] : ['accepted', 'internal_review']
      expect(runtime.transactionDispositions.map(item => item.disposition), probe.observed).toEqual(expected)
      expect(runtime.transactionDispositions.find(item => item.transactionId === 'PRODUCT-UNKNOWN'), probe.observed).toMatchObject({ responseType: 'none' })
      expect(runtime.transactionDispositions.find(item => item.transactionId === 'PRODUCT-CLEAN'), probe.observed).toMatchObject({ responseType: 'positive_aperak' })
      expect(runtime.validation.issues.some(issue => issue.severity === 'error'), probe.observed).toBe(false)
    }
  })
  it('retains a true raw-X rejection even when that transaction also has an unknown product', async () => {
    const source = wireChange(sourceForProduct(), lines => lines.map(line => line.startsWith('IDE+24+') ? `${line}\nLOC+172+735999260731000007::9'` : line.replace('Z02:OT', 'X50:OT')))
    const probe = await actualPointGuideProbe(source)
    for (const runtime of [probe.guideOnly, probe.full]) {
      expect(runtime.transactionDispositions[0], probe.observed).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
      expect(runtime.validation.issues, probe.observed).toContainEqual(expect.objectContaining({ code: 'UTILTS_FIELD_209_FORBIDDEN', aperakErcCode: '42', aperakFieldCode: '209' }))
    }
  })
  it.each([true, false])('restores the physical unknown HOLD after a real eligible-sibling functional rejection rebuild, unknown-first=%s', async unknownFirst => {
    const source = wireChange(sourceForProduct(unknownFirst), lines => {
      let clean = false
      return lines.map(line => {
        if (line.startsWith('IDE+24+')) clean = line.includes('PRODUCT-CLEAN')
        return clean ? line.replace('QTY+136:500', 'QTY+136:500.5') : line
      })
    })
    const probe = await actualPointGuideProbe(source)
    expect(probe.guideOnly.transactionDispositions.find(item => item.transactionId === 'PRODUCT-CLEAN'), probe.observed).toMatchObject({ disposition: 'accepted' })
    expect(probe.full.validation.issues, probe.observed).toContainEqual(expect.objectContaining({ kind: 'functional', code: 'UTILTS_QUANTITY_PRECISION_INVALID', referenceNumber: 'PRODUCT-CLEAN' }))
    expect(probe.full.transactionDispositions.find(item => item.transactionId === 'PRODUCT-CLEAN'), probe.observed).toMatchObject({ disposition: 'processability_rejected', responseType: 'utilts_err' })
    expect(probe.full.transactionDispositions.find(item => item.transactionId === 'PRODUCT-UNKNOWN'), probe.observed).toMatchObject({ disposition: 'internal_review', responseType: 'none' })
    expect(probe.full.validation.issues.some(issue => issue.kind === 'functional' && issue.referenceNumber === 'PRODUCT-UNKNOWN'), probe.observed).toBe(false)
  })
})

describe('UTILTS 25-A-3 canonical field registry', () => {
  it('keeps the published base requirement in the first current-guide policy after an attempted change', async () => {
    vi.resetModules()
    const { UTILTS_25_A_3_FIELD_RULES } = await import('@/lib/ediel/rulebook/utiltsFieldMatrix')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const row = UTILTS_25_A_3_FIELD_RULES.find((candidate) => candidate.ruleKey === '311_application_reference')!
    const changed = Reflect.set(row.requirements, 'E73', 'X')
    try {
      const policy = resolveCanonicalEdielPolicy({
        family: 'UTILTS', messageCode: 'E73', direction: 'outbound', referenceDate: '2026-10-15',
        applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence',
      })
      expect(policy.guide.guideRevision).toBe('25-A-5')
      const selected = policy.fieldRules.find((rule) => 'ruleKey' in rule && rule.ruleKey === '311_application_reference')
      expect(selected && 'requirements' in selected ? selected.requirements.E73 : null).toBe('R')
      expect(changed).toBe(false)
    } finally {
      // A broken source can be frozen by the first policy; discard that isolated graph.
      vi.resetModules()
    }
  })

  it('keeps the source field selected after an attempted published row replacement', async () => {
    vi.resetModules()
    const { UTILTS_25_A_3_FIELD_RULES, getUtiltsFieldRequirement } = await import('@/lib/ediel/rulebook/utiltsFieldMatrix')
    const original = UTILTS_25_A_3_FIELD_RULES[0]
    const changed = Reflect.set(UTILTS_25_A_3_FIELD_RULES, '0', { ...original, fieldNo: '999' })
    try {
      expect(getUtiltsFieldRequirement('E73', '311')).toBe('R')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(UTILTS_25_A_3_FIELD_RULES, '0', original)
      vi.resetModules()
    }
  })

  it('keeps the published source locator after an attempted row-metadata change', async () => {
    vi.resetModules()
    const { UTILTS_25_A_3_FIELD_RULES, getUtiltsFieldRules } = await import('@/lib/ediel/rulebook/utiltsFieldMatrix')
    const row = UTILTS_25_A_3_FIELD_RULES.find((candidate) => candidate.ruleKey === '311_application_reference')!
    const original = row.segmentPath
    const changed = Reflect.set(row, 'segmentPath', 'NAD+UD')
    try {
      expect(getUtiltsFieldRules('E73').find((rule) => rule.ruleKey === '311_application_reference')?.segmentPath).toBe('UNB/0026')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(row, 'segmentPath', original)
      vi.resetModules()
    }
  })

  it('maps the exact R/D/O/X classifications from the database registry', () => {
    expect(['R', 'D', 'O', 'X'].map(normalizeRegistryRequirement)).toEqual([
      'required', 'dependent', 'optional', 'forbidden',
    ])
  })

  it.each(Object.entries(PLANNING_MATRIX))('implements the exact %s planning matrix', (code, expected) => {
    const planningRules = fieldRulesForMessage('UTILTS', code)
      .filter((rule) => rule.scope === 'transaction')
    const actual = Object.fromEntries(planningRules.map((rule) => [rule.fieldNumber, rule.requirement]))

    expect(actual).toEqual(expected)
    expect(planningRules).toHaveLength(20)
  })

  it.each(['S02', 'S03', 'S04'])('uses the exact common header for %s', (code) => {
    const headerRules = fieldRulesForMessage('UTILTS', code)
      .filter((rule) => rule.scope === 'header')

    expect(headerRules.map((rule) => rule.fieldNumber)).toEqual(HEADER_FIELDS)
    expect(headerRules.every((rule) => rule.requirement === 'required')).toBe(true)
    expect(headerRules.find((rule) => rule.fieldNumber === '312')?.allowedValues).toEqual(['E5SE5A'])
    expect(headerRules.find((rule) => rule.fieldNumber === '204')?.allowedValues).toEqual(['5', '9'])
    expect(headerRules.find((rule) => rule.fieldNumber === '313')?.allowedValues).toEqual(['AB', 'NA'])
    expect(headerRules.find((rule) => rule.fieldNumber === '501')?.allowedValues).toEqual(['23', '27'])
    expect(headerRules.find((rule) => rule.fieldNumber === '502')?.allowedValues).toEqual(['E02', 'E03', 'E04'])
  })

  it('validates header values at their exact EDIFACT element paths', () => {
    const headerRules = fieldRulesForMessage('UTILTS', 'S02').filter((rule) => rule.scope === 'header')
    const validSegments = [
      'UNB+UNOC:3+SENDER+RECEIVER+260813:1200+INTREF++23-DDQ-S02-S',
      'UNH+MSG1+UTILTS:D:02B:UN:E5SE5A',
      'BGM+S02+DOC1+9+AB',
      'DTM+137:202608131200:203', 'DTM+735:+0100:406', 'MKS+23+E02::260',
      'NAD+MS+SENDER:SVK:260', 'NAD+MR+RECEIVER:SVK:260', 'NAD+DDQ+SUPPLIER:SVK:260',
    ]

    expect(validateFieldMatrixPayload({
      family: 'UTILTS', code: 'S02', rawSegments: validSegments,
      applicationReference: '23-DDQ-S02-S', mode: 'parse',
    }, headerRules)).toEqual([])

    const invalidAssociation = validSegments.map((segment) =>
      segment.startsWith('UNH+') ? 'UNH+MSG1+UTILTS:D:02B:UN:WRONG' : segment
    )
    expect(validateFieldMatrixPayload({
      family: 'UTILTS', code: 'S02', rawSegments: invalidAssociation,
      applicationReference: '23-DDQ-S02-S', mode: 'parse',
    }, headerRules).map((issue) => issue.code)).toContain('UTILTS_ASSOCIATION_INVALID')
  })
})
