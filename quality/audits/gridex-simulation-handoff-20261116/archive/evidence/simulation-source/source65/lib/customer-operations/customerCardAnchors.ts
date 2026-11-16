// Single source of truth that maps the legacy customer-workspace "tab" ids to
// the anchors of the one-page customer card. The customer card is no longer a
// tab-driven UI: every section renders on one structured page and navigation is
// done with in-page anchors (#overview, #avtal, #anlaggning, ...). Legacy
// ?tab= links (bookmarks, deep links from other admin pages) are mapped to the
// matching anchor so they keep working without re-introducing tab navigation.

export const CUSTOMER_CARD_ANCHORS = {
  overview: "overview",
  "legal-readiness": "avtal",
  contracts: "avtal",
  "authorization-documents": "avtal",
  "switch-operations": "leverantorsbyte",
  "supplier-switch": "leverantorsbyte",
  facility: "anlaggning",
  "billing-metering": "fakturering",
  analytics: "fakturering",
  sites: "anlaggning",
  "metering-points": "anlaggning",
  "grid-owner-import": "anlaggning",
  "data-requests": "data-requests",
  notes: "anteckningar",
  communication: "tekniskt",
  "ediel-operations": "tekniskt",
  audit: "tekniskt",
  "technical-details": "tekniskt",
  "portal-access": "tekniskt",
  "lifecycle-decisions": "tekniskt",
  profile: "overview",
  "contacts-addresses": "overview",
} as const;

export type CustomerCardTabKey = keyof typeof CUSTOMER_CARD_ANCHORS;

/**
 * Resolve any legacy tab id (or unknown value) to a safe one-page anchor.
 * Unknown values fall back to the overview anchor so the page never breaks.
 */
export function customerCardAnchor(tab: string | null | undefined): string {
  if (tab && Object.prototype.hasOwnProperty.call(CUSTOMER_CARD_ANCHORS, tab)) {
    return CUSTOMER_CARD_ANCHORS[tab as CustomerCardTabKey];
  }
  return "overview";
}
