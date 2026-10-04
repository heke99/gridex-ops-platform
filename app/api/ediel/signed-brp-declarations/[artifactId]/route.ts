import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {readSignedBrpDeclaration} from '@/lib/ediel/production/signedBrpDeclarationIntake'
import {signedBrpHttp,signedBrpHeaders,signedBrpReadPermissions} from '@/lib/ediel/production/signedBrpDeclarationHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return signedBrpHttp(signedBrpReadPermissions,async guard=>{
 const artifactId=z.string().uuid().parse((await params).artifactId)
 return NextResponse.json(await readSignedBrpDeclaration(guard.companyId!,artifactId),{headers:signedBrpHeaders})
})}
