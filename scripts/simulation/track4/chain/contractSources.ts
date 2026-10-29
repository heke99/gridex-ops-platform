// Dated customer sources the Z03 builder requires for a past requested start (genuine path, local synthetic issuer).
//
// For a Z03 whose requested start day is not "today", base 1c0c088c qualifies the customer's identity/registered address only from a
// signed-contract masterdata DECLARATION (gridex_customer_masterdata.signed_declarations; ediel_prepare_customer_masterdata_v1 returns
// held 'source_qualified_customer_identity_registered_address_at_requested_time' otherwise). The registered-address row
// (customer_addresses type 'registered') only counts when the requested day is the current day. The requested metering method is
// likewise a signed-contract declaration. Both enter through the product's contract-original intake RPCs
// (ediel_archive_contract_original_source_v1 by a requesting actor, ediel_review_contract_original_source_v1 by an independent
// reviewer; admin entrypoint app/admin/ediel/contract-originals, API /api/admin/ediel/contract-originals), signed by an issuer key.
// The issuer is an external legal source; here it is a LOCAL SYNTHETIC counterpart: a key and representation registered by SQL
// (SYNTHETIC competence, like the project's native fixtures) and a receipt signed with that key's HMAC secret by this file.
//
// Pattern origin: scripts/helpers/ediel-z09fg-composition-inputs-native-producer.ts (archive(), actor()) at base 1c0c088c, ported;
// the RPC calls are called as authenticated users (JWT sessions), not with the service role.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { nativeActorRoleSql } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { literal, sql } from './vendor/scripts/helpers/live-chain-fixture'

export type SourceActor = { id: string; email: string; password: string; client: SupabaseClient }
const PERMISSIONS = ['communication.read', 'communication.write', 'customers.read', 'customers.write', 'contracts.read', 'contracts.write', 'metering.read', 'metering.write', 'ediel.source.review']
const digest = (v: Buffer | string) => createHash('sha256').update(v).digest('hex')

/** A disposable company actor with the intake permissions (role grants, as the canonical tenant context projects only those). */
export async function createSourceActor(companyId: string, label: string): Promise<SourceActor> {
  const email = `t4-${label}-${randomUUID().slice(0, 8)}@example.invalid`, password = `T4-${randomBytes(18).toString('base64url')}Aa1!`
  const created = await supabaseService.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw Error(`source_actor_create_failed:${created.error?.message}`)
  const id = created.data.user.id
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'T4 source actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(id)},'member','active',clock_timestamp(),'member',true,clock_timestamp(),'member');
   ${nativeActorRoleSql(companyId, id)}
   INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT r.id,r.key,p.id,p.key FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
     JOIN public.permissions p ON p.key=ANY(ARRAY[${PERMISSIONS.map(literal).join(',')}]::text[]) WHERE ur.user_id=${literal(id)} AND ur.company_id=${literal(companyId)} AND r.key LIKE 'native_actor_%';`)
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error) throw Error(`source_actor_sign_in_failed:${signed.error.message}`)
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId })
  const granted = (context.data as { permissions?: string[] } | null)?.permissions ?? []
  const missing = PERMISSIONS.filter((p) => !granted.includes(p))
  if (context.error || missing.length) throw Error(`source_actor_permissions_missing:${missing.join(',')}${context.error ? `:${context.error.message}` : ''}`)
  return { id, email, password, client }
}

/** The archived signed agreement PDF of a contract, read from storage (bytes hash must equal contract.document_sha256). */
export async function loadSignedAgreementPdf(companyId: string, contractId: string): Promise<{ pdf: Buffer; sha256: string }> {
  const row = sql<{ path: string; sha: string }>(`SELECT jsonb_build_object('path',d.storage_path,'sha',d.document_sha256) FROM public.customer_contract_documents d
    WHERE d.company_id=${literal(companyId)} AND d.customer_contract_id=${literal(contractId)} AND d.document_type='signed_contract_pdf' ORDER BY d.created_at LIMIT 1`)
  if (!row) throw Error('signed_agreement_pdf_not_archived')
  const downloaded = await supabaseService.storage.from('customer-contract-documents').download(row.path)
  if (downloaded.error || !downloaded.data) throw Error(`signed_agreement_pdf_download_failed:${downloaded.error?.message}`)
  const pdf = Buffer.from(await downloaded.data.arrayBuffer())
  if (digest(pdf) !== row.sha) throw Error('signed_agreement_pdf_hash_mismatch')
  // The contract carries the agreement hash the declarations are bound to (the product's own archiver normally sets it; bind only when empty).
  sql(`UPDATE public.customer_contracts SET document_sha256=${literal(row.sha)} WHERE id=${literal(contractId)} AND company_id=${literal(companyId)} AND document_sha256 IS NULL`)
  return { pdf, sha256: row.sha }
}

type Kind = 'masterdata_declaration' | 'contract_requested_method'
const PURPOSE: Record<Kind, string> = { masterdata_declaration: 'signed_contract_customer_masterdata', contract_requested_method: 'signed_contract_requested_metering_method' }

/** Archive (requesting actor) and independently review (second actor) one signed-contract original through the product's RPCs. */
export async function archiveContractOriginal(f: { companyId: string; contractId: string; pdf: Buffer; request: SourceActor; reviewer: SourceActor; kind: Kind; claims: Record<string, unknown> }) {
  const scope = await f.request.client.rpc('ediel_contract_intake_scope_v1', { p_company_id: f.companyId, p_actor_user_id: f.request.id, p_contract_id: f.contractId, p_environment: 'test', p_kind: f.kind })
  if (scope.error) throw Error(`intake_scope_failed:${f.kind}:${JSON.stringify(scope.error)}`)
  const nativeScope = scope.data as { legalActorId: string }
  if (!nativeScope?.legalActorId) throw Error(`intake_scope_without_legal_actor:${f.kind}:${JSON.stringify(scope.data)}`)
  const key = randomUUID(), representation = randomUUID(), signingKey = randomBytes(32)
  const legal = 'SYNTHETIC T4 issuer competence ONLY', rep = 'SYNTHETIC T4 kind-specific representation ONLY'
  sql(`INSERT INTO gridex_contract_source_intake.issuer_keys(id,company_id,environment,issuer_code,legal_authority_reference,legal_authority_source_hash,signing_key,valid_from,valid_to)
     VALUES(${literal(key)},${literal(f.companyId)},'test','SYNTHETIC T4',${literal(legal)},${literal(digest(legal))},decode(${literal(signingKey.toString('hex'))},'hex'),clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
   INSERT INTO gridex_contract_source_intake.representations(id,company_id,environment,issuer_key_id,legal_actor_id,kind,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to)
     VALUES(${literal(representation)},${literal(f.companyId)},'test',${literal(key)},${literal(nativeScope.legalActorId)},${literal(f.kind)},${literal(rep)},${literal(digest(rep))},clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');`)
  const now = sql<string>('SELECT to_jsonb(clock_timestamp())')
  const bytes = Buffer.from(JSON.stringify({ format: 'ediel_contract_original_source_v1', agreementHash: digest(f.pdf), claims: { sourceReference: `SYNTHETIC T4 ${randomUUID()}`, sourceVersion: '1', ...f.claims },
    expiresAt: new Date(Date.parse(now) + 3_600_000).toISOString(), issuedAt: now, issuerCode: 'SYNTHETIC T4', legalAuthorityReference: legal, nativeScope, purpose: PURPOSE[f.kind], receiptId: randomUUID(), representationReference: rep }))
  const captured = await f.request.client.rpc('ediel_archive_contract_original_source_v1', { p_company_id: f.companyId, p_actor_user_id: f.request.id, p_contract_id: f.contractId, p_environment: 'test', p_kind: f.kind,
    p_submission: { agreementBase64: f.pdf.toString('base64'), sourceBase64: bytes.toString('base64'), issuerKeyId: key, representationId: representation, signatureHex: createHmac('sha256', signingKey).update(bytes).digest('hex') } })
  if (captured.error) throw Error(`archive_failed:${f.kind}:${JSON.stringify(captured.error)}`)
  const a = captured.data as { status: string; artifactId: string; sourceHash: string; agreementHash: string; claimsHash: string; missing: string[] }
  if (a.status !== 'archived') throw Error(`archive_not_archived:${f.kind}:${JSON.stringify(a)}`)
  const reviewed = await f.reviewer.client.rpc('ediel_review_contract_original_source_v1', { p_company_id: f.companyId, p_actor_user_id: f.reviewer.id, p_artifact_id: a.artifactId,
    p_review: { sourceHash: a.sourceHash, agreementHash: a.agreementHash, claimsHash: a.claimsHash, decision: 'approve', reason: 'SYNTHETIC independently reviewed exact kind/source bytes' } })
  if (reviewed.error) throw Error(`review_failed:${f.kind}:${JSON.stringify(reviewed.error)}`)
  const r = reviewed.data as { status: string; sourceId?: string }
  if (r.status !== 'authorized') throw Error(`review_not_authorized:${f.kind}:${JSON.stringify(r)}`)
  return { kind: f.kind, artifactId: a.artifactId, sourceId: r.sourceId ?? null, sourceHash: a.sourceHash, archivedMissing: a.missing }
}
