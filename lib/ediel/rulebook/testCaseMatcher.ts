// lib/ediel/rulebook/testCaseMatcher.ts

import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'

export type RulebookTestCaseDefinition = {
  suite: string
  testCaseCode: string
  name: string
  actorRole: 'supplier' | 'energy_service_company' | 'grid_owner' | 'platform'
  market: 'electricity'
  family: 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL' | 'UTILTS_ERR' | 'AI_LIST'
  messageCode: string
  subtype: string | null
  direction: 'actor_to_portal' | 'portal_to_actor' | 'inbound' | 'outbound'
  expectedContrl: 'positive' | 'negative' | 'not_expected' | 'depends'
  expectedAperak: 'positive' | 'negative' | 'not_expected' | 'depends'
  expectedUtiltsErr: 'expected' | 'not_expected' | 'depends'
  expectedStatus: 'passed' | 'failed' | 'manual_review'
  mandatory: boolean
}

export const RULEBOOK_TEST_CASES: readonly RulebookTestCaseDefinition[] = [
  supplier('L1', 'AGT PRODAT', 'L1 PRODAT Z03', 'Z03', 'L', 'actor_to_portal'),
  supplier('L2', 'AGT PRODAT', 'L2 PRODAT Z04', 'Z04', null, 'portal_to_actor', 'negative'),
  supplier('L3', 'AGT PRODAT', 'L3 PRODAT Z05', 'Z05', null, 'portal_to_actor', 'negative'),
  supplier('L4', 'AGT PRODAT', 'L4 PRODAT Z06', 'Z06', null, 'portal_to_actor', 'negative'),
  supplier('L5', 'AGT PRODAT', 'L5 PRODAT Z10', 'Z10', null, 'portal_to_actor', 'negative'),
  supplier('L7', 'AGT PRODAT', 'L7 PRODAT Z09', 'Z09', 'F', 'actor_to_portal'),
  utiltsSupplier('UL1', 'AGT UTILTS', 'UL1 UTILTS S03', 'S03'),
  utiltsSupplier('UL2', 'AGT UTILTS', 'UL2 UTILTS E66-KVART', 'E66'),
  utiltsSupplier('UL3', 'AGT UTILTS', 'UL3 UTILTS E66-SCH', 'E66'),
  utiltsSupplier('UL4', 'AGT UTILTS', 'UL4 UTILTS S02', 'S02'),
  utiltsSupplier('UL6', 'AGT UTILTS', 'UL6 UTILTS E31-SCH', 'E31'),
  esco('E3', 'AGT PRODAT ESCO', 'E3 PRODAT Z13V', 'Z13', 'V', 'actor_to_portal'),
  esco('E4', 'AGT PRODAT ESCO', 'E4 PRODAT Z13VH', 'Z13', 'VH', 'actor_to_portal'),
  esco('E5', 'AGT PRODAT ESCO', 'E5 PRODAT Z14V', 'Z14', 'V', 'portal_to_actor'),
  esco('E6', 'AGT PRODAT ESCO', 'E6 PRODAT Z14N', 'Z14', 'N', 'portal_to_actor', 'negative'),
  esco('E7', 'AGT PRODAT ESCO', 'E7 PRODAT Z15V', 'Z15', 'V', 'portal_to_actor'),
  esco('E8', 'AGT PRODAT ESCO', 'E8 PRODAT Z18V', 'Z18', 'V', 'actor_to_portal'),
  tgtEsco('8.1.1', 'TGT PRODAT ESCO', 'Korrekt Z13V → Z14V', 'Z13', 'V'),
  tgtEsco('8.1.2', 'TGT PRODAT ESCO', 'Korrekt Z13V → Z14N', 'Z13', 'V'),
  tgtEsco('8.1.3', 'TGT PRODAT ESCO', 'Korrekt Z13VH → Z14VH', 'Z13', 'VH'),
  tgtEsco('8.2.1', 'TGT PRODAT ESCO', 'Avvisad Z14V', 'Z14', 'V', 'negative'),
  tgtEsco('9.1.1', 'TGT PRODAT ESCO', 'Z15V', 'Z15', 'V'),
  tgtEsco('9.1.2', 'TGT PRODAT ESCO', 'Z18V → Z15V', 'Z18', 'V'),
  tgtEsco('9.2.1', 'TGT PRODAT ESCO', 'Avvisad Z15V', 'Z15', 'V', 'negative'),
  tgtUtiltsEsco('U3.1.1', 'Korrekt UTILTS E66-SCH', 'positive', 'not_expected'),
  tgtUtiltsEsco('U3.1.2', 'Korrekt UTILTS E66-KVART', 'positive', 'not_expected'),
  tgtUtiltsEsco('U3.2.1', 'Felaktig UTILTS E66 anvisningsfel kvart', 'negative', 'not_expected'),
  tgtUtiltsEsco('U3.2.2', 'Felaktig UTILTS E66 funktionsfel kvart', 'not_expected', 'expected'),
]

function supplier(
  testCaseCode: string,
  suite: string,
  name: string,
  messageCode: string,
  subtype: string | null,
  direction: RulebookTestCaseDefinition['direction'],
  aperak: RulebookTestCaseDefinition['expectedAperak'] = 'positive'
): RulebookTestCaseDefinition {
  return {
    suite,
    testCaseCode,
    name,
    actorRole: 'supplier',
    market: 'electricity',
    family: 'PRODAT',
    messageCode,
    subtype,
    direction,
    expectedContrl: 'positive',
    expectedAperak: aperak,
    expectedUtiltsErr: 'not_expected',
    expectedStatus: aperak === 'negative' ? 'manual_review' : 'passed',
    mandatory: true,
  }
}

function utiltsSupplier(testCaseCode: string, suite: string, name: string, messageCode: string): RulebookTestCaseDefinition {
  return {
    suite,
    testCaseCode,
    name,
    actorRole: 'supplier',
    market: 'electricity',
    family: 'UTILTS',
    messageCode,
    subtype: null,
    direction: 'actor_to_portal',
    expectedContrl: 'positive',
    expectedAperak: 'depends',
    expectedUtiltsErr: 'depends',
    expectedStatus: 'passed',
    mandatory: true,
  }
}

function esco(
  testCaseCode: string,
  suite: string,
  name: string,
  messageCode: string,
  subtype: string | null,
  direction: RulebookTestCaseDefinition['direction'],
  aperak: RulebookTestCaseDefinition['expectedAperak'] = 'positive'
): RulebookTestCaseDefinition {
  return {
    suite,
    testCaseCode,
    name,
    actorRole: 'energy_service_company',
    market: 'electricity',
    family: 'PRODAT',
    messageCode,
    subtype,
    direction,
    expectedContrl: 'positive',
    expectedAperak: aperak,
    expectedUtiltsErr: 'not_expected',
    expectedStatus: aperak === 'negative' ? 'manual_review' : 'passed',
    mandatory: true,
  }
}

function tgtEsco(
  testCaseCode: string,
  suite: string,
  name: string,
  messageCode: string,
  subtype: string | null,
  aperak: RulebookTestCaseDefinition['expectedAperak'] = 'positive'
): RulebookTestCaseDefinition {
  return esco(testCaseCode, suite, name, messageCode, subtype, 'inbound', aperak)
}

function tgtUtiltsEsco(
  testCaseCode: string,
  name: string,
  aperak: RulebookTestCaseDefinition['expectedAperak'],
  utiltsErr: RulebookTestCaseDefinition['expectedUtiltsErr']
): RulebookTestCaseDefinition {
  return {
    suite: 'TGT UTILTS ESCO',
    testCaseCode,
    name,
    actorRole: 'energy_service_company',
    market: 'electricity',
    family: 'UTILTS',
    messageCode: 'E66',
    subtype: null,
    direction: 'inbound',
    expectedContrl: 'positive',
    expectedAperak: aperak,
    expectedUtiltsErr: utiltsErr,
    expectedStatus: utiltsErr === 'expected' || aperak === 'negative' ? 'manual_review' : 'passed',
    mandatory: true,
  }
}

export function matchRulebookTestCase(rawPayload: string): RulebookTestCaseDefinition[] {
  const parsed = parseRulebookMessage(rawPayload)
  return RULEBOOK_TEST_CASES.filter((testCase) => {
    if (testCase.family !== parsed.family) return false
    if (testCase.messageCode !== parsed.messageCode) return false
    if (testCase.subtype && parsed.subtype && testCase.subtype !== parsed.subtype) return false
    return true
  })
}
