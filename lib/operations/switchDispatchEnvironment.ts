import { resolveCustomerInfoOperationEnvironment } from '@/lib/ediel/customerInfoEnvironmentResolver'
import type { EdielEnvironment } from '@/lib/ediel/types'

export type SwitchDispatchEnvironment =
  | { ok: true; environment: EdielEnvironment }
  | { ok: false; code: string; message: string }

/**
 * The Ediel environment a supplier switch (Z03) is prepared in. An explicit server-selected environment wins.
 * Otherwise it is the tenant's own operating environment for PRODAT Z03, resolved from its active sender setting and
 * Z03 route profiles exactly as the Z01 customer-information flow resolves it. Never a silent default: an automatic
 * switch of a production tenant was prepared in 'test' and refused with route_profile_missing (FINDINGS I-B5).
 */
export async function resolveSwitchDispatchEnvironment(input: {
  companyId: string | null | undefined
  explicitEnvironment?: EdielEnvironment | null
}): Promise<SwitchDispatchEnvironment> {
  if (input.explicitEnvironment === 'test' || input.explicitEnvironment === 'production') {
    return { ok: true, environment: input.explicitEnvironment }
  }
  if (!input.companyId) {
    return { ok: false, code: 'environment_not_resolved', message: 'Bolag saknas, så Ediel-miljön för leverantörsbytet kan inte avgöras.' }
  }
  const resolved = await resolveCustomerInfoOperationEnvironment({ companyId: input.companyId, messageFamily: 'PRODAT', messageCode: 'Z03' })
  if (resolved.status === 'resolved' && resolved.environment) return { ok: true, environment: resolved.environment }
  return {
    ok: false,
    code: String(resolved.blocker?.blocker_code ?? 'environment_not_resolved'),
    message: String(resolved.blocker?.blocker_reason ?? 'Ediel-miljön för leverantörsbytet kunde inte avgöras.'),
  }
}
