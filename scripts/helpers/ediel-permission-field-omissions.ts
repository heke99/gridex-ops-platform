import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'

// Independent P26.A r3 pp15–16/25–26 field-path oracle. Do not derive the
// expected requirements or omission positions from the runtime field matrix.
// Applies only to the single-message synthetic permission fixtures.
export const permissionRequiredFields=['311','312','202','203','313','205','206','207','208','314','209','327','223','322','324','260','226','325','227','228','316'] as const
export type PermissionField=typeof permissionRequiredFields[number]
export function omitPermissionField(raw:string,field:PermissionField):string{
 const wire=tokenizeEdifact(raw),u=wire.una,e=u.dataElementSeparator,c=u.componentDataElementSeparator
 if(raw.includes(u.releaseCharacter+e)||raw.includes(u.releaseCharacter+c)||raw.includes(u.releaseCharacter+u.segmentTerminator))throw Error('omission_fixture_escaped_data_not_supported')
 const q=({'205':'137','206':'ZZZ','327':'164','223':'Z13','322':'Z23','324':'Z25','260':'Z05','226':'LI','325':'Z09'} as Partial<Record<PermissionField,string>>)[field]
 const characteristic=['223','322','324'].includes(field)
 const result:string[]=[]
 let removeCav=false,removed=false
 for(const segment of wire.segments){
  const p=segment.raw.split(e),tag=p[0]
  if(characteristic&&tag==='CCI')removeCav=p[2]===q
  if(characteristic&&(tag==='CCI'&&removeCav||tag==='CAV'&&removeCav)){removed=true;continue}
  if(q&&(['205','206','327'].includes(field)?tag==='DTM':['260','226','325'].includes(field)?tag==='RFF':false)&&p[1]?.split(c)[0]===q){removed=true;continue}
  let position:number|undefined,component:number|undefined
  if(field==='311'&&tag==='UNB')position=7
  if(field==='312'&&tag==='UNH'){position=2;component=4}
  if(tag==='BGM')position=({'202':1,'203':2,'313':4} as Partial<Record<PermissionField,number>>)[field]
  if(tag==='LIN'){
   if(field==='314')position=1
   if(field==='209')position=3
  }
  if(tag==='NAD'){
   if(field==='207'&&p[1]==='FR'||field==='208'&&p[1]==='DO'){position=2;component=0}
   if(p[1]==='UD'){
    if(field==='227'){position=2;component=0}
    if(field==='228')position=4
    if(field==='316')position=9
   }
  }
  if(position!==undefined){
   if(component!==undefined){const parts=(p[position]??'').split(c);parts[component]='';p[position]=parts.join(c)}
   else p[position]=''
   removed=true
  }
  result.push(p.join(e))
 }
 if(!removed)throw Error('omission_fixture_field_absent_'+field)
 const start=result.findIndex(s=>s.startsWith('UNH'+e)),end=result.findIndex(s=>s.startsWith('UNT'+e))
 if(start<0||end<start||result.filter(s=>s.startsWith('UNH'+e)).length!==1)throw Error('omission_fixture_single_message_required')
 const trailer=result[end].split(e);trailer[1]=String(end-start+1);result[end]=trailer.join(e)
 return serializeUna(u)+result.join(u.segmentTerminator)+u.segmentTerminator
}
