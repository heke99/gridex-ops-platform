import { supabaseService } from "@/lib/supabase/service";

export type InfoRequestPortalReply = {
  id: string;
  customer_id: string;
  site_id?: string | null;
  completion_type: string;
  status: string;
  submitted_payload: Record<string, unknown>;
  linked_info_request_id: string | null;
  created_at: string;
};

type RequestAnchor = { id: string; customer_id: string; site_id?: string | null; created_at: string };

/**
 * Matches customer portal completions to info requests: an explicit
 * linked_info_request_id wins; otherwise an unlinked completion from the same
 * customer submitted after the request is shown on the most recent earlier
 * request for that customer.
 */
export function matchPortalRepliesToRequests(
  requests: RequestAnchor[],
  replies: InfoRequestPortalReply[],
): Map<string, InfoRequestPortalReply[]> {
  const result = new Map<string, InfoRequestPortalReply[]>();
  const byId = new Map(requests.map(request => [request.id, request]));
  const byCustomer = new Map<string, RequestAnchor[]>();
  for (const request of requests) {
    const list = byCustomer.get(request.customer_id) ?? [];
    list.push(request);
    byCustomer.set(request.customer_id, list);
  }
  for (const list of byCustomer.values()) {
    list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  for (const reply of replies) {
    let target: string | null = null;
    if (reply.linked_info_request_id) {
      const linked = byId.get(reply.linked_info_request_id);
      if (linked?.customer_id === reply.customer_id && (!reply.site_id || linked.site_id === reply.site_id)) {
        target = linked.id;
      }
    } else if (reply.completion_type !== "info_request_reply") {
      const replyAt = Date.parse(reply.created_at);
      const candidate = (byCustomer.get(reply.customer_id) ?? []).find(
        (request) => Date.parse(request.created_at) <= replyAt,
      );
      target = candidate?.id ?? null;
    }
    if (!target) continue;
    const list = result.get(target) ?? [];
    list.push(reply);
    result.set(target, list);
  }
  return result;
}

export async function listPortalRepliesForInfoRequests(
  companyId: string,
  requests: RequestAnchor[],
): Promise<Map<string, InfoRequestPortalReply[]>> {
  if (requests.length === 0) return new Map();
  const customerIds = [...new Set(requests.map((request) => request.customer_id))];
  const earliest = requests
    .map((request) => request.created_at)
    .sort()[0];
  const projection = "id, customer_id, site_id, completion_type, status, submitted_payload, linked_info_request_id, created_at";
  const baseQuery = () => supabaseService
    .from("customer_portal_completions")
    .select(projection)
    .eq("company_id", companyId)
    .in("customer_id", customerIds)
    .gte("created_at", earliest)
    .order("created_at", { ascending: false })
    .limit(200);
  const [linked, historical] = await Promise.all([
    baseQuery().in("linked_info_request_id", requests.map(request => request.id)),
    baseQuery().is("linked_info_request_id", null),
  ]);
  if (linked.error) throw linked.error;
  if (historical.error) throw historical.error;
  const replies = [...(linked.data ?? []), ...(historical.data ?? [])] as InfoRequestPortalReply[];
  replies.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return matchPortalRepliesToRequests(requests, replies);
}
