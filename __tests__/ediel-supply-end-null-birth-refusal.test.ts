import {describe, expect, it} from 'vitest'
import {isSupplyEndProfileResolutionRefusal} from '../scripts/helpers/ediel-supply-end-null-birth-refusal'

// Finite diagnostic component only; no whole masterplan approval tags.
const tag = '[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message'
const date = '2026-10-07'
const message = (count: string) => `canonical_inbound_rule_profile_resolution_failed:PRODAT:Z05:${date}:${count}`

describe('same-call H05 database profile refusal diagnostic', () => {
  it.each(['0', '2', '10'])('recognizes exact SQL23514 with nonunique match count %s', count => {
    expect(isSupplyEndProfileResolutionRefusal([tag, {code: '23514', message: message(count)}], date)).toBe(true)
  })

  it.each(['1', '-1', '+2', '02', '2.0', '2 extra', '2\n', '2:extra', ''])('refuses count %j', count => {
    expect(isSupplyEndProfileResolutionRefusal([tag, {code: '23514', message: message(count)}], date)).toBe(false)
  })

  it.each([
    [], [tag], [tag, null], ['unrelated warning', {code: '23514', message: message('0')}],
    [tag, {code: '23505', message: message('0')}], [tag, {code: 23514, message: message('0')}],
    [tag, {code: '23514', message: message('0').replace('PRODAT', 'UTILTS')}],
    [tag, {code: '23514', message: message('0').replace('Z05', 'Z04')}],
    [tag, {code: '23514', message: message('0').replace(date, '2026-10-08')}],
    [tag, {code: '23514', message: 'unrelated_sql_constraint'}],
    [tag, {code: '23514', message: 'prefix:' + message('0')}],
    [tag, {code: '23514', message: message('0')}, 'unrelated extra argument'],
  ].map(warning => ({warning})))('refuses unrelated, malformed or differently scoped warning %#', ({warning}) => {
    expect(isSupplyEndProfileResolutionRefusal(warning, date)).toBe(false)
  })

  it('does not invoke coercion or accessors to recognize a refusal', () => {
    let reads = 0
    const unsafe = {toString() {reads++; throw Error('must not coerce')}}
    const accessor = {get code() {reads++; return '23514'}, get message() {reads++; return message('0')}}
    expect(isSupplyEndProfileResolutionRefusal([tag, {code: unsafe, message: unsafe}], date)).toBe(false)
    expect(isSupplyEndProfileResolutionRefusal([tag, accessor], date)).toBe(false)
    expect(reads).toBe(0)
  })

  it.each(['', '2026-10-07:0', '2026-10-07\n'])('refuses an invalid receipt date %j', effectiveDate => {
    expect(isSupplyEndProfileResolutionRefusal([tag, {code: '23514', message: message('0')}], effectiveDate)).toBe(false)
  })
})
