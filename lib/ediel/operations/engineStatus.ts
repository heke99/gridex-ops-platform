import { summarizeEdielEngineCoverage } from '@/lib/ediel/testing/testCaseRegistry'

export type EdielOperationsEngineStatus = {
  title: string
  description: string
  checks: Array<{ label: string; value: string; tone: 'ready' | 'attention' | 'neutral' }>
}

export function getEdielOperationsEngineStatus(): EdielOperationsEngineStatus {
  const coverage = summarizeEdielEngineCoverage()

  return {
    title: 'Ediel Operations Engine',
    description: 'Samma kärna driver PRODAT L1–L7, UTILTS UL1–UL6, kvittenser och mätvärdesingest. Testfall ligger i registry; produktionsregler ligger i engine.',
    checks: [
      { label: 'AGT-fall i registry', value: String(coverage.totalCases), tone: 'ready' },
      { label: 'PRODAT', value: `${coverage.prodatCases} fall`, tone: 'ready' },
      { label: 'UTILTS', value: `${coverage.utiltsCases} fall`, tone: 'ready' },
      { label: 'L7-regel', value: coverage.l7Rule ? 'Z09G = Z03' : 'Saknas', tone: coverage.l7Rule ? 'ready' : 'attention' },
      { label: 'SaaS-scope', value: 'company_id krävs', tone: 'neutral' },
    ],
  }
}
