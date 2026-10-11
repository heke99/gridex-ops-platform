import {guideOrderedFixtureRaw as raw} from '../../__tests__/helpers/prodatGuideOrderedFixture'
import {line,qty,common,characteristic,type Parts} from '../../__tests__/fixtures/prodat-register'
import {head} from '../../__tests__/fixtures/prodat-identity'
/** Original own data is explicit test-only fixture facts. The positive object's
 * LI/customer/date are copied from its real native outbound origination. */
export function mixedProdatNativeWire(input:{external:string;sender:string;receiver:string;customerIdentity:{id:string;qualifier:string;agency:string};caseReference:string;startMinute:string;negativePoint:string;ownReadingDeclarations?:boolean}){
 // Positive native sources opt in before original birth. Default hold-only
 // sources retain their literal wire; later registers still lack their own213.
 const readings=():Parts[]=>input.ownReadingDeclarations===true?[
  ...characteristic('Z02','1',3),...characteristic('Z05','6',3),...characteristic('Z16','111',3)
 ]:[]
 const block=(index:string,point:string,li:string,register?:string):Parts[]=>[
  line(index,point,register,'9'),qty('1000'),...common(point,'Synthetic',input.startMinute),
  ...readings(),
  ...characteristic('Z07','Z12'),...characteristic('Z12','D',3),...characteristic('Z15','D'),['CCI','','Z14'],['CAV',['','','','L917','8716867000030']],
  ['NAD','IT',[point,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[input.sender,'160','SVK']]
 ].map(part=>part[0]==='RFF'&&Array.isArray(part[1])&&part[1][0]==='LI'?['RFF',['LI',li]]:
  part[0]==='RFF'&&Array.isArray(part[1])&&part[1][0]==='Z05'?['RFF',['Z05','TES']]:
  part[0]==='NAD'&&part[1]==='UD'?['NAD','UD',[input.customerIdentity.id,input.customerIdentity.qualifier,input.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE']:part)
 const body=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[input.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[input.sender,'160','SVK'],'','','','','','','SE']:p),
  ...block('1',input.negativePoint,'NEGATIVE-OWN','1'),line('2',input.negativePoint,'2','9'),...readings(),...block('3',input.external,input.caseReference)] as Parts[]
 // Test-environment interchange: acknowledgement request and UNB test indicator.
 const wire=raw(body,'Z04').replace('+S+R+',`+${input.receiver}:14+${input.sender}:14+`)
 if(!wire.includes("+23-DDQ-PRODAT'"))throw Error('mixed_prodat_unb_shape_changed')
 return wire.replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
}
