import {head} from '../fixtures/prodat-identity'
import {line,qty,common,characteristic,type Parts} from '../fixtures/prodat-register'

// P26.A r3 pp. 47, 54, 114–116: second physical object omits its own
// QTY+31/field 213; the first object remains source-valid.
export function mixedZ04Parts(): Parts[] {
  return [...head(),line('1','735123456789012345','1','9'),qty('10'),...common('735123456789012345','A'),
    ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
    ['NAD','IT',['735123456789012345','','9'],'','Installation','Street','City','','12345','SE'],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
    line('2','735123456789012345','2','9'),
    line('3','735123456789012352',undefined,'9'),qty('30'),...common('735123456789012352','B'),
    ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
    ['NAD','IT',['735123456789012352','','9'],'','Installation','Street','City','','12345','SE'],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE']]
}
