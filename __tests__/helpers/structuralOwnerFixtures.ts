import {raw,line,characteristic,qty,type Parts} from '../fixtures/prodat-register'
import {head,source,z10} from '../fixtures/prodat-identity'
import {ownerSource,OWNER} from './sourceOwnerFixtures'
import type {EdielMessageRow} from '@/lib/ediel/types'

/** Synthetic complete original bytes. Expectations do not come from a runtime
 * serialization. The actual canonical engine must accept every fixture. */
export function structuralOwnerSource(code:'Z04'|'Z06'|'Z10'='Z04',reason='E64',document='BASE',replacement=false):EdielMessageRow{
  let body:Parts[]
  if(code==='Z10'){
    body=z10().map(parts=>parts[0]==='DTM'&&Array.isArray(parts[1])&&parts[1][0]==='157'?['DTM',['157','202610150000','203']]:parts)
    body.splice(body.findIndex(parts=>parts[0]==='RFF'),0,...characteristic('Z16','101',3))
    body=body.map(parts=>parts[0]==='RFF'&&Array.isArray(parts[1])&&parts[1][0]==='Z02'?['RFF',['Z02','METER-1']]:parts)
  }else{
    body=[...head(),line('1',OWNER.external,undefined,'9'),
      ['DTM',['92','202610010000','203']],...(code==='Z06'?[['DTM',['157','202610150000','203']]] as Parts[]:[]),
      ['DTM',['354','15','806']],qty('1000'),...characteristic('Z13',code==='Z04'?'Z22':reason),
      ...characteristic('Z04','Z04'),...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),
      ['CCI','','Z14'],['CAV',['','','','L639Q','8716867000030']],...characteristic('Z16','101',3),
      ['RFF',['MG','METER-1']],['RFF',['Z05','NET-1']],['RFF',['LI','CASE-1']],
      ...(code==='Z04'||reason==='E34'?[['NAD','UD',['CUSTOMER-1','','89'],'','Synthetic','Street','City','','12345','SE']] as Parts[]:[]),
      ['NAD','IT',[OWNER.external,'','9'],'','','Street','Town','','12345','SE'],
      ['NAD','Z02',['11111','160','SVK']]]

  }
  if(code!=='Z06'||reason==='E64')body.splice(body.findIndex(parts=>parts[0]==='RFF'),0,...characteristic('Z02','1',3),...characteristic('Z05','6',3))
  let wire=raw(body,code).replace('+S+R+','+12345:14+54321:14+')
  wire=wire.replace(`BGM+${code}+D+9+AB`, `BGM+${code}+${document}+${replacement?'5':'9'}+AB`)
  const baseline=ownerSource()
  return {...baseline,...source(wire,code),company_id:OWNER.company,customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,
    message_received_at:baseline.message_received_at,parsed_payload:{...baseline.parsed_payload as object,
      prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:true},subtype:code==='Z04'?'L':code==='Z10'?'M':reason==='E34'?'E':reason==='E32'?'G':'F'},execution_context_snapshot:{}} as EdielMessageRow
}
