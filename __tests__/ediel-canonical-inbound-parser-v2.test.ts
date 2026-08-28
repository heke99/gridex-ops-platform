import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  canonicalMessageFacts,
  parseCanonicalEdifactAst,
} from '@/lib/ediel/core/canonicalEdifactAst'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import { classifyEdielMessage } from '@/lib/ediel/rulebook/ruleProfileSelector'

const CUSTOM_UNA_UTILTS = [
  'UNA;*.? !',
  'UNB*UNOC;3*SENDER;;14*RECEIVER;;14*260829;0030*REF1***23-DDQ-E66-T!',
  'UNH*1*UTILTS;D;96A;UN;E5SE5A!',
  'BGM*E66*DOC1*9!',
  'DTM*354;15;804!',
  'LIN*1**735999123456789001!',
  'RFF*MG;METER?*A!',
  'QTY*31;12.5;KWH!',
  'LIN*2**735999123456789002!',
  'RFF*MG;METER-B!',
  'QTY*31;7.25;KWH!',
  'UNT*10*1!',
  'UNZ*1*REF1!',
].join('')

const CUSTOM_UNA_PRODAT_Z14N = [
  'UNA;*.? !',
  'UNB*UNOC;3*GRIDOWNER;;14*ESCO;;14*260829;0030*REF2***23-DGI-PRODAT!',
  'UNH*2*PRODAT;D;96A;UN;E2SE6A!',
  'BGM*Z14*DOC2*9!',
  'CCI**Z23!',
  'CAV*A75!',
  'LIN*1**735999123456789003!',
  'RFF*Z07;FACILITY-1!',
  'UNT*7*2!',
  'UNZ*1*REF2!',
].join('')

describe('canonical inbound EDIFACT parser v2', () => {
  it('parses custom UNA and escaped data separators without losing transaction context', () => {
    const ast = parseCanonicalEdifactAst(CUSTOM_UNA_UTILTS)

    expect(ast.una.componentDataElementSeparator).toBe(';')
    expect(ast.una.dataElementSeparator).toBe('*')
    expect(ast.una.segmentTerminator).toBe('!')
    expect(ast.senderEdielId).toBe('SENDER')
    expect(ast.receiverEdielId).toBe('RECEIVER')
    expect(ast.interchangeReference).toBe('REF1')
    expect(ast.applicationReference).toBe('23-DDQ-E66-T')

    expect(ast.messages).toHaveLength(1)
    expect(ast.messages[0]).toMatchObject({ family: 'UTILTS', messageCode: 'E66' })
    expect(ast.messages[0].lineGroups).toHaveLength(2)
    expect(ast.messages[0].lineGroups[0].itemId).toBe('735999123456789001')
    expect(ast.messages[0].lineGroups[0].references.MG).toEqual(['METER*A'])
    expect(ast.messages[0].lineGroups[1].references.MG).toEqual(['METER-B'])
  })

  it('keeps the compatibility message-facts facade on the same canonical tokenizer', () => {
    const facts = parseEdifactMessageFacts(CUSTOM_UNA_UTILTS)
    expect(facts.messageType).toBe('UTILTS')
    expect(facts.messageCode).toBe('E66')
    expect(facts.interchangeReference).toBe('REF1')
    expect(facts.lineItems).toHaveLength(2)
    expect(facts.lineItems[0].rffMg).toBe('METER*A')
    expect(facts.lineItems[0].hasQty31).toBe(true)
  })

  it('classifies UTILTS resolution from structured DTM/application-reference facts', () => {
    const facts = canonicalMessageFacts(CUSTOM_UNA_UTILTS)
    expect(facts.dtmValues['354']).toEqual(['15'])

    expect(classifyEdielMessage({ rawPayload: CUSTOM_UNA_UTILTS })).toMatchObject({
      family: 'UTILTS',
      messageCode: 'E66',
      variant: 'quarter',
      ruleProfileId: 'utilts_e66_quarter',
      businessResult: 'meter_values',
      confidence: 'high',
    })
  })

  it('classifies PRODAT Z14 rejection from structured CCI/CAV facts with custom UNA', () => {
    const facts = canonicalMessageFacts(CUSTOM_UNA_PRODAT_Z14N)
    expect(facts.cciCavCodes.Z23).toEqual(['A75'])

    expect(classifyEdielMessage({ rawPayload: CUSTOM_UNA_PRODAT_Z14N })).toMatchObject({
      family: 'PRODAT',
      messageCode: 'Z14',
      variant: 'Z14N',
      businessResult: 'permission_rejected',
      applicationValidity: 'valid',
      confidence: 'high',
    })
  })

  it('prevents active classifiers from reintroducing ad-hoc raw EDIFACT splitting', () => {
    const selector = fs.readFileSync(
      path.join(process.cwd(), 'lib/ediel/rulebook/ruleProfileSelector.ts'),
      'utf8',
    )
    const compatibility = fs.readFileSync(
      path.join(process.cwd(), 'lib/ediel/core/edifactSegments.ts'),
      'utf8',
    )

    expect(selector).toContain('canonicalMessageFacts')
    expect(selector).not.toContain('.split("\'")')
    expect(selector).not.toContain(".split('+')")
    expect(selector).not.toContain("raw.includes('DTM+")

    expect(compatibility).toContain('parseCanonicalEdifactAst')
    expect(compatibility).toContain('tokenizeEdifact')
    expect(compatibility).not.toContain('function readServiceChars')
    expect(compatibility).not.toContain('function splitSegments')
    expect(compatibility).not.toContain('function splitReleased')
  })
})
