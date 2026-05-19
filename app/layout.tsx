import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gridex Operations',
  description:
    'Operationsplattform för elhandelsbolag med kundintag, avtal, Ediel, mätvärden och faktureringsunderlag.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="sv" data-scroll-behavior="smooth" className="h-full scroll-smooth antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  )
}