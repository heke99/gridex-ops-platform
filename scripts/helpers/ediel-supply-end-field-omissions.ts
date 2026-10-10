import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'

// Frozen P26.A r3 independent physical paths, single-message fixture only.
// Numeric requirement expectations do not come from runtime descriptors.
export const h05Required=['311','312','202','203','313','205','206','207','208','314','209','211','223','260','226','227','228','231','232','316','233','234','262'] as const
export function omitSupplyEndField(raw:string,field:string){
 const {segments,una}=tokenizeEdifact(raw),e=una.dataElementSeparator,c=una.componentDataElementSeparator,result:string[]=[]
 if([e,c,una.segmentTerminator].some(x=>raw.includes(una.releaseCharacter+x)))throw Error('native_omission_escaped_fixture_not_supported')
 let removed=false,dropCav=false
 for(const token of segments){
  const p=token.raw.split(e),q=(p[1]??'').split(c)[0]
  if(field==='223'&&token.tag==='CCI')dropCav=p[2]==='Z13'
  if(field==='223'&&(token.tag==='CCI'&&dropCav||token.tag==='CAV'&&dropCav)){removed=true;continue}
  if((field==='205'&&token.tag==='DTM'&&q==='137')||(field==='206'&&token.tag==='DTM'&&q==='ZZZ')||(field==='211'&&token.tag==='DTM'&&q==='93')||(field==='260'&&token.tag==='RFF'&&q==='Z05')||(field==='226'&&token.tag==='RFF'&&q==='LI')||(['UD','IT','IV'].includes(field)&&token.tag==='NAD'&&q===field)){removed=true;continue}
  let pos:number|undefined,part:number|undefined
  if(field==='311'&&token.tag==='UNB')pos=7
  if(field==='312'&&token.tag==='UNH'){pos=2;part=4}
  if(token.tag==='BGM')pos=({'202':1,'203':2,'313':4} as Record<string,number>)[field]
  if(token.tag==='LIN'){pos=({'314':1,'209':3} as Record<string,number>)[field];if(field==='209')part=0}
  if(token.tag==='NAD'){
   if(field==='207country'&&q==='FR'||field==='208country'&&q==='DO')pos=9
   if(field==='207'&&q==='FR'||field==='208'&&q==='DO'||field==='262'&&q==='Z02'){pos=2;part=0}
   if(q==='UD'){pos=({'227':2,'228':4,'231':8,'232':6,'316':9,'229':5} as Record<string,number>)[field];if(field==='227')part=0}
   if(q==='IT'){pos=({'233':2,'234':5} as Record<string,number>)[field];if(field==='233')part=0}
   if(q==='IV'){pos=({'250':2,'251':4,'252':5,'253':8,'317':6,'318':9} as Record<string,number>)[field];if(field==='250')part=0}
  }
  if(pos!==undefined){if(part!==undefined){const a=(p[pos]??'').split(c);a[part]='';p[pos]=a.join(c)}else p[pos]='';removed=true}
  result.push(p.join(e))
 }
 if(!removed)throw Error('native_omission_field_absent_'+field)
 const first=result.findIndex(x=>x.startsWith('UNH'+e)),last=result.findIndex(x=>x.startsWith('UNT'+e))
 if(first<0||last<=first||result.filter(x=>x.startsWith('UNH'+e)).length!==1)throw Error('native_omission_single_message_required')
 const trailer=result[last].split(e);trailer[1]=String(last-first+1);result[last]=trailer.join(e)
 return serializeUna(una)+result.join(una.segmentTerminator)+una.segmentTerminator
}
