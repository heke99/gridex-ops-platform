import {raw,type Parts} from '../fixtures/prodat-register'

/** Synthetic fixture construction only, with literal values unchanged. Independent
 * D97A group8 positions0300..0650: LIN, DTM, QTY, CCI/CAV, RFF, NAD.
 * This never changes a received production original or approves a source. */
export function guideOrderedFixtureBody(body:readonly Parts[]):Parts[]{
 const result:Parts[]=[],groups:Parts[][]=[];let own:Parts[]|null=null
 for(const part of body){if(part[0]==='LIN'){own=[];groups.push(own)}if(own)own.push(part);else result.push(part)}
 const rank=(part:Parts)=>part[0]==='LIN'?0:part[0]==='DTM'?1:part[0]==='QTY'?2:part[0]==='CCI'||part[0]==='CAV'?3:part[0]==='RFF'?4:part[0]==='NAD'?5:6
 for(const group of groups)result.push(...[...group].sort((a,b)=>rank(a)-rank(b)))
 return result
}
export const guideOrderedFixtureRaw:typeof raw=(body,code,alphabet)=>raw(guideOrderedFixtureBody(body),code,alphabet)
