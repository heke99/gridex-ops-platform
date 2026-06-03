export type EdielSystemTestSetupPackage =
  | 'agt_dgi_prodat_e3_e8'
  | 'tgt_dgi_utilts_u3'
  | 'agt_ddq_prodat_l'
  | 'tgt_ddq_prodat_utilts'
  | 'custom'

export type EdielLogicalTestSuite = 'AGT' | 'TGT'
export type EdielSystemActorRole = 'esco' | 'supplier'

export type EdielSystemTestPackageDefinition = {
  value: EdielSystemTestSetupPackage
  label: string
  testSuiteType: EdielLogicalTestSuite
  actorRole: EdielSystemActorRole
  dbActorRole: 'energy_service_company' | 'supplier'
  marketRole: 'DGI' | 'DDQ'
  messageFamily: 'PRODAT' | 'UTILTS'
  portalEdielId: string
  portalEmail: string
  receiverSubaddress: string | null
  receiverSubaddressRequired: boolean
  applicationReference: string
  testBrpEdielId: string | null
  encryptionMode: 'none' | 'smime'
  certificateEnvironment: 'production' | 'test'
  transportEnvironment: 'production_smtp' | 'test'
  smtpProvider: 'strato'
  routeName: string
  targetSystem: 'ediel_portalen_agt' | 'ediel_portalen_tgt'
  environmentType: 'agt_test' | 'tgt_test'
}

export const EDIEL_SYSTEM_TEST_PACKAGES: EdielSystemTestPackageDefinition[] = [
  {
    value: 'agt_dgi_prodat_e3_e8',
    label: 'AGT - Energitjansteforetag / DGI - PRODAT E3-E8',
    testSuiteType: 'AGT',
    actorRole: 'esco',
    dbActorRole: 'energy_service_company',
    marketRole: 'DGI',
    messageFamily: 'PRODAT',
    portalEdielId: '91100',
    portalEmail: '91100@ediel.se',
    receiverSubaddress: 'PRODAT',
    receiverSubaddressRequired: true,
    applicationReference: '23-DGI-PRODAT',
    testBrpEdielId: null,
    encryptionMode: 'smime',
    certificateEnvironment: 'production',
    transportEnvironment: 'production_smtp',
    smtpProvider: 'strato',
    routeName: 'AGT DGI PRODAT - Edielportalen',
    targetSystem: 'ediel_portalen_agt',
    environmentType: 'agt_test',
  },
  {
    value: 'tgt_dgi_utilts_u3',
    label: 'TGT - Energitjansteforetag / DGI - UTILTS U3',
    testSuiteType: 'TGT',
    actorRole: 'esco',
    dbActorRole: 'energy_service_company',
    marketRole: 'DGI',
    messageFamily: 'UTILTS',
    portalEdielId: '91100',
    portalEmail: '91100@ediel.se',
    receiverSubaddress: null,
    receiverSubaddressRequired: false,
    applicationReference: '23-DGI-E66-S',
    testBrpEdielId: null,
    encryptionMode: 'none',
    certificateEnvironment: 'test',
    transportEnvironment: 'test',
    smtpProvider: 'strato',
    routeName: 'TGT DGI UTILTS - Edielportalen',
    targetSystem: 'ediel_portalen_tgt',
    environmentType: 'tgt_test',
  },
  {
    value: 'agt_ddq_prodat_l',
    label: 'AGT - Elleverantor / DDQ - PRODAT L1-L7',
    testSuiteType: 'AGT',
    actorRole: 'supplier',
    dbActorRole: 'supplier',
    marketRole: 'DDQ',
    messageFamily: 'PRODAT',
    portalEdielId: '91100',
    portalEmail: '91100@ediel.se',
    receiverSubaddress: 'PRODAT',
    receiverSubaddressRequired: true,
    applicationReference: '23-DDQ-PRODAT',
    testBrpEdielId: '91109',
    encryptionMode: 'smime',
    certificateEnvironment: 'production',
    transportEnvironment: 'production_smtp',
    smtpProvider: 'strato',
    routeName: 'AGT DDQ PRODAT - Edielportalen',
    targetSystem: 'ediel_portalen_agt',
    environmentType: 'agt_test',
  },
  {
    value: 'tgt_ddq_prodat_utilts',
    label: 'TGT - Elleverantor / DDQ - PRODAT/UTILTS',
    testSuiteType: 'TGT',
    actorRole: 'supplier',
    dbActorRole: 'supplier',
    marketRole: 'DDQ',
    messageFamily: 'PRODAT',
    portalEdielId: '91100',
    portalEmail: '91100@ediel.se',
    receiverSubaddress: 'PRODAT',
    receiverSubaddressRequired: true,
    applicationReference: '23-DDQ-PRODAT',
    testBrpEdielId: '91109',
    encryptionMode: 'smime',
    certificateEnvironment: 'test',
    transportEnvironment: 'test',
    smtpProvider: 'strato',
    routeName: 'TGT DDQ PRODAT - Edielportalen',
    targetSystem: 'ediel_portalen_tgt',
    environmentType: 'tgt_test',
  },
  {
    value: 'custom',
    label: 'Custom system test profile',
    testSuiteType: 'TGT',
    actorRole: 'esco',
    dbActorRole: 'energy_service_company',
    marketRole: 'DGI',
    messageFamily: 'UTILTS',
    portalEdielId: '91100',
    portalEmail: '91100@ediel.se',
    receiverSubaddress: null,
    receiverSubaddressRequired: false,
    applicationReference: '23-DGI-E66-S',
    testBrpEdielId: null,
    encryptionMode: 'none',
    certificateEnvironment: 'test',
    transportEnvironment: 'test',
    smtpProvider: 'strato',
    routeName: 'Custom Ediel system test route',
    targetSystem: 'ediel_portalen_tgt',
    environmentType: 'tgt_test',
  },
]

export function getEdielSystemTestPackage(value?: string | null): EdielSystemTestPackageDefinition {
  return EDIEL_SYSTEM_TEST_PACKAGES.find((item) => item.value === value) ?? EDIEL_SYSTEM_TEST_PACKAGES[0]
}

export function isAgtSystemTestCase(input: {
  setupPackage?: string | null
  runtimeTestSuite?: string | null
  testCaseCode?: string | null
  roleCode?: string | null
  suite?: string | null
}): boolean {
  const setup = String(input.setupPackage ?? '').trim()
  if (setup === 'agt_dgi_prodat_e3_e8' || setup === 'agt_ddq_prodat_l') return true
  if (String(input.runtimeTestSuite ?? '').toUpperCase() === 'AGT') return true
  const code = String(input.testCaseCode ?? '').trim().toUpperCase()
  return (
    String(input.roleCode ?? '').toLowerCase() === 'esco' &&
    String(input.suite ?? '').toUpperCase() === 'PRODAT' &&
    ['E3', 'E4', 'E5', 'E6', 'E7', 'E8'].some((prefix) => code === prefix || code.startsWith(`${prefix}.`))
  )
}

export function edielComposite(edielId: string | null | undefined, subaddress?: string | null): string {
  const id = String(edielId ?? '').trim() || 'saknas'
  const sub = String(subaddress ?? '').trim()
  return sub ? `${id}:ZZ:${sub}` : `${id}:ZZ`
}
