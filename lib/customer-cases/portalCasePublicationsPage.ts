import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { supabaseService } from '@/lib/supabase/service'
import { publicReference } from '@/lib/integrations/publicReferences'
import { SupportCommandError } from '@/lib/customer-operations/supportCommand'
import type { SupportReadContext } from '@/lib/customer-cases/customerRead'
import type { CustomerPortalCaseRow } from '@/lib/customer-portal/types'

type Select = ReturnType<ReturnType<typeof supabaseService.from>['select']>
const threadSchema = z.object({ id: z.string().uuid(), public_reference: z.string() })
const publicationSchema = z.object({
  id: z.string().uuid(), customer_case_id: z.string().uuid(), customer_id: z.string().uuid(),
  revision: z.number().int().positive().safe(), public_status: z.enum(['open', 'waiting_for_customer', 'resolved', 'closed']),
  public_title: z.string(), public_body: z.string(), published_at: z.string(),
  channel: z.enum(['ops', 'phone']), author_user_id: z.string().uuid(),
})

// References come from the guarded canonical support read, including an
// independently guarded selected conversation. This lookup only decorates
// those rows with their current immutable customer-visible publication.
export async function readPortalCasePublicationsPage(context: SupportReadContext, references: readonly string[]): Promise<Map<string, CustomerPortalCaseRow>> {
  const selected = [...new Set(references)]
  if (!selected.length) return new Map()
  if (selected.length > 101 || selected.some(reference => !/^case_[A-Za-z0-9_-]{32}$/.test(reference))) {
    throw new SupportCommandError('support_result_invalid', 503)
  }
  const { data: threadData, error: threadError } = await (tenantDb(context.companyId)
    .from('customer_support_threads').select('id,public_reference') as Select)
    .eq('customer_id', context.customerId).in('public_reference', selected).limit(selected.length)
  if (threadError) throw threadError
  const threads = z.array(threadSchema).safeParse(threadData)
  if (!threads.success || threads.data.length !== selected.length || new Set(threads.data.map(row => row.public_reference)).size !== selected.length ||
      threads.data.some(row => !selected.includes(row.public_reference) || row.public_reference !== publicReference('case', context.companyId, row.id))) {
    throw new SupportCommandError('support_result_invalid', 503)
  }
  // The thread's composite FK binds id/company/customer to the canonical case;
  // publication ownership is selected with that same company/customer/id tuple.
  const referenceById = new Map(threads.data.map(row => [row.id, row.public_reference]))
  const { data, error } = await (tenantDb(context.companyId)
    .from('customer_case_publications')
    .select('id,customer_case_id,customer_id,revision,public_status,public_title,public_body,published_at,channel,author_user_id') as Select)
    .eq('customer_id', context.customerId).in('customer_case_id', [...referenceById.keys()])
    .is('revoked_at', null).limit(selected.length)
  if (error) throw error
  const publications = z.array(publicationSchema).safeParse(data)
  if (!publications.success || publications.data.some(row => row.customer_id !== context.customerId || !referenceById.has(row.customer_case_id)) ||
      new Set(publications.data.map(row => row.customer_case_id)).size !== publications.data.length) {
    throw new SupportCommandError('support_result_invalid', 503)
  }
  return new Map(publications.data.map(row => [referenceById.get(row.customer_case_id)!, row]))
}
