export const MASTERDATA_PERMISSIONS = {
  READ: 'masterdata.read',
  WRITE: 'masterdata.write',
  AUDIT_READ: 'masterdata.audit.read',
} as const

export type MasterdataPermission =
  (typeof MASTERDATA_PERMISSIONS)[keyof typeof MASTERDATA_PERMISSIONS]