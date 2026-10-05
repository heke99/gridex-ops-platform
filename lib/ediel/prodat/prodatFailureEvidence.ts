/** Decoded submitted content attached to its physical source, never expected data. */
export type ProdatFailureEvidence = {raw:string;locator:string;content:string}[]
export function prodatComponentEvidence(raw:string, locator:string, parts:readonly string[], failed?:readonly number[]): ProdatFailureEvidence {
  // One nonempty failed component is exact; structural/multiple failures retain
  // the complete composite and all empty positions (approved presentation rule).
  const content = failed?.length === 1 && parts[failed[0]] ? parts[failed[0]] : parts.join(':')
  return [{raw,locator,content}]
}
