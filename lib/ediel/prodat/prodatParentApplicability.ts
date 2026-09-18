import { resolveProdatSourceSubtypeRequirement } from '@/lib/ediel/prodat/prodatSubtypeRequirement'

/** PRODAT 26.A §2.2 takes precedence over appendix 4: Z14N does not
 * carry the positive response's end-user or installation groups. Child R/D
 * requirements cannot make those inapplicable parents mandatory. */
const Z14N_INAPPLICABLE_PARENT_FIELDS = new Set([
  'END_USER_GROUP', '227', '228', '229', '231', '232', '316',
  'INSTALLATION_GROUP', '233', '234', '235', '236', '237',
])

export const PRODAT_END_USER_CHILD_FIELDS: readonly string[] = Object.freeze(['227', '228', '231', '232', '316'])

export function isSourceBoundEndUserField(messageCode: string, fieldNumber: string): boolean {
  return ['Z06', 'Z09'].includes(messageCode)
    && (fieldNumber === 'END_USER_GROUP' || PRODAT_END_USER_CHILD_FIELDS.includes(fieldNumber))
}

/** P26.A p22: the parent and these five children share E/R, non-E/X.
 * This is not address-availability evidence for field229. */
export function resolveProdatEndUserGroupRequirement(messageCode: string, subtype: unknown) {
  if (!['Z06', 'Z09'].includes(messageCode)) return null
  return resolveProdatSourceSubtypeRequirement({messageCode, fieldNumber: '227', subtype})
}

export function isProdatFieldInInapplicableParent(input: {
  messageCode: string
  subtype?: string | null
  fieldNumber?: string | null
}): boolean {
  if ((input.fieldNumber === '229' || isSourceBoundEndUserField(input.messageCode, input.fieldNumber ?? ''))
    && resolveProdatEndUserGroupRequirement(input.messageCode, input.subtype) === 'forbidden') return true
  return input.messageCode === 'Z14' && input.subtype === 'N'
    && Z14N_INAPPLICABLE_PARENT_FIELDS.has(input.fieldNumber ?? '')
}
