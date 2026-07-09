// Stripe integration via Replit Connectors
import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

interface StripeCredentials {
  secretKey: string;
  publishableKey: string;
}

async function getCredentials(): Promise<StripeCredentials> {
  // Primary: use env var secrets (works in both dev and production deployment)
  // STRIPE_PK is an alternative name for the publishable key to avoid
  // conflicts with connector-linked STRIPE_PUBLISHABLE_KEY secrets.
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_LIVE_PK ?? process.env.STRIPE_PK;

  if (secretKey && publishableKey && (publishableKey.startsWith("pk_") || publishableKey.startsWith("rk_"))) {
    return { secretKey, publishableKey };
  }

  // Fallback: Replit Connectors proxy (dev container only)
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Stripe keys not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in Secrets.",
    );
  }

  // Always request "development" credentials from the connectors proxy.
  // The Stripe integration is only connected under the development environment
  // in Replit Integrations, so requesting "production" returns nothing and
  // causes a 500 on the live site.
  const targetEnv = "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnv);

  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as { items?: { settings?: { secret?: string; publishable?: string } }[] };
  const settings = data.items?.[0]?.settings;

  if (!settings?.secret || !settings?.publishable) {
    throw new Error(
      "Stripe integration not connected or missing keys. " +
        "Connect Stripe via the Integrations tab first.",
    );
  }

  return {
    secretKey: settings.secret as string,
    publishableKey: settings.publishable as string,
  };
}

// WARNING: Never cache this client — always call fresh to pick up rotated keys.
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey);
}

export async function getPublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { secretKey } = await getCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl, max: 2 },
    stripeSecretKey: secretKey,
    ...(process.env.STRIPE_WEBHOOK_SECRET
      ? { stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET }
      : {}),
  });
}
