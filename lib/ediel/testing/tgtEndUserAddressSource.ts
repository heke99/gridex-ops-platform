import type {TgtProdatSourceColumn} from './tgtProdatSource'
/** Original source cells, before portal text sanitization. Empty cells do not
 * establish unavailable. Component labels preserve p117 positional semantics. */
export function tgtEndUserAddressSourceLines(row:TgtProdatSourceColumn):string[] {
  const raw=row.rawFields
  const clean=(value:string|undefined)=>!value?.trim() || value.trim()==='-'?'':value.trim()
  const components=['229-1','229-2','229-3']
  const split=components.some(key=>Object.hasOwn(raw,key))
  const lines=split?components.map(key=>clean(raw[key])):[clean(raw['229'])]
  if(lines.some(value=>value.length>35 || /[\x00-\x1f\x7f]/.test(value)))throw new Error('PRODAT_END_USER_ADDRESS_SOURCE_INVALID')
  if(split && clean(raw['229']) && (clean(raw['229'])!==lines[0] || lines.slice(1).some(Boolean)))throw new Error('PRODAT_END_USER_ADDRESS_SOURCE_AMBIGUOUS')
  while(lines.length && !lines[lines.length-1])lines.pop()
  return lines
}
