import {NextRequest,NextResponse} from 'next/server'
import {readRequestedCustomerChangeSourceArtifact} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {requestedCustomerChangeHttp,requestedCustomerChangeHeaders,artifactSelector} from '@/lib/ediel/production/requestedCustomerChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return requestedCustomerChangeHttp(['communication.read','customers.read','contracts.read'],async guard=>{const artifactId=artifactSelector.parse((await params).artifactId);return NextResponse.json(await readRequestedCustomerChangeSourceArtifact({artifactId,companyId:guard.companyId!,actorUserId:guard.userId}),{headers:requestedCustomerChangeHeaders})})}
