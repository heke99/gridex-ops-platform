import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {revokeSignedBrpDeclaration} from '@/lib/ediel/production/signedBrpDeclarationIntake'
import {signedBrpHttp,signedBrpHeaders,readSignedBrpJson,signedBrpWritePermissions} from '@/lib/ediel/production/signedBrpDeclarationHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return signedBrpHttp(signedBrpWritePermissions,async guard=>{
 const artifactId=z.string().uuid().parse((await params).artifactId),input=z.object({reason:z.string().trim().min(1).max(4000)}).strict().parse(await readSignedBrpJson(request,16*1024))
 return NextResponse.json(await revokeSignedBrpDeclaration(guard.companyId!,artifactId,input.reason),{headers:signedBrpHeaders})
})}
