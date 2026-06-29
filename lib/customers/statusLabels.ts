export function customerStatusLabel(value: string | null | undefined): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'active': return 'Aktiv kund'
    case 'application_received': return 'Ny ansökan'
    case 'pending_validation': return 'Väntar på kontroll'
    case 'needs_information': return 'Saknar uppgifter'
    case 'needs_facility_data': return 'Anläggningsuppgifter saknas'
    case 'facility_data_requested': return 'Uppgifter begärda från nätägare'
    case 'ready_for_switch': return 'Redo för leverantörsbyte'
    case 'switch_requested': return 'Leverantörsbyte startat'
    case 'cancelled': return 'Avbruten'
    case 'withdrawn': return 'Ångrad'
    case 'rejected': return 'Avvisad'
    case 'archived': return 'Arkiverad'
    case 'terminated': return 'Avslutad'
    case 'moved': return 'Utflyttad'
    case 'draft': return 'Utkast'
    case 'pending_signature': return 'Väntar signering'
    case 'signed': return 'Signerad'
    case 'failed': return 'Fel kräver åtgärd'
    case 'manual_review': return 'Kräver manuell kontroll'
    default: return humanizeTechnicalValue(value)
  }
}

export function intakeStatusLabel(value: string | null | undefined): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'application_received': return 'Ny ansökan'
    case 'received': return 'Mottagen'
    case 'customer_created': return 'Kund skapad'
    case 'customer_matched': return 'Kund matchad'
    case 'linked_existing_customer': return 'Kopplad till befintlig kund'
    case 'needs_information': return 'Saknar uppgifter'
    case 'needs_address_resolution': return 'Adress behöver kontrolleras'
    case 'needs_facility_data': return 'Anläggningsuppgifter saknas'
    case 'facility_data_requested': return 'Uppgifter begärda från nätägare'
    case 'facility_data_received': return 'Anläggningsuppgifter mottagna'
    case 'information_request_ready': return 'Redo att begära uppgifter'
    case 'information_request_sent': return 'Uppgifter begärda'
    case 'waiting_grid_owner_response': return 'Väntar på nätägare'
    case 'address_resolved': return 'Adress matchad'
    case 'grid_area_resolved': return 'Nätområde matchat'
    case 'ready_for_switch': return 'Redo för leverantörsbyte'
    case 'switch_requested': return 'Leverantörsbyte startat'
    case 'switch_confirmed': return 'Leverantörsbyte bekräftat'
    case 'active': return 'Aktiv kund'
    case 'completed': return 'Klar'
    case 'pending_review': return 'Kräver granskning'
    case 'manual_review': return 'Kräver manuell kontroll'
    case 'confirmation_pending': return 'Väntar bekräftelse'
    case 'webhook_pending': return 'Väntar synk'
    case 'failed': return 'Fel kräver åtgärd'
    case 'rejected': return 'Avvisad'
    case 'cancelled': return 'Avbruten'
    case 'switch_rejected': return 'Leverantörsbyte avvisat'
    case 'negative_aperak_received': return 'Nätägaren avvisade uppgiften'
    case 'z02_rejected': return 'Nätägaren kunde inte bekräfta uppgiften'
    case 'grid_owner_rejected_request': return 'Nätägaren avvisade begäran'
    case 'duplicate_facility_id': return 'Anläggnings-ID finns redan'
    case 'cross_tenant_facility_conflict': return 'Anläggnings-ID behöver verifieras innan automation'
    case 'protected_identity': return 'Skyddad identitet kräver manuell process'
    default: return humanizeTechnicalValue(value)
  }
}

export function missingFieldLabel(value: string | null | undefined): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'metering_point_id': return 'Mätpunkt saknas'
    case 'facility_id': return 'Anläggnings-ID saknas'
    case 'facility_verified': return 'Anläggningen är inte verifierad'
    case 'power_of_attorney': return 'Fullmakt saknas'
    case 'grid_owner_id': return 'Nätägare saknas'
    case 'grid_area_code': return 'Nätområdeskod saknas'
    case 'price_area_code': return 'Prisområde saknas'
    case 'customer_identity': return 'Kundidentitet behöver kontrolleras'
    case 'requested_start_date': return 'Startdatum saknas'
    case 'contract': return 'Avtal saknas'
    default: return humanizeTechnicalValue(value)
  }
}

export function sourceLabel(value: string | null | undefined): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'website': return 'Hemsida'
    case 'api': return 'API'
    case 'manual': return 'Manuell registrering'
    case 'external_contract_intake': return 'Ansökan från hemsida'
    case 'customer_portal': return 'Mina sidor'
    default: return humanizeTechnicalValue(value)
  }
}

export function gridOwnerVerificationLabel(value: string | null | undefined): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'verified': return 'Verifierad'
    case 'strong_match': return 'Stark matchning'
    case 'suggested': return 'Föreslagen nätägare'
    case 'unidentified': return 'Ej identifierad nätägare'
    case 'conflict': return 'Konflikt'
    case 'manual_review': return 'Kräver manuell kontroll'
    case 'route_missing': return 'Saknar route'
    case 'certificate_missing': return 'Saknar certifikat'
    case 'contact_missing': return 'Saknar kontaktväg'
    default: return humanizeTechnicalValue(value)
  }
}

export function humanizeTechnicalValue(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  return raw
    .replace(/_/g, ' ')
    .replace(/\bapi\b/gi, 'API')
    .replace(/\bediel\b/gi, 'Ediel')
    .replace(/\bprodat\b/gi, 'PRODAT')
    .replace(/\butilts\b/gi, 'UTILTS')
    .replace(/^./, (char) => char.toUpperCase())
}
