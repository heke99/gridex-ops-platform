import { resolveProdatSourceSubtypeRequirement, PRODAT_END_USER_FIELDS } from '@/lib/ediel/prodat/prodatSubtypeRequirement'

/** PRODAT 26.A §2.2 takes precedence over appendix 4: Z14N does not
 * carry the positive response's end-user or installation groups. Child R/D
 * requirements cannot make those inapplicable parents mandatory. */
const Z14N_INAPPLICABLE_PARENT_FIELDS = new Set([
  'END_USER_GROUP', '227', '228', '229', '231', '232', '316',
  'INSTALLATION_GROUP', '233', '234', '235', '236', '237',
])

export function isProdatFieldInInapplicableParent(input: {
  messageCode: string
  subtype?: string | null
  fieldNumber?: string | null
}): boolean {
  if ((PRODAT_END_USER_FIELDS.includes(input.fieldNumber ?? '') || input.fieldNumber === '229')
    && resolveProdatSourceSubtypeRequirement({messageCode:input.messageCode, fieldNumber:'END_USER_GROUP', subtype:input.subtype}) === 'forbidden') return true
  return input.messageCode === 'Z14' && input.subtype === 'N'
    && Z14N_INAPPLICABLE_PARENT_FIELDS.has(input.fieldNumber ?? '')
}
