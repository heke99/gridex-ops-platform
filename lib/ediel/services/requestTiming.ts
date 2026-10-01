import {z} from 'zod'
import {evaluateCanonicalEdielActionDeadline} from '@/lib/ediel/rulebook/deadlinePolicy'

const date=z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value=>{const day=new Date(value+'T00:00:00Z');return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value}),uuid=z.string().uuid()
const captured=z.object({version:z.literal(1),evidenceId:uuid,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),sourceReference:z.string().min(1),sourceVersion:z.string().min(1),networkStart:date,networkEnd:date.nullable(),reviewId:uuid,reviewerUserId:uuid,reviewSequence:z.number().int().positive(),scopeBasisVersion:z.number().int().positive(),requestDay:date}).strict()
export type CapturedServiceRequestTiming=z.infer<typeof captured>
/** Native owner supplies the actual immutable source proof. This assertion
 * grants no authority; it verifies the protected result against the canonical
 * calendar using its captured server day, without selecting another source. */
export function assertCapturedServiceRequestTiming(basis:{code:'Z13'|'Z18';mode:'V'|'VH';scopeBasisVersion:number;requestTiming?:unknown;objects:{reportStart?:string;reportEnd?:string|null}[]}){
 if(basis.code!=='Z13')return
 const proof=captured.parse(basis.requestTiming)
 if(proof.scopeBasisVersion!==basis.scopeBasisVersion||!basis.objects.length)throw Error('ediel_service_request_timing_scope_mismatch')
 const marketDay=(value:string)=>{const instant=new Date(value);if(!Number.isFinite(instant.getTime()))throw Error('ediel_service_request_source_period_invalid');return new Date(instant.getTime()+3_600_000).toISOString().slice(0,10)}
 for(const object of basis.objects){
  if(!object.reportStart)throw Error('ediel_service_request_source_period_required')
  const start=marketDay(object.reportStart),end=object.reportEnd?marketDay(object.reportEnd):null
  const result=evaluateCanonicalEdielActionDeadline({actionType:basis.mode==='VH'?'request_historical_metering_access':'request_metering_access',requestedDate:start,historicalStartDate:start,historicalEndDate:end,networkContractStartDate:proof.networkStart,now:new Date(proof.requestDay+'T12:00:00Z')})
  if(!result.ok||proof.networkEnd!==null&&(start>proof.networkEnd||end!==null&&end>proof.networkEnd)||basis.mode==='V'&&(end!==null&&end<=proof.requestDay||proof.networkEnd!==null&&proof.networkEnd<proof.requestDay)||object.reportEnd&&new Date(object.reportEnd).getTime()<=new Date(object.reportStart).getTime())throw Error('ediel_service_request_source_period_outside_captured_bounds')
 }
}
