import type { UtiltsRuntimeValidation } from '@/lib/ediel/utiltsEngine'

export function utiltsHasFunctionalErrors(validation: UtiltsRuntimeValidation): boolean {
  return validation.issues.some((issue) => issue.severity === 'error' && issue.kind === 'functional')
}

export function utiltsHasApplicationErrors(validation: UtiltsRuntimeValidation): boolean {
  return validation.issues.some((issue) => issue.severity === 'error' && issue.kind === 'application')
}

export function utiltsHasSyntaxErrors(validation: UtiltsRuntimeValidation): boolean {
  return validation.issues.some((issue) => issue.severity === 'error' && issue.kind === 'syntax')
}
