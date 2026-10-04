import {NextResponse} from 'next/server'
import {archiveContractOriginalSource,contractOriginalScope,listContractOriginalSources,prepareContractOriginalSource,readContractOriginalSource,reviewContractOriginalSource,type ContractOriginalReview,type ContractOriginalSubmission} from '@/lib/ediel/production/contractOriginalSourceIntake'
const REQUEST_MAX_BYTES=29*1024*1024
async function readCommand(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('contract_original_json_required')
 const length=Number(request.headers.get('content-length'));if(length>REQUEST_MAX_BYTES)throw Error('contract_original_request_too_large')
 if(!request.body)throw Error('contract_original_command_required')
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0
 try{for(;;){const{done,value}=await reader.read();if(done)break;total+=value.length;if(total>REQUEST_MAX_BYTES){await reader.cancel();throw Error('contract_original_request_too_large')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown
}
const failure=(e:unknown)=>{const message=e instanceof Error?e.message:'',large=message==='contract_original_request_too_large';return NextResponse.json({error:large?'contract_original_request_too_large':'contract_original_command_not_authorized_or_invalid'},{status:large?413:400})}
export async function GET(request:Request){try{const u=new URL(request.url),artifactId=u.searchParams.get('artifactId'),contractId=u.searchParams.get('contractId');if(u.searchParams.size!==1||(!artifactId&&!contractId))return NextResponse.json({error:'contract_original_selector_required'},{status:400});return NextResponse.json(artifactId?await readContractOriginalSource(artifactId):await listContractOriginalSources(contractId!))}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const body=await readCommand(request);if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'contract_original_command_invalid'},{status:400})
 const b=body as Record<string,unknown>,allowed:Record<string,string[]>={archive:['operation','contractId','environment','kind','agreementBase64','sourceBase64','issuerKeyId','representationId','signatureHex'],review:['operation','artifactId','sourceHash','agreementHash','claimsHash','decision','reason'],prepare:['operation','artifactId'],scope:['operation','contractId','environment','kind']},fields=Object.hasOwn(allowed,String(b.operation))?allowed[String(b.operation)]:null
 if(!fields||Object.keys(b).length!==fields.length||fields.some(k=>!(k in b)))return NextResponse.json({error:'contract_original_exact_command_required'},{status:400})
 const{operation,...input}=b
 const result=operation==='archive'?await archiveContractOriginalSource(input as ContractOriginalSubmission):operation==='review'?await reviewContractOriginalSource(input as ContractOriginalReview):operation==='scope'?await contractOriginalScope(input as Parameters<typeof contractOriginalScope>[0]):await prepareContractOriginalSource(input.artifactId as string)
 return NextResponse.json(result)
}catch(e){return failure(e)}}
