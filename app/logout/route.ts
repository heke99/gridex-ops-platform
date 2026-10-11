import { NextResponse } from 'next/server'
import { getBaseAppUrl } from '@/lib/auth/urls'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(new URL('/login', getBaseAppUrl()), 303)
}

// Signing out on GET would let any cross-site link or prefetch end the
// session, so GET only renders a confirmation form that POSTs back here.
export async function GET() {
  const html = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Logga ut</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:32px;max-width:420px;width:100%;text-align:center}
button{background:#0f172a;color:#fff;border:0;border-radius:16px;padding:12px 20px;font-weight:600;font-size:14px;cursor:pointer}
a{display:inline-block;margin-top:16px;color:#475569;font-size:14px}
</style>
</head>
<body>
<main>
<h1 style="font-size:22px;margin:0 0 8px">Vill du logga ut?</h1>
<p style="color:#475569;font-size:14px;margin:0 0 20px">Bekräfta för att avsluta din session.</p>
<form method="post" action="/logout"><button type="submit">Logga ut</button></form>
<a href="/">Avbryt</a>
</main>
</body>
</html>`
  return new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  })
}
