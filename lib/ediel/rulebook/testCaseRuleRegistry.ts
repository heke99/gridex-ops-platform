export type EdielCertificationRole = 'supplier' | 'energy_service_company'
export type EdielCertificationProfileKey =
  | 'supplier_prodat_agt'
  | 'supplier_utilts_agt'
  | 'energy_service_prodat_agt'
  | 'energy_service_utilts_agt'

export type EdielCertificationStatus = 'approved' | 'failed' | 'pending'
export type EdielCertificationDirection = 'actor_to_portal' | 'portal_to_actor'

export type EdielCertificationCase = {
  profileKey: EdielCertificationProfileKey
  role: EdielCertificationRole
  testCaseCode: string
  portalTestId: string | null
  messageFamily: 'PRODAT' | 'UTILTS'
  messageCode: string
  variant: string | null
  direction: EdielCertificationDirection
  status: EdielCertificationStatus
  expectedContrl: 'positive'
  expectedBusinessResponseFamily: 'APERAK' | 'UTILTS_ERR' | 'INCOMING_APERAK'
  expectedBusinessOutcome: 'positive' | 'negative'
  source: string
  golden: boolean
  notes: string
}

export const EDIEL_BATCH4_CERTIFICATION_CASES: EdielCertificationCase[] = [
  { profileKey: 'supplier_prodat_agt', role: 'supplier', testCaseCode: 'L1', portalTestId: '388756', messageFamily: 'PRODAT', messageCode: 'Z03', variant: null, direction: 'actor_to_portal', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'INCOMING_APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Gridex skickar Z03 till portal och tar emot negativ APERAK.' },
  { profileKey: 'supplier_prodat_agt', role: 'supplier', testCaseCode: 'L2', portalTestId: '388764', messageFamily: 'PRODAT', messageCode: 'Z04', variant: null, direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Portal skickar Z04, Gridex skickar positiv CONTRL och negativ APERAK.' },
  { profileKey: 'supplier_prodat_agt', role: 'supplier', testCaseCode: 'L3', portalTestId: '388765', messageFamily: 'PRODAT', messageCode: 'Z05', variant: null, direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Portal skickar Z05, Gridex skickar positiv CONTRL och negativ APERAK.' },
  { profileKey: 'supplier_prodat_agt', role: 'supplier', testCaseCode: 'L4', portalTestId: '388766', messageFamily: 'PRODAT', messageCode: 'Z06', variant: null, direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Portal skickar Z06, Gridex skickar positiv CONTRL och negativ APERAK.' },
  { profileKey: 'supplier_prodat_agt', role: 'supplier', testCaseCode: 'L5', portalTestId: '388767', messageFamily: 'PRODAT', messageCode: 'Z10', variant: null, direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Portal skickar Z10, Gridex skickar positiv CONTRL och negativ APERAK.' },
  { profileKey: 'supplier_prodat_agt', role: 'supplier', testCaseCode: 'L7', portalTestId: '388809', messageFamily: 'PRODAT', messageCode: 'Z09', variant: null, direction: 'actor_to_portal', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'INCOMING_APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Gridex skickar Z09 till portal och tar emot negativ APERAK.' },

  { profileKey: 'supplier_utilts_agt', role: 'supplier', testCaseCode: 'UL1', portalTestId: '388810', messageFamily: 'UTILTS', messageCode: 'S03', variant: null, direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: true, notes: 'Portal skickar UTILTS S03; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR enligt facit.' },
  { profileKey: 'supplier_utilts_agt', role: 'supplier', testCaseCode: 'UL2', portalTestId: '388811', messageFamily: 'UTILTS', messageCode: 'E66', variant: 'KVART', direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: true, notes: 'Portal skickar UTILTS E66-KVART; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR enligt facit.' },
  { profileKey: 'supplier_utilts_agt', role: 'supplier', testCaseCode: 'UL3', portalTestId: '388812', messageFamily: 'UTILTS', messageCode: 'E66', variant: 'SCH', direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: true, notes: 'Portal skickar UTILTS E66-SCH; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR enligt facit.' },
  { profileKey: 'supplier_utilts_agt', role: 'supplier', testCaseCode: 'UL4', portalTestId: '388813', messageFamily: 'UTILTS', messageCode: 'S02', variant: null, direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: true, notes: 'Portal skickar UTILTS S02; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR enligt facit.' },
  { profileKey: 'supplier_utilts_agt', role: 'supplier', testCaseCode: 'UL6', portalTestId: '388814', messageFamily: 'UTILTS', messageCode: 'E31', variant: 'SCH', direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: true, notes: 'Portal skickar UTILTS E31-SCH; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR enligt facit.' },

  { profileKey: 'energy_service_prodat_agt', role: 'energy_service_company', testCaseCode: 'E3', portalTestId: '389178', messageFamily: 'PRODAT', messageCode: 'Z13', variant: 'V', direction: 'actor_to_portal', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'INCOMING_APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Gridex skickar Z13V och tar emot negativ APERAK.' },
  { profileKey: 'energy_service_prodat_agt', role: 'energy_service_company', testCaseCode: 'E4', portalTestId: null, messageFamily: 'PRODAT', messageCode: 'Z13', variant: 'VH', direction: 'actor_to_portal', status: 'pending', expectedContrl: 'positive', expectedBusinessResponseFamily: 'INCOMING_APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: false, notes: 'Gridex ska skicka Z13VH och ta emot negativ APERAK.' },
  { profileKey: 'energy_service_prodat_agt', role: 'energy_service_company', testCaseCode: 'E5', portalTestId: '389280', messageFamily: 'PRODAT', messageCode: 'Z14', variant: 'V', direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Portal skickar Z14V; Gridex skickar positiv CONTRL och negativ APERAK.' },
  { profileKey: 'energy_service_prodat_agt', role: 'energy_service_company', testCaseCode: 'E6', portalTestId: '389301', messageFamily: 'PRODAT', messageCode: 'Z14', variant: 'N', direction: 'portal_to_actor', status: 'approved', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: true, notes: 'Portal skickar Z14N; Gridex backend-beslut om negativ APERAK är facit.' },
  { profileKey: 'energy_service_prodat_agt', role: 'energy_service_company', testCaseCode: 'E7', portalTestId: '389303', messageFamily: 'PRODAT', messageCode: 'Z15', variant: 'V', direction: 'portal_to_actor', status: 'failed', expectedContrl: 'positive', expectedBusinessResponseFamily: 'APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: false, notes: 'Aktivt fixmål: Portal skickar Z15V; Gridex ska skicka positiv CONTRL och negativ APERAK via engine-regel.' },
  { profileKey: 'energy_service_prodat_agt', role: 'energy_service_company', testCaseCode: 'E8', portalTestId: null, messageFamily: 'PRODAT', messageCode: 'Z18', variant: 'V', direction: 'actor_to_portal', status: 'pending', expectedContrl: 'positive', expectedBusinessResponseFamily: 'INCOMING_APERAK', expectedBusinessOutcome: 'negative', source: 'AGT PRODAT 5.0.2', golden: false, notes: 'Gridex ska skicka Z18V och ta emot negativ APERAK.' },

  { profileKey: 'energy_service_utilts_agt', role: 'energy_service_company', testCaseCode: 'UE1', portalTestId: null, messageFamily: 'UTILTS', messageCode: 'E66', variant: 'KVART', direction: 'portal_to_actor', status: 'pending', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: false, notes: 'Portal skickar UTILTS E66-KVART; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR.' },
  { profileKey: 'energy_service_utilts_agt', role: 'energy_service_company', testCaseCode: 'UE2', portalTestId: null, messageFamily: 'UTILTS', messageCode: 'E66', variant: 'SCH', direction: 'portal_to_actor', status: 'pending', expectedContrl: 'positive', expectedBusinessResponseFamily: 'UTILTS_ERR', expectedBusinessOutcome: 'negative', source: 'AGT UTILTS 5.0.0', golden: false, notes: 'Portal skickar UTILTS E66-SCH; Gridex svarar med positiv CONTRL och negativ UTILTS/UTILTS_ERR.' },
]

export function certificationCasesByProfile(profileKey: EdielCertificationProfileKey): EdielCertificationCase[] {
  return EDIEL_BATCH4_CERTIFICATION_CASES.filter((testCase) => testCase.profileKey === profileKey)
}

export function findCertificationCase(testCaseCode: string | null | undefined): EdielCertificationCase | null {
  const code = String(testCaseCode ?? '').trim().toUpperCase()
  return EDIEL_BATCH4_CERTIFICATION_CASES.find((testCase) => testCase.testCaseCode === code) ?? null
}

export function certificationSummary() {
  const total = EDIEL_BATCH4_CERTIFICATION_CASES.length
  const approved = EDIEL_BATCH4_CERTIFICATION_CASES.filter((testCase) => testCase.status === 'approved').length
  const failed = EDIEL_BATCH4_CERTIFICATION_CASES.filter((testCase) => testCase.status === 'failed').length
  const pending = EDIEL_BATCH4_CERTIFICATION_CASES.filter((testCase) => testCase.status === 'pending').length
  return { total, approved, failed, pending }
}
