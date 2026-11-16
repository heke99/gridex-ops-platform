import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {reviewSignedBrpDeclaration} from '@/lib/ediel/production/signedBrpDeclarationIntake'
import {signedBrpHttp,signedBrpHeaders,signedBrpReview,readSignedBrpJson,signedBrpWritePermissions} from '@/lib/ediel/production/signedBrpDeclarationHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return signedBrpHttp([...signedBrpWritePermissions,'ediel.source.review'],async guard=>{
 const artifactId=z.string().uuid().parse((await params).artifactId),input=signedBrpReview.parse(await readSignedBrpJson(request,128*1024))
 const result=await reviewSignedBrpDeclaration(guard.companyId!,artifactId,input)
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:signedBrpHeaders})
})}
