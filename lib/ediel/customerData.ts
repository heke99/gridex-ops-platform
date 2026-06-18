import type { CommunicationRouteRow } from '@/lib/cis/types'
import { listCommunicationRoutes } from '@/lib/cis/db'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import type { EdielRouteProfileRow } from '@/lib/ediel/types'
import type { EdielRecommendationRouteRow } from '@/lib/ediel/recommendations'
import type { GridOwnerRow } from '@/lib/masterdata/types'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type CustomerEdielMessageRow = {
  id: string
  direction: 'inbound' | 'outbound'
  message_family: string
  message_code: string
  status: string
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  sender_sub_address: string | null
  receiver_sub_address: string | null
  external_reference: string | null
  correlation_reference: string | null
  transaction_reference: string | null
  switch_request_id: string | null
  grid_owner_data_request_id: string | null
  communication_route_id: string | null
  outbound_request_id: string | null
  related_message_id: string | null
  receiver_email: string | null
  created_at: string
  message_received_at: string | null
}

export type CustomerEdielDataBundle = {
  communicationRoutes: CommunicationRouteRow[]
  routeProfiles: EdielRouteProfileRow[]
  edielMessages: CustomerEdielMessageRow[]
  recommendationRoutes: EdielRecommendationRouteRow[]
}

export async function getCustomerEdielDataBundle(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  customerId: string
  gridOwners: GridOwnerRow[]
  companyId?: string | null
}): Promise<CustomerEdielDataBundle> {
  let edielMessagesQuery = params.supabase
    .from('ediel_messages')
    .select(
      'id,direction,message_family,message_code,status,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,external_reference,correlation_reference,transaction_reference,switch_request_id,grid_owner_data_request_id,communication_route_id,outbound_request_id,related_message_id,receiver_email,created_at,message_received_at'
    )
    .eq('customer_id', params.customerId)

  if (params.companyId) {
    edielMessagesQuery = edielMessagesQuery.eq('company_id', params.companyId)
  }

  const [communicationRoutes, edielMessagesRaw] = await Promise.all([
    listCommunicationRoutes({
      routeType: 'ediel_partner',
      companyId: params.companyId ?? null,
    }),
    edielMessagesQuery
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (edielMessagesRaw.error) {
    throw edielMessagesRaw.error
  }

  const routeProfiles = (
    await Promise.all(
      communicationRoutes.map((route: CommunicationRouteRow) =>
        getEdielRouteProfileByCommunicationRouteId(route.id, {
          companyId: route.company_id ?? null,
        })
      )
    )
  ).filter((profile: EdielRouteProfileRow | null): profile is EdielRouteProfileRow => Boolean(profile))

  const profileByRouteId = new Map(
    routeProfiles.map((profile: EdielRouteProfileRow) => [profile.communication_route_id, profile] as const)
  )
  const gridOwnerById = new Map(params.gridOwners.map((row) => [row.id, row]))

  const recommendationRoutes: EdielRecommendationRouteRow[] = communicationRoutes.map(
    (route: CommunicationRouteRow) => {
      const gridOwner = route.grid_owner_id
        ? gridOwnerById.get(route.grid_owner_id) ?? null
        : null

      const profile = profileByRouteId.get(route.id) ?? null

            return {
        id: route.id,
        route_name: route.route_name,
        route_scope: route.route_scope,
        route_type: route.route_type,
        target_email: route.target_email,
        target_system: route.target_system,
        grid_owner_id: route.grid_owner_id,
        grid_owner_name: gridOwner?.name ?? null,
        grid_owner_ediel_id: gridOwner?.ediel_id ?? null,
        is_active: route.is_active,
        profile: profile
          ? {
              is_enabled: profile.is_enabled,
              sender_ediel_id: profile.sender_ediel_id,
              receiver_ediel_id: profile.receiver_ediel_id,
              mailbox: profile.mailbox,
              sender_sub_address: profile.sender_sub_address,
              receiver_sub_address: profile.receiver_sub_address,
              receiver_message_subaddress: profile.receiver_message_subaddress ?? profile.receiver_subaddress ?? null,
              subaddress_required: profile.subaddress_required ?? false,
              application_reference: profile.application_reference,
              environment: profile.environment ?? null,
              message_family: profile.message_family ?? null,
              message_code: profile.message_code ?? profile.business_code ?? null,
              encryption_mode: profile.encryption_mode ?? null,
              transport_security_mode: profile.transport_security_mode ?? null,
              receiver_certificate_id: profile.receiver_certificate_id ?? profile.certificate_id ?? null,
              certificate_required: profile.certificate_required ?? false,
            }
          : null,
      }
    }
  )

  return {
    communicationRoutes,
    routeProfiles,
    edielMessages: (edielMessagesRaw.data ?? []) as CustomerEdielMessageRow[],
    recommendationRoutes,
  }
}