import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {readSignedBrpDeclaration} from '@/lib/ediel/production/signedBrpDeclarationIntake'
import {signedBrpHttp,signedBrpHeaders,signedBrpReadPermissions} from '@/lib/ediel/production/signedBrpDeclarationHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return signedBrpHttp(signedBrpReadPermissions,async guard=>{
 const artifactId=z.string().uuid().parse((await params).artifactId),kind=z.enum(['agreement','source']).parse(request.nextUrl.searchParams.get('kind'))
 const result=await readSignedBrpDeclaration(guard.companyId!,artifactId,true),bytes=Buffer.from(kind==='agreement'?result.agreementBase64!:result.sourceBase64!,'base64'),hash=kind==='agreement'?result.agreementHash:result.sourceHash
 return new NextResponse(new Uint8Array(bytes),{headers:{...signedBrpHeaders,'Content-Type':kind==='agreement'?'application/pdf':'application/octet-stream','Content-Disposition':`attachment; filename="brp-${kind}-${artifactId}.${kind==='agreement'?'pdf':'bin'}"`,'Content-Length':String(bytes.length),ETag:`"${hash}"`}})
})}
