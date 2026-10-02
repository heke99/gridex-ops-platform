"use client";

import { useActionState, useState } from "react";
import {
  removeProviderAction,
  saveOidcProviderAction,
  saveTenantKeyProviderAction,
  setEnforcementAction,
  testProviderAction,
  type CustomerLoginActionState,
} from "@/app/admin/customer-login/actions";

export type CustomerLoginProviderView = {
  kind: "oidc" | "tenant_key";
  display_name: string;
  issuer: string;
  audience: string;
  enforcement: "report" | "enforce";
  last_tested_at: string | null;
  last_test_result: { ok?: boolean; key_count?: number } | null;
};

const initial: CustomerLoginActionState = { ok: false, message: "" };
const card = "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";
const input = "rounded-2xl border border-slate-300 px-4 py-3 text-sm";
const primary = "rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800 disabled:opacity-50";

function Message({ state }: { state: CustomerLoginActionState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`mt-3 rounded-2xl px-4 py-3 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
      {state.ok ? "✓ " : ""}{state.message}
    </p>
  );
}

function Copy({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-xl bg-slate-100 px-3 py-2">{value}</code>
        <button type="button" className={secondary} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>
          {copied ? "Kopierad" : "Kopiera"}
        </button>
      </div>
    </div>
  );
}

/** Generates an RS256 key pair in the browser; the private key is downloaded and never sent anywhere. */
async function generateKeyPair(): Promise<{ publicJwk: string; privatePem: string; kid: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const kid = `gridex-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const base64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n");
  return {
    publicJwk: JSON.stringify({ kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, kid }),
    privatePem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`,
    kid,
  };
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/x-pem-file" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CustomerLoginSetup({
  companyId, provider, tenantKeyIssuer, tenantKeyAudience,
}: {
  companyId: string;
  provider: CustomerLoginProviderView | null;
  tenantKeyIssuer: string;
  tenantKeyAudience: string;
}) {
  const [choice, setChoice] = useState<"oidc" | "tenant_key">(provider?.kind ?? "oidc");
  const [editing, setEditing] = useState(!provider);
  const [oidcState, oidcAction, oidcPending] = useActionState(saveOidcProviderAction, initial);
  const [keyState, keyAction, keyPending] = useActionState(saveTenantKeyProviderAction, initial);
  const [testState, testAction, testPending] = useActionState(testProviderAction, initial);
  const [enforceState, enforceAction, enforcePending] = useActionState(setEnforcementAction, initial);
  const [removeState, removeAction, removePending] = useActionState(removeProviderAction, initial);
  const [publicJwk, setPublicJwk] = useState("");
  const [keyReady, setKeyReady] = useState(false);
  const hidden = <input type="hidden" name="expected_company_id" value={companyId} />;

  return (
    <div className="grid gap-6 lg:max-w-3xl">
      {provider && !editing && (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-emerald-700">✓ Kundinloggning är inställd</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{provider.display_name}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {provider.kind === "oidc" ? `Leverantör: ${provider.issuer}` : "Egen inloggning med er nyckel"}
                {provider.last_tested_at ? ` · Senast testad ${new Date(provider.last_tested_at).toLocaleString("sv-SE")}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <form action={testAction}>{hidden}<button className={secondary} disabled={testPending}>{testPending ? "Testar…" : "Testa"}</button></form>
              <button type="button" className={secondary} onClick={() => setEditing(true)}>Ändra</button>
            </div>
          </div>
          <Message state={testState} />

          <form action={enforceAction} className="mt-6 rounded-2xl bg-slate-50 p-4">
            {hidden}
            <p className="text-sm font-semibold text-slate-900">Kräv verifierad kund</p>
            <p className="mt-1 text-sm text-slate-600">
              Börja med &quot;Logga bara&quot; och kontrollera att er Mina sidor skickar kundintyget. Slå sedan på kravet.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button name="enforcement" value="report" disabled={enforcePending || provider.enforcement === "report"}
                className={provider.enforcement === "report" ? primary : secondary}>Logga bara</button>
              <button name="enforcement" value="enforce" disabled={enforcePending || provider.enforcement === "enforce"}
                className={provider.enforcement === "enforce" ? primary : secondary}>Kräv verifierad kund</button>
            </div>
            <Message state={enforceState} />
          </form>

          <form action={removeAction} className="mt-4">
            {hidden}
            <button className="text-sm text-red-700 underline" disabled={removePending}
              onClick={(event) => { if (!confirm("Ta bort kundinloggningen? API:t fungerar då som tidigare.")) event.preventDefault(); }}>
              Ta bort kundinloggning
            </button>
            <Message state={removeState} />
          </form>
        </section>
      )}

      {editing && (
        <section className={card}>
          <h2 className="text-lg font-semibold text-slate-950">1. Hur loggar era kunder in?</h2>
          <p className="mt-1 text-sm text-slate-600">Ni lämnar aldrig lösenord, hemliga nycklar eller BankID-avtal till oss.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([
              ["oidc", "BankID, Freja eller annan leverantör", "Ni använder en inloggningstjänst (t.ex. Criipto, Signicat, Freja, Auth0)."],
              ["tenant_key", "Egen inloggning", "Lösenord eller engångskod i ert eget system."],
            ] as const).map(([value, title, description]) => (
              <button key={value} type="button" onClick={() => setChoice(value)} aria-pressed={choice === value}
                className={`rounded-2xl border p-4 text-left ${choice === value ? "border-slate-900 ring-2 ring-slate-900" : "border-slate-300"}`}>
                <span className="block text-sm font-semibold text-slate-900">{title}</span>
                <span className="mt-1 block text-sm text-slate-600">{description}</span>
              </button>
            ))}
          </div>

          {choice === "oidc" ? (
            <form action={oidcAction} className="mt-6 grid gap-4">
              {hidden}
              <h3 className="text-base font-semibold text-slate-900">2. Fyll i två uppgifter från er leverantör</h3>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Leverantörens adress</span>
                <input name="issuer" required placeholder="https://er-inloggning.leverantor.se" className={input} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Client-ID</span>
                <input name="client_id" required placeholder="Det ID ni fick av leverantören" className={input} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Namn (valfritt)</span>
                <input name="display_name" placeholder="T.ex. BankID via Criipto" className={input} />
              </label>
              <div><button className={primary} disabled={oidcPending}>{oidcPending ? "Kontrollerar…" : "Spara och testa"}</button></div>
              <Message state={oidcState} />
            </form>
          ) : (
            <form action={keyAction} className="mt-6 grid gap-4">
              {hidden}
              <input type="hidden" name="public_jwk" value={publicJwk} />
              <h3 className="text-base font-semibold text-slate-900">2. Skapa er nyckel</h3>
              <p className="text-sm text-slate-600">
                Nyckeln skapas i er webbläsare. Den privata delen laddas ner till er dator och lämnar den aldrig mot Gridex. Ge filen till den som bygger er Mina sidor.
              </p>
              <div>
                <button type="button" className={secondary} disabled={keyReady} onClick={async () => {
                  const pair = await generateKeyPair();
                  download(`gridex-kundintyg-${pair.kid}.pem`, pair.privatePem);
                  setPublicJwk(pair.publicJwk);
                  setKeyReady(true);
                }}>{keyReady ? "✓ Nyckel skapad och nedladdad" : "Skapa och ladda ner nyckel"}</button>
              </div>
              <div className="grid gap-3 rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">Värden er utvecklare ska använda i kundintyget:</p>
                <Copy label="iss (utfärdare)" value={tenantKeyIssuer} />
                <Copy label="aud (mottagare)" value={tenantKeyAudience} />
              </div>
              <div><button className={primary} disabled={!keyReady || keyPending}>{keyPending ? "Sparar…" : "Spara"}</button></div>
              <Message state={keyState} />
            </form>
          )}
          {provider && <button type="button" className="mt-4 text-sm text-slate-600 underline" onClick={() => setEditing(false)}>Avbryt</button>}
        </section>
      )}

      <section className={`${card} text-sm text-slate-700`}>
        <h2 className="text-base font-semibold text-slate-950">Så fungerar det</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Er kund loggar in på er Mina sidor som vanligt.</li>
          <li>Er server skickar med kundens inloggningsintyg i rubriken <code>x-gridex-customer-assertion</code>.</li>
          <li>Gridex kontrollerar intyget själv. Med &quot;Kräv verifierad kund&quot; nekas anrop utan giltigt intyg.</li>
        </ol>
      </section>
    </div>
  );
}
