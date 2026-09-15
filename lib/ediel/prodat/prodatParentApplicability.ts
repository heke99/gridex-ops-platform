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
  return input.messageCode === 'Z14' && input.subtype === 'N'
    && Z14N_INAPPLICABLE_PARENT_FIELDS.has(input.fieldNumber ?? '')
}
