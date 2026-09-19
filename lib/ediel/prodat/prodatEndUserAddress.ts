/** Independent selected business source. Caller selections are protocol inputs,
 * never credentials or live authorization. TGT assertions retain their run. */
export type ProdatEndUserAddressObject = {
  meteringPointId: string
  identityAgency: '9' | '89'
  endUser: { id: string; qualifier: '' | '1' | 'SE1' | 'SE2'; agency: '89' | '260' }
  availability: 'available' | 'unavailable' | 'unknown'
  addressLines: readonly string[]
  source: {kind:'caller_selection'|'tgt';companyId:string;reference:string;runId?:string;stepNo?:number;code?:string;sourceDigest?:string}
}
export const END_USER_ADDRESS_CODES: readonly string[] = ['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09']
const record=(v:unknown):Record<string,unknown>|null=>v!==null && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : null
const invalid=():never=>{throw new Error('prodat_end_user_address_evidence_invalid')}
const text=(v:unknown,max:number)=>typeof v==='string' && v.trim().length>0 && v===v.trim() && v.length<=max && !/[\x00-\x1f\x7f]/.test(v)
export function copyProdatEndUserAddressObjects(value:unknown):ProdatEndUserAddressObject[] {
  if(!Array.isArray(value)) return invalid()
  const seen=new Set<string>()
  return value.map(input=>{
    const row=record(input), user=record(row?.endUser), source=record(row?.source)
    if(!row || !user || !source || !text(row.meteringPointId,25) || typeof row.identityAgency!=='string' || !['9','89'].includes(row.identityAgency)
      || !text(user.id,35) || typeof user.qualifier!=='string' || !['','1','SE1','SE2'].includes(user.qualifier)
      || !(user.qualifier==='' ? user.agency==='89' : user.agency==='260')
      || typeof row.availability!=='string' || !['available','unavailable','unknown'].includes(row.availability)
      || !Array.isArray(row.addressLines) || row.addressLines.length>3
      || row.addressLines.some(line=>typeof line!=='string' || line.length>35 || line!==line.trim() || /[\x00-\x1f\x7f]/.test(line))
      || !text(source.companyId,200) || !text(source.reference,2000) || typeof source.kind!=='string' || !['caller_selection','tgt'].includes(source.kind)) return invalid()
    const lines=row.addressLines as string[]
    // The p118 formatting dot alone is never evidence of a real address.
    if(row.availability==='available' ? !lines.some(line=>line && line!=='.') : lines.some(Boolean)) return invalid()
    if(source.kind==='tgt' && (!text(source.runId,200) || !Number.isSafeInteger(source.stepNo) || Number(source.stepNo)<1
      || typeof source.code!=='string' || !END_USER_ADDRESS_CODES.includes(source.code) || typeof source.sourceDigest!=='string' || !/^[a-f0-9]{64}$/.test(source.sourceDigest))) return invalid()
    const key=JSON.stringify([row.meteringPointId,row.identityAgency]);if(seen.has(key))return invalid();seen.add(key)
    return {meteringPointId:row.meteringPointId as string,identityAgency:row.identityAgency as '9'|'89',
      endUser:{id:user.id as string,qualifier:user.qualifier as ProdatEndUserAddressObject['endUser']['qualifier'],agency:user.agency as '89'|'260'},
      availability:row.availability as ProdatEndUserAddressObject['availability'],addressLines:[...lines],
      source:{kind:source.kind as 'caller_selection'|'tgt',companyId:source.companyId as string,reference:source.reference as string,
        ...(source.kind==='tgt'?{runId:source.runId as string,stepNo:source.stepNo as number,code:source.code as string,sourceDigest:source.sourceDigest as string}:{})}}
  })
}
/** P26.A pp117-118: preserve source slots; dot is a wire representation only. */
export function prodatEndUserAddressWireLines(lines:readonly string[]):string[] {
  const result=[...lines]
  if(!result[0] && result.slice(1).some(Boolean)) result[0]='.'
  return result
}
export function assertProdatAddressOwnership(objects:readonly ProdatEndUserAddressObject[]|undefined,scope:{companyId?:string|null;runId?:string|null;stepNo?:number|null;code:string}) {
  for(const object of objects??[]) {
    if(!scope.companyId || object.source.companyId!==scope.companyId) return invalid()
    if(object.source.kind==='tgt' && (object.source.runId!==scope.runId || object.source.stepNo!==scope.stepNo || object.source.code!==scope.code)) return invalid()
  }
}
