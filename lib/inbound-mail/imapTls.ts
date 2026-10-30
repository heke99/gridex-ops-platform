// Sim finding 20261029-3f1a8ab1/claude-track3/014: IMAP transport security.
//
// Every IMAP connection must use either implicit TLS (IMAPS, `secure: true`) or
// mandatory STARTTLS (`secure: false, doSTARTTLS: true`). With
// `doSTARTTLS: true` ImapFlow throws "Server does not support STARTTLS" before
// LOGIN when the server does not offer STARTTLS (no silent downgrade). Leaving
// `doSTARTTLS` unset is opportunistic (downgradable) and `false` is cleartext.
//
// Cleartext is only possible through server configuration
// (GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK=true) for a loopback host outside
// production. The mailbox environment must be explicitly "test" (unknown or
// missing environment fails closed to STARTTLS). Tenant/user input (mailbox metadata, admin forms) can never
// select cleartext or disable certificate verification.

export const IMAP_PLAINTEXT_LOOPBACK_ENV = "GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK";

export type ImapTlsOptions =
  | { secure: true; tls: { rejectUnauthorized: true } }
  | { secure: false; doSTARTTLS: true; tls: { rejectUnauthorized: true } }
  | { secure: false; doSTARTTLS: false };

export type ResolveImapTlsInput = {
  host: string;
  port: number;
  /** Requested implicit TLS (IMAPS). Never a cleartext switch. */
  secure?: boolean | null;
  /** Mailbox environment ("test" | "production"). */
  environment: string | null | undefined;
  /** Caller-supplied certificate policy; `false` is always refused. */
  rejectUnauthorized?: boolean | null;
  /** Server env (defaults to process.env); never derived from tenant input. */
  env?: Record<string, string | undefined>;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

export function isLoopbackImapHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

function isProduction(
  environment: string | null | undefined,
  env: Record<string, string | undefined>,
): boolean {
  return (
    environment === "production" ||
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production"
  );
}

export function resolveImapTls(input: ResolveImapTlsInput): ImapTlsOptions {
  const env = input.env ?? process.env;
  if (input.rejectUnauthorized === false) {
    throw new Error(
      "IMAP-certifikatverifiering får inte stängas av (tls.rejectUnauthorized=false nekas).",
    );
  }
  const host = input.host.trim();
  if (input.port === 993 || input.secure === true) {
    return { secure: true, tls: { rejectUnauthorized: true } };
  }
  if (
    env[IMAP_PLAINTEXT_LOOPBACK_ENV] === "true" &&
    isLoopbackImapHost(host) &&
    input.environment === "test" &&
    !isProduction(input.environment, env)
  ) {
    console.warn("[inbound-mail] IMAP plaintext loopback opt-out active", {
      host,
      port: input.port,
      environment: input.environment ?? null,
    });
    return { secure: false, doSTARTTLS: false };
  }
  return { secure: false, doSTARTTLS: true, tls: { rejectUnauthorized: true } };
}

const PLAINTEXT_FORM_FIELDS = [
  "imap_allow_plaintext",
  "imap_plaintext",
  "imap_insecure",
] as const;

/**
 * Admin save path: validates the requested IMAP transport and returns the
 * value to persist for `imap_secure` (true = IMAPS, false = mandatory STARTTLS).
 * Form input can never request cleartext or disable certificate checks; the
 * loopback opt-out is evaluated only at connection time from server env.
 */
export function resolveImapSecureForSave(input: {
  formData: FormData;
  host: string;
  port: number;
  secure: boolean | null;
  environment: string;
}): boolean {
  for (const key of PLAINTEXT_FORM_FIELDS) {
    const value = input.formData.get(key);
    if (typeof value === "string" && ["on", "true", "1", "yes"].includes(value.toLowerCase())) {
      throw new Error("IMAP i klartext kan inte väljas; använd IMAPS (993) eller STARTTLS.");
    }
  }
  const reject = input.formData.get("imap_tls_reject_unauthorized");
  if (typeof reject === "string" && ["off", "false", "0", "no"].includes(reject.toLowerCase())) {
    throw new Error("IMAP-certifikatverifiering kan inte stängas av.");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("Ogiltig IMAP-port.");
  }
  const tls = resolveImapTls({
    host: input.host,
    port: input.port,
    secure: input.secure,
    environment: input.environment,
    env: {},
  });
  if (!tls.secure && !tls.doSTARTTLS) {
    throw new Error("Brevlådan måste använda IMAPS eller STARTTLS.");
  }
  return tls.secure;
}
