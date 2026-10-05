import {characteristic, line, raw, type Parts} from './prodat-register'
import type {MeterChangeSelection} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
// Independent synthetic oracle: P26.A pp20,67–69,76,110,119,122–123.
export function meterChange(changed = false): MeterChangeSelection {
 const ref = (key: string) => ({key,revision:'assessment-2',eventKey:'replacement-A',reference:`independent:${key}`})
 return {source:{kind:'caller_selection',reference:'synthetic independently assessed replacement'},market:'electricity',objects:[{
  objectKey:'object-A',event:ref('replacement-A'),customer:{kind:'domain_customer',customerKey:'customer-A',revision:'customer-1'},
  installation:{id:'A',agency:'89'},legalGridOwner:{id:'GRID',qualifier:'',agency:'9'},legalSupplier:{id:'SUPPLIER',qualifier:'',agency:'9'},
  reason:'E58',effectiveMinute:'202610010000',li:'EVENT-A',
  oldMeter:{number:'OLD-A',settlement:{kind:'known',value:'Z31',evidence:ref('old-settlement')},product:{kind:'known',value:'L917',evidence:ref('old-product')}},
  newMeter:{number:'NEW-A',settlement:{kind:'known',value:changed?'Z32':'Z31',evidence:ref('new-settlement')},product:{kind:'known',value:changed?'L639Q':'L917',evidence:ref('new-product')}},
  newMeterThreshold:{kind:'applicable',below:false,regime:{key:'regime-document',revision:'document-19',reference:'independent regime'},assessment:{...ref('threshold-assessment'),regimeKey:'regime-document',regimeRevision:'document-19'}},
 }]}
}
export function changeBody(fields: Parts[] = [], id = 'A', sequence = '1'): Parts[] {
 return [line(sequence,id),['DTM',['157','202610010000','203']],...characteristic('Z13','E58'),...characteristic('Z04','Z04'),...fields,
  ['RFF',['MG',`NEW-${id}`]],['RFF',['Z02',`OLD-${id}`]],['RFF',['LI',`EVENT-${id}`]]]
}
export const changeFields = (settlement = 'Z32', product = 'L639Q') => [...characteristic('Z15',settlement),...characteristic('Z14',product,3)]
export const changeRaw = (body = changeBody(), alphabet?:readonly string[]) => raw([['NAD','FR',['GRID','','9']],['NAD','DO',['SUPPLIER','','9']],...body],'Z10',alphabet)
