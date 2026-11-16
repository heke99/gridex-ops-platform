// Pure TGT defaults; registry lookups must not import database/file-engine execution.
export const GRIDEX_TGT_EDIEL_ID = "92825";
// Backwards-compatible alias used by the TGT/file-engine views only.
// Actor/AGT identity must come from ediel_actor_settings and route profiles.
export const GRIDEX_EDIEL_ID = GRIDEX_TGT_EDIEL_ID;
export const EDIEL_TGT_TESTSYSTEM_EDIEL_ID = "91100";
export const EDIEL_TGT_TESTSYSTEM_EMAIL = "91100@ediel.se";
export const EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS = "PRODAT";
// In the PRODAT 26.A EDIFACT interchange, Edielportalens testsystem uses
// receiver subaddress PRODAT. This is separate from SMTP address 91100@ediel.se.
export const EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS = "PRODAT";
export const EDIEL_TGT_PRODAT_APPLICATION_REFERENCE = "23-DDQ-PRODAT";
export const EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE = "23-DGI-PRODAT";
