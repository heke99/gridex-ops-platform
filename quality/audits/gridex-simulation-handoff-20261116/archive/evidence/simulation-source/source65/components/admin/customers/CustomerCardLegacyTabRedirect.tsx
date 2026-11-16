'use client'

import { useEffect } from 'react'

/**
 * The customer card is a single structured page. Older deep links still use
 * ?tab=<id>. This client helper takes the anchor that the server already
 * resolved from the legacy tab, scrolls to it, and strips ?tab= from the URL so
 * the page no longer behaves like a tab-driven view. If no legacy tab was
 * present it does nothing.
 */
export default function CustomerCardLegacyTabRedirect({
  anchor,
}: {
  anchor: string | null
}) {
  useEffect(() => {
    if (!anchor) return

    const url = new URL(window.location.href)
    if (url.searchParams.has('tab')) {
      url.searchParams.delete('tab')
      const cleaned = `${url.pathname}${url.search}#${anchor}`
      window.history.replaceState(window.history.state, '', cleaned)
    }

    const target = document.getElementById(anchor)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [anchor])

  return null
}
