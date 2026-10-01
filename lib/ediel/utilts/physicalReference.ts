/** Original U505 IDE references, also copied by U529 TN / APERAK ACW.
 * UNECE syntax retains leading/embedded spaces in variable-length an data;
 * trailing spaces must be suppressed. This is not actor/UNB/P identity policy.
 */
export function physicalUtiltsReference(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Shape only: source membership, guide and durable outcome remain separate. */
export function isValidUtiltsTransactionReference(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 35 &&
    !/^ *$/.test(value) && !/ $/.test(value) && !/[\x00-\x1f\x7f-\x9f\u0100-\uffff]/.test(value)
}
