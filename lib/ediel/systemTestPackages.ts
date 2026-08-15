export type EdielSystemTestSetupPackage =
  | "agt_dgi_prodat_e3_e8"
  | "tgt_dgi_utilts_u3"
  | "agt_ddq_prodat_l"
  | "agt_dgi_utilts_ue1_ue2"
  | "agt_ddq_utilts_s02"
  | "agt_ddq_utilts_s03"
  | "agt_ddq_utilts_e66"
  | "agt_ddq_utilts_e31"
  | "tgt_ddq_prodat_utilts"
  | "custom";

export type EdielLogicalTestSuite = "AGT" | "TGT";
export type EdielSystemActorRole = "esco" | "supplier";

export type EdielSystemTestPackageDefinition = {
  value: EdielSystemTestSetupPackage;
  label: string;
  testSuiteType: EdielLogicalTestSuite;
  actorRole: EdielSystemActorRole;
  dbActorRole: "energy_service_company" | "supplier";
  marketRole: "DGI" | "DDQ";
  messageFamily: "PRODAT" | "UTILTS";
  portalEdielId: string;
  portalEmail: string;
  receiverSubaddress: string | null;
  receiverSubaddressRequired: boolean;
  applicationReference: string;
  testBrpEdielId: string | null;
  encryptionMode: "none" | "smime";
  certificateEnvironment: "production" | "test";
  transportEnvironment: "production_smtp" | "test";
  smtpProvider: "strato";
  routeName: string;
  targetSystem: "ediel_portalen_agt" | "ediel_portalen_tgt";
  environmentType: "agt_test" | "tgt_test";
};

function supplierAgtUtiltsPackage(params: {
  value:
    | "agt_ddq_utilts_s02"
    | "agt_ddq_utilts_s03"
    | "agt_ddq_utilts_e66"
    | "agt_ddq_utilts_e31";
  messageCode: "S02" | "S03" | "E66" | "E31";
}): EdielSystemTestPackageDefinition {
  return {
    value: params.value,
    label: `AGT - Elleverantör / DDQ - UTILTS ${params.messageCode}`,
    testSuiteType: "AGT",
    actorRole: "supplier",
    dbActorRole: "supplier",
    marketRole: "DDQ",
    messageFamily: "UTILTS",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: null,
    receiverSubaddressRequired: false,
    applicationReference: `23-DDQ-${params.messageCode}-S`,
    testBrpEdielId: "91109",
    encryptionMode: "none",
    certificateEnvironment: "production",
    transportEnvironment: "production_smtp",
    smtpProvider: "strato",
    routeName: `AGT DDQ UTILTS ${params.messageCode} - Edielportalen`,
    targetSystem: "ediel_portalen_agt",
    environmentType: "agt_test",
  };
}

export const EDIEL_SYSTEM_TEST_PACKAGES: EdielSystemTestPackageDefinition[] = [
  {
    value: "agt_dgi_prodat_e3_e8",
    label: "AGT - Energitjänsteföretag / DGI - PRODAT E3-E8",
    testSuiteType: "AGT",
    actorRole: "esco",
    dbActorRole: "energy_service_company",
    marketRole: "DGI",
    messageFamily: "PRODAT",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: "PRODAT",
    receiverSubaddressRequired: true,
    applicationReference: "23-DGI-PRODAT",
    testBrpEdielId: null,
    encryptionMode: "smime",
    certificateEnvironment: "production",
    transportEnvironment: "production_smtp",
    smtpProvider: "strato",
    routeName: "AGT DGI PRODAT - Edielportalen",
    targetSystem: "ediel_portalen_agt",
    environmentType: "agt_test",
  },
  {
    value: "agt_dgi_utilts_ue1_ue2",
    label: "AGT - Energitjänsteföretag / DGI - UTILTS UE1-UE2",
    testSuiteType: "AGT",
    actorRole: "esco",
    dbActorRole: "energy_service_company",
    marketRole: "DGI",
    messageFamily: "UTILTS",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: null,
    receiverSubaddressRequired: false,
    applicationReference: "23-DGI-E66-S",
    testBrpEdielId: null,
    encryptionMode: "none",
    certificateEnvironment: "production",
    transportEnvironment: "production_smtp",
    smtpProvider: "strato",
    routeName: "AGT DGI UTILTS - Edielportalen",
    targetSystem: "ediel_portalen_agt",
    environmentType: "agt_test",
  },
  {
    value: "tgt_dgi_utilts_u3",
    label: "TGT - Energitjänsteföretag / DGI - UTILTS U3",
    testSuiteType: "TGT",
    actorRole: "esco",
    dbActorRole: "energy_service_company",
    marketRole: "DGI",
    messageFamily: "UTILTS",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: null,
    receiverSubaddressRequired: false,
    applicationReference: "23-DGI-E66-S",
    testBrpEdielId: null,
    encryptionMode: "none",
    certificateEnvironment: "test",
    transportEnvironment: "test",
    smtpProvider: "strato",
    routeName: "TGT DGI UTILTS - Edielportalen",
    targetSystem: "ediel_portalen_tgt",
    environmentType: "tgt_test",
  },
  {
    value: "agt_ddq_prodat_l",
    label: "AGT - Elleverantör / DDQ - PRODAT L1-L7",
    testSuiteType: "AGT",
    actorRole: "supplier",
    dbActorRole: "supplier",
    marketRole: "DDQ",
    messageFamily: "PRODAT",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: "PRODAT",
    receiverSubaddressRequired: true,
    applicationReference: "23-DDQ-PRODAT",
    testBrpEdielId: "91109",
    encryptionMode: "smime",
    certificateEnvironment: "production",
    transportEnvironment: "production_smtp",
    smtpProvider: "strato",
    routeName: "AGT DDQ PRODAT - Edielportalen",
    targetSystem: "ediel_portalen_agt",
    environmentType: "agt_test",
  },
  supplierAgtUtiltsPackage({
    value: "agt_ddq_utilts_s02",
    messageCode: "S02",
  }),
  supplierAgtUtiltsPackage({
    value: "agt_ddq_utilts_s03",
    messageCode: "S03",
  }),
  supplierAgtUtiltsPackage({
    value: "agt_ddq_utilts_e66",
    messageCode: "E66",
  }),
  supplierAgtUtiltsPackage({
    value: "agt_ddq_utilts_e31",
    messageCode: "E31",
  }),
  {
    value: "tgt_ddq_prodat_utilts",
    label: "TGT - Elleverantör / DDQ - PRODAT",
    testSuiteType: "TGT",
    actorRole: "supplier",
    dbActorRole: "supplier",
    marketRole: "DDQ",
    messageFamily: "PRODAT",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: "PRODAT",
    receiverSubaddressRequired: true,
    applicationReference: "23-DDQ-PRODAT",
    testBrpEdielId: "91109",
    encryptionMode: "smime",
    certificateEnvironment: "test",
    transportEnvironment: "test",
    smtpProvider: "strato",
    routeName: "TGT DDQ PRODAT - Edielportalen",
    targetSystem: "ediel_portalen_tgt",
    environmentType: "tgt_test",
  },
  {
    value: "custom",
    label: "Custom system test profile",
    testSuiteType: "TGT",
    actorRole: "esco",
    dbActorRole: "energy_service_company",
    marketRole: "DGI",
    messageFamily: "UTILTS",
    portalEdielId: "91100",
    portalEmail: "91100@ediel.se",
    receiverSubaddress: null,
    receiverSubaddressRequired: false,
    applicationReference: "23-DGI-E66-S",
    testBrpEdielId: null,
    encryptionMode: "none",
    certificateEnvironment: "test",
    transportEnvironment: "test",
    smtpProvider: "strato",
    routeName: "Custom Ediel system test route",
    targetSystem: "ediel_portalen_tgt",
    environmentType: "tgt_test",
  },
];

export function getEdielSystemTestPackage(
  value?: string | null,
): EdielSystemTestPackageDefinition {
  return (
    EDIEL_SYSTEM_TEST_PACKAGES.find((item) => item.value === value) ??
    EDIEL_SYSTEM_TEST_PACKAGES[0]
  );
}

export function getSupplierAgtUtiltsSetupPackage(
  messageCode?: string | null,
): EdielSystemTestSetupPackage | null {
  switch (String(messageCode ?? "").trim().toUpperCase()) {
    case "S02":
      return "agt_ddq_utilts_s02";
    case "S03":
      return "agt_ddq_utilts_s03";
    case "E66":
      return "agt_ddq_utilts_e66";
    case "E31":
      return "agt_ddq_utilts_e31";
    default:
      return null;
  }
}

/**
 * Resolve the canonical setup package for an AGT/TGT runtime. Partial identity
 * (suite+role without family/package) is unsafe once multiple UTILTS packages
 * can be active for the same tenant.
 */
export function resolveEdielSystemTestPackageForCase(input: {
  setupPackage?: string | null;
  runtimeSuite?: string | null;
  actorRole?: string | null;
  messageFamily?: string | null;
  messageCode?: string | null;
  testCaseCode?: string | null;
}): EdielSystemTestPackageDefinition | null {
  const explicit = String(input.setupPackage ?? "").trim();
  if (explicit) {
    const known = EDIEL_SYSTEM_TEST_PACKAGES.find((item) => item.value === explicit);
    if (known) return known;
  }

  const runtimeSuite = String(input.runtimeSuite ?? "")
    .trim()
    .toUpperCase();
  const role = String(input.actorRole ?? "")
    .trim()
    .toLowerCase();
  const canonicalRole =
    role === "supplier" || role === "electricity_supplier"
      ? "supplier"
      : role === "esco" || role === "energy_service_company"
        ? "esco"
        : null;
  const family = String(input.messageFamily ?? "")
    .trim()
    .toUpperCase();
  const messageCode = String(input.messageCode ?? "").trim().toUpperCase();
  const testCaseCode = String(input.testCaseCode ?? "")
    .trim()
    .toUpperCase();

  if (!canonicalRole || !family) return null;

  const isAgt =
    runtimeSuite === "AGT" ||
    isAgtSystemTestCase({
      setupPackage: explicit || null,
      runtimeTestSuite: runtimeSuite,
      roleCode: canonicalRole,
      suite: family,
      testCaseCode,
    });

  if (isAgt && canonicalRole === "supplier" && family === "PRODAT") {
    return getEdielSystemTestPackage("agt_ddq_prodat_l");
  }
  if (isAgt && canonicalRole === "supplier" && family === "UTILTS") {
    const utiltsPackage =
      getSupplierAgtUtiltsSetupPackage(messageCode) ??
      (testCaseCode.startsWith("UL")
        ? getSupplierAgtUtiltsSetupPackage(
            ({
              UL1: "S03",
              UL2: "E66",
              UL3: "E66",
              UL4: "S02",
              UL6: "E31",
            } as Record<string, string>)[testCaseCode],
          )
        : null);
    return utiltsPackage ? getEdielSystemTestPackage(utiltsPackage) : null;
  }
  if (isAgt && canonicalRole === "esco" && family === "PRODAT") {
    return getEdielSystemTestPackage("agt_dgi_prodat_e3_e8");
  }
  if (isAgt && canonicalRole === "esco" && family === "UTILTS") {
    return getEdielSystemTestPackage("agt_dgi_utilts_ue1_ue2");
  }
  if (!isAgt && canonicalRole === "esco" && family === "UTILTS") {
    return getEdielSystemTestPackage("tgt_dgi_utilts_u3");
  }
  if (!isAgt && canonicalRole === "supplier") {
    return getEdielSystemTestPackage("tgt_ddq_prodat_utilts");
  }
  if (!isAgt && canonicalRole === "esco" && family === "PRODAT") {
    return getEdielSystemTestPackage("agt_dgi_prodat_e3_e8");
  }
  return null;
}

export function isAgtSystemTestCase(input: {
  setupPackage?: string | null;
  runtimeTestSuite?: string | null;
  testCaseCode?: string | null;
  roleCode?: string | null;
  suite?: string | null;
}): boolean {
  const setup = String(input.setupPackage ?? "").trim();
  if (
    setup === "agt_dgi_prodat_e3_e8" ||
    setup === "agt_dgi_utilts_ue1_ue2" ||
    setup === "agt_ddq_prodat_l" ||
    setup.startsWith("agt_ddq_utilts_")
  )
    return true;
  if (String(input.runtimeTestSuite ?? "").toUpperCase() === "AGT") return true;
  const code = String(input.testCaseCode ?? "")
    .trim()
    .toUpperCase();
  const suite = String(input.suite ?? "").toUpperCase();
  const role = String(input.roleCode ?? "").toLowerCase();
  const agtEscoProdatCodes = new Set(["E3", "E4", "E5", "E6", "E7", "E8"]);
  if (role === "supplier" && suite === "UTILTS" && code.startsWith("UL"))
    return true;
  if (
    role === "esco" &&
    suite === "UTILTS" &&
    (code === "UE1" || code === "UE2")
  )
    return true;
  return role === "esco" && suite === "PRODAT" && agtEscoProdatCodes.has(code);
}

export function edielComposite(
  edielId: string | null | undefined,
  subaddress?: string | null,
): string {
  const id = String(edielId ?? "").trim() || "saknas";
  const sub = String(subaddress ?? "").trim();
  return sub ? `${id}:ZZ:${sub}` : `${id}:ZZ`;
}
