// Work-state metadata comes from gridex_website_application_work_items_v. Keep
// status categorization in that read model so filters, list KPIs and dashboards
// cannot independently drop a new application state.
export type WebsiteApplicationWorkState =
  | 'action_required' | 'ready' | 'waiting' | 'failed' | 'completed' | 'closed'

export type WebsiteApplicationWorkMetadata = {
  work_state?: WebsiteApplicationWorkState
  is_pending?: boolean
}

export function applicationWorkState(item: WebsiteApplicationWorkMetadata): WebsiteApplicationWorkState {
  return item.work_state ?? 'action_required'
}

export function isPendingWebsiteApplication(item: WebsiteApplicationWorkMetadata): boolean {
  return item.is_pending ?? !['completed', 'closed'].includes(applicationWorkState(item))
}
