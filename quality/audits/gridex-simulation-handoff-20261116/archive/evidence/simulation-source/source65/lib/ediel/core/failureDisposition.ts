/** Internal error categories control processing; they never invent wire codes. */
export type EdielFailureDisposition =
  | Readonly<{ kind: 'protocol_rejection'; sourceRule: string; externalDiagnosticQualified: true }>
  | Readonly<{ kind: 'internal_failure'; code: string }>
  | Readonly<{ kind: 'security_quarantine'; code: string }>
  | Readonly<{ kind: 'unsupported_capability'; code: string }>

export class EdielExecutionFailure extends Error {
  constructor(readonly disposition: Exclude<EdielFailureDisposition, { kind: 'protocol_rejection' }>, message: string) {
    super(message)
    this.name = 'EdielExecutionFailure'
  }
}

/** National rejection is supplied only after its existing source diagnostic
 * projector qualified the physical scope. A thrown message is not authority. */
export function classifyEdielFailure(error: unknown, qualifiedNationalRejection?: Readonly<{ sourceRule: string }>): EdielFailureDisposition {
  if (qualifiedNationalRejection) return Object.freeze({ kind: 'protocol_rejection', sourceRule: qualifiedNationalRejection.sourceRule, externalDiagnosticQualified: true })
  if (error instanceof EdielExecutionFailure) return Object.freeze({ ...error.disposition })
  return Object.freeze({ kind: 'internal_failure', code: 'EDIEL_INTERNAL_EXECUTION_FAILURE' })
}
