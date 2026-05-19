import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gridex Energy Operations',
  description:
    'SaaS-plattform för elhandelsbolag med kundintag, operations, Ediel, mätvärden och partnerhandoff.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="sv" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="flex min-h-full flex-col bg-[#f7fbf8] text-slate-900">
        {children}
      </body>
    </html>
  )
}
