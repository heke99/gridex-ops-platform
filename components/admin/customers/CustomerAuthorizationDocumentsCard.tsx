'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RelationsResponse } from '@/components/admin/customers/document-card/types'
import type { CustomerAuthorizationDocumentsCardProps } from '@/components/admin/customers/document-card/types'
import UploadForm from '@/components/admin/customers/document-card/UploadForm'
import DocumentHistoryList from '@/components/admin/customers/document-card/DocumentHistoryList'

export default function CustomerAuthorizationDocumentsCard({
  customerId,
  sites,
  meteringPoints,
  documents,
  powersOfAttorney,
}: CustomerAuthorizationDocumentsCardProps) {
  const [relations, setRelations] = useState<RelationsResponse>({
    gridOwnerDataRequests: [],
    outboundRequests: [],
    switchRequests: [],
    documentAuditLogs: [],
  })

  useEffect(() => {
    let cancelled = false

    async function loadRelations() {
      try {
        const response = await fetch(
          `/api/admin/customer-documents/relations?customerId=${encodeURIComponent(customerId)}`,
          {
            method: 'GET',
            cache: 'no-store',
          }
        )

        if (!response.ok) return

        const json = (await response.json()) as RelationsResponse
        if (!cancelled) {
          setRelations({
            gridOwnerDataRequests: json.gridOwnerDataRequests ?? [],
            outboundRequests: json.outboundRequests ?? [],
            switchRequests: json.switchRequests ?? [],
            documentAuditLogs: json.documentAuditLogs ?? [],
          })
        }
      } catch {
        // tyst fallback
      }
    }

    loadRelations()

    return () => {
      cancelled = true
    }
  }, [customerId])

  const documentsForRender = useMemo(() => {
    return [...documents].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (a.status !== 'active' && b.status === 'active') return 1
      return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    })
  }, [documents])

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <UploadForm customerId={customerId} sites={sites} documents={documents} />

      <div className="space-y-6">
        <DocumentHistoryList
          customerId={customerId}
          sites={sites}
          documentsForRender={documentsForRender}
          powersOfAttorney={powersOfAttorney}
          relations={relations}
        />
      </div>
    </section>
  )
}