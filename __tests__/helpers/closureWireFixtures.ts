import {raw,line,characteristic,type Parts,alphabets} from '../fixtures/prodat-register'
import {head} from '../fixtures/prodat-identity'
import type {SourceObjectScope} from '@/lib/ediel/sources/sourceOwnerWire'

export const CLOSURE_OBJECT='735123456789012345'
export function closureFixture(options:{reason?:string;minute?:string;document?:string;li?:string;alphabet?:readonly string[];count?:number}={}){
  const {reason='Z22',minute='202610151234',document='CLOSE-DOC',li='CLOSE-CASE',alphabet=alphabets[0],count=1}=options
  const body:Parts[]=[...head()]
  for(let i=0;i<count;i++)body.push(line(String(i+1),i===0?CLOSURE_OBJECT:`73512345678901234${i}`,undefined,'9'),
    ['DTM',['93',minute,'203']],...characteristic('Z13',reason),
    ['RFF',['Z05','NET-1']],['RFF',['LI',li]],
    ['NAD','UD',['CUSTOMER-1','','89'],'','Synthetic','Street','City','','12345','SE'],
    ['NAD','IT',[i===0?CLOSURE_OBJECT:`73512345678901234${i}`,'','9'],'','','Street','Town','','12345','SE'],
    ['NAD','Z02',['11111','160','SVK']])
  const [component,data,release]=alphabet
  const encode=(value:string)=>[...value].map(ch=>alphabet.includes(ch)?release+ch:ch).join('')
  const wire=raw(body,'Z05',alphabet)
    .replace(`${data}S${data}R${data}`,`${data}12345${component}14${data}54321${component}14${data}`)
    .replace(`BGM${data}Z05${data}D${data}`,`BGM${data}Z05${data}${encode(document)}${data}`)
  const scope:SourceObjectScope={messageIndex:0,messageReference:'M',objectId:CLOSURE_OBJECT,identityAgency:'9',
    registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:7}]}
  return {wire,scope}
}
