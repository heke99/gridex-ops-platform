'use client'

import Link from 'next/link'
import { customerProfileEditHref } from '../../../lib/admin/customerProfileLinks'

/** Also reopens the editor when Next navigation keeps the current profile mounted. */
export default function CustomerProfileEditLink({ customerId, className }: { customerId: string; className?: string }) {
  const href = customerProfileEditHref(customerId)
  return <Link href={href} className={className} onClick={() => {
    const target = new URL(href, window.location.href)
    if (target.pathname !== window.location.pathname || new URLSearchParams(window.location.search).get('tab') !== 'profile') return
    const panel = document.getElementById('edit-customer-profile')
    if (panel instanceof HTMLDetailsElement) panel.open = true
  }}>Ändra uppgifter</Link>
}
