// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// National denial input oracle only. No test registration or source authority.
import {expect} from 'vitest'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'
import {omitPermissionField} from './ediel-permission-field-omissions'

export type EscoNationalField='203'|'205'|'206'|'207'|'208'|'313'|'322'
export function omitEscoNationalField(raw:string,field:EscoNationalField,input:{sender:string;receiver:string;li:string;status:'A13'|'A76'}){
 const original=tokenizeEdifact(raw),{segments:s,una:u}=original,e=u.dataElementSeparator,c=u.componentDataElementSeparator
 expect(raw).toBe(serializeUna(u)+s.map(row=>row.raw).join(u.segmentTerminator)+u.segmentTerminator)
 for(const delimiter of [e,c,u.segmentTerminator])expect(raw.includes(u.releaseCharacter+delimiter)).toBe(false)
 for(const tag of ['UNB','UNH','BGM','UNT','UNZ','LIN'])expect(s.filter(row=>row.tag===tag)).toHaveLength(1)
 expect(s.slice(0,8).map(row=>row.tag)).toEqual(['UNB','UNH','BGM','DTM','DTM','NAD','NAD','LIN'])
 expect(segmentComposite(s[0],2,u)[0]).toBe(input.sender);expect(segmentComposite(s[0],3,u)[0]).toBe(input.receiver)
 expect(segmentComposite(s[0],7,u)).toEqual(['23-DGI-PRODAT'])
 expect(segmentComposite(s[1],1,u)).toEqual(['1']);expect(segmentComposite(s[1],2,u)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(segmentComposite(s[2],1,u)).toEqual(['Z14']);expect(segmentComposite(s[2],2,u)[0]).toBeTruthy()
 expect(segmentComposite(s[2],3,u)).toEqual(['9']);expect(segmentComposite(s[2],4,u)).toEqual(['AB'])
 expect(segmentComposite(s[3],1,u)[0]).toBe('137');expect(segmentComposite(s[4],1,u)).toEqual(['ZZZ','1','805'])
 expect(segmentComposite(s[5],1,u)).toEqual(['FR']);expect(segmentComposite(s[5],2,u)).toEqual([input.sender,'160','SVK'])
 expect(segmentComposite(s[6],1,u)).toEqual(['DO']);expect(segmentComposite(s[6],2,u)).toEqual([input.receiver,'160','SVK'])
 expect(s[7].raw).toBe('LIN'+e+'1');expect(s[7].index).toBe(7)
 expect(s.filter(row=>row.tag==='NAD'&&['UD','IT'].includes(segmentComposite(row,1,u)[0]??''))).toEqual([])
 expect(s.filter(row=>row.tag==='RFF'&&['Z05','Z09'].includes(segmentComposite(row,1,u)[0]??''))).toEqual([])
 const li=s.filter(row=>row.tag==='RFF'&&segmentComposite(row,1,u)[0]==='LI')
 expect(li).toHaveLength(1);expect(segmentComposite(li[0],1,u)).toEqual(['LI',input.li])
 for(const [qualifier,value] of [['Z13','Z96'],['Z23',input.status]] as const){
  const positions=s.flatMap((row,i)=>row.tag==='CCI'&&segmentComposite(row,2,u)[0]===qualifier?[i]:[])
  expect(positions).toHaveLength(1);expect(positions[0]).toBeGreaterThan(7)
  expect(s[positions[0]].raw).toBe('CCI'+e+e+qualifier);expect(s[positions[0]+1].raw).toBe('CAV'+e+value)
  expect(s[positions[0]+2]?.tag).not.toBe('CAV')
 }
 const tag=field==='205'||field==='206'?'DTM':field==='207'||field==='208'?'NAD':field==='322'?'CCI':'BGM'
 const qualifier=field==='205'?'137':field==='206'?'ZZZ':field==='207'?'FR':field==='208'?'DO':field==='322'?'Z23':null
 const target=s.flatMap((row,i)=>row.tag===tag&&(qualifier===null||segmentComposite(row,tag==='CCI'?2:1,u)[0]===qualifier)?[i]:[])
 expect(target).toHaveLength(1);const at=target[0],expected=s.map(row=>row.raw)
 if(tag==='DTM')expected.splice(at,1)
 else if(tag==='CCI')expected.splice(at,2)
 else{
  const elements=expected[at].split(e),position=tag==='NAD'?2:field==='203'?2:4
  if(tag==='NAD'){const parts=elements[position].split(c);parts[0]='';elements[position]=parts.join(c)}
  else elements[position]=''
  expected[at]=elements.join(e)
 }
 const unh=expected.findIndex(row=>row.startsWith('UNH'+e)),unt=expected.findIndex(row=>row.startsWith('UNT'+e))
 const trailer=expected[unt].split(e);trailer[1]=String(unt-unh+1);expected[unt]=trailer.join(e)
 const result=omitPermissionField(raw,field),actual=tokenizeEdifact(result)
 expect(result).not.toBe(raw);expect(actual.una).toEqual(u);expect(actual.segments.map(row=>row.raw)).toEqual(expected)
 expect(actual.segments.filter(row=>row.tag==='LIN').map(row=>({raw:row.raw,index:row.index})))
  .toEqual([{raw:'LIN'+e+'1',index:field==='205'||field==='206'?6:7}])
 return result
}
