export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Glömt lösenord</h1>
        <p className="mt-3 text-sm text-slate-600">
          Den här delen kopplar vi in direkt efter login-flödet. Först säkrar vi
          grundinloggningen för hela appen.
        </p>
      </div>
    </main>
  )
}