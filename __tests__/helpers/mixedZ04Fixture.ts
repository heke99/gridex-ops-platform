import {head} from '../fixtures/prodat-identity'
import {line,qty,common,characteristic,type Parts} from '../fixtures/prodat-register'

// P26.A r3 pp. 47, 54, 114–116: second physical object omits its own
// QTY+31/field 213; the first object remains source-valid.
// PRODAT D.97A LIN group order: CCI/CAV groups precede the RFF and NAD groups.
function withCharacteristics(object:string,customer:string): Parts[] {
  const parts=common(object,customer),at=parts.findIndex(part=>part[0]==='RFF')
  const extra=[...characteristic('Z07','Z12'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3)]
  return [...parts.slice(0,at),...extra,...parts.slice(at)]
}
export function mixedZ04Parts(): Parts[] {
  return [...head(),line('1','735123456789012345','1','9'),qty('10'),...withCharacteristics('735123456789012345','A'),
    ['NAD','IT',['735123456789012345','','9'],'','Installation','Street','City','','12345','SE'],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
    line('2','735123456789012345','2','9'),
    line('3','735123456789012352',undefined,'9'),qty('30'),...withCharacteristics('735123456789012352','B'),
    ['NAD','IT',['735123456789012352','','9'],'','Installation','Street','City','','12345','SE'],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE']]
}
