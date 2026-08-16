import type { Metadata } from 'next'
import PartnerApiDocumentationPage from '../partner-api/page'

export const metadata: Metadata = {
  title: 'Partner API v1 | Gridex Developers',
  description:
    'Canonical backend-to-backend integration API for electricity suppliers: contracts, customers, sites, invoices, measurements and signed change notifications.',
}

export const revalidate = 3600

export default function CustomerPortalApiDocumentationPage() {
  return <PartnerApiDocumentationPage />
}
