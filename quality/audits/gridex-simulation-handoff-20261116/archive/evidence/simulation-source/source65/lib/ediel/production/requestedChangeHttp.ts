import {NextResponse} from 'next/server'
import {z, ZodError} from 'zod'
import {requireAdminApiAccess} from '@/lib/admin/apiGuards'
import type {GuardResult} from '@/lib/admin/guards'
import {REQUESTED_CHANGE_SOURCE_MAX_BYTES} from './requestedChangeIntake'

export const requestedChangeHeaders = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
const text = (max: number) => z.string().trim().min(1).max(max)
const identity = z.object({id:text(35),qualifier:z.enum(['','1','SE1','SE2']),agency:z.enum(['89','260'])}).strict()
const component = z.union([z.string().max(35),z.null(),z.object({unavailable:z.literal(true)}).strict()])
const address = z.object({lines:z.tuple([component,component,component]),city:component,postalCode:component,country:component,
  representation:z.object({convention:text(200),reference:text(2000),mode:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)])}).strict().nullable()}).strict()
export const requestedChangeSubmission = z.object({supplyPeriodId:z.string().uuid(),contractId:z.string().uuid(),kind:z.enum(['death','quarter_contract','method_contract']),
  effectiveAt:z.string().datetime({offset:true}),source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(REQUESTED_CHANGE_SOURCE_MAX_BYTES/3)*4),
    mimeType:z.enum(['application/pdf','text/plain','application/json']),reference:text(2000),version:text(200)}).strict(),
  customerIdentity:identity.extend({name:text(35),addressLines:z.array(z.string().max(35)).min(1).max(3),city:text(35),postalCode:text(9),country:z.string().regex(/^[A-Z]{2,3}$/)}).strict(),
  invoiceeProfile:z.object({meteringPointId:text(35),identityAgency:z.enum(['9','89']),endUser:z.object({identity,address}).strict(),
    invoicee:z.object({identity,nameLines:z.array(text(35)).min(1).max(5),address,availability:z.enum(['available','unavailable','unknown'])}).strict(),
    event:z.union([z.object({state:z.literal('unknown')}).strict(),z.object({state:z.literal('none'),reference:text(2000)}).strict()])}).strict(),
  issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(65536),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),
}).strict()
export const requestedChangeReview = z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),claimsHash:z.string().regex(/^[a-f0-9]{64}$/),
  decision:z.enum(['approve','hold','reject']),reason:text(4000),clause:z.object({locator:text(1000),quote:text(10000)}).strict().optional()}).strict()
export const artifactSelector = z.string().uuid()

export class RequestedChangeBodyLimit extends Error {}
/** Bound the bytes before JSON parsing, even when Content-Length is absent. */
export async function readRequestedChangeJson(request:Request,limit:number):Promise<unknown>{
 const declared=request.headers.get('content-length')
 if(declared&&/^\d+$/.test(declared)&&Number(declared)>limit)throw new RequestedChangeBodyLimit()
 if(!request.body)throw new SyntaxError('body_required')
 const reader=request.body.getReader(),parts:Uint8Array[]=[];let length=0
 try {while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>limit){await reader.cancel();throw new RequestedChangeBodyLimit()}parts.push(next.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new SyntaxError('utf8_required')}
 return JSON.parse(text)
}

/** Every domain call additionally verifies current membership/own grants in the
 * native transaction. A platform role cannot supply source or reviewer authority. */
export async function requestedChangeHttp(permissions:string[],work:(guard:GuardResult)=>Promise<Response>):Promise<Response>{
  let authorizationRead=false
  try {
    const access=await requireAdminApiAccess({allOf:permissions});authorizationRead=true
    if(access.response){for(const[k,v]of Object.entries(requestedChangeHeaders))access.response.headers.set(k,v);return access.response}
    if(!access.guard.companyId)return NextResponse.json({error:'Välj ett behörigt bolag.'},{status:403,headers:requestedChangeHeaders})
    return await work(access.guard)
  }catch(error){
    const tooLarge=error instanceof RequestedChangeBodyLimit,invalid=error instanceof ZodError||error instanceof SyntaxError
    return NextResponse.json({error:!authorizationRead?'Behörigheten kunde inte verifieras.':tooLarge?'Underlaget är för stort.':invalid?'Ogiltigt källunderlag eller granskningsval.':'Underlaget är inte tillgängligt med aktuell behörighet och källauktoritet.'},
      {status:!authorizationRead?503:tooLarge?413:invalid?400:403,headers:requestedChangeHeaders})
  }
}
