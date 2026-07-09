import { getUncachableStripeClient } from "./stripeClient";
import { fulfilOrder, ensureFulfilmentTable } from "./fulfilment/prodigi";
import { sendOrderConfirmation, sendAdminNotification } from "./email/mailer";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import Stripe from "stripe";

// ── Photo store ───────────────────────────────────────────────────────────────

async function ensurePhotoStore(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pending_photos (
      token       TEXT PRIMARY KEY,
      photo_b64   TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    DELETE FROM pending_photos WHERE created_at < NOW() - INTERVAL '2 hours'
  `);
}

export async function storePhoto(
  token: string,
  photoBase64: string,
): Promise<void> {
  await ensurePhotoStore();
  await db.execute(sql`
    INSERT INTO pending_photos (token, photo_b64)
    VALUES (${token}, ${photoBase64})
    ON CONFLICT (token) DO UPDATE SET photo_b64 = EXCLUDED.photo_b64, created_at = NOW()
  `);
}

async function retrieveAndDeletePhoto(token: string): Promise<string | null> {
  await ensurePhotoStore();
  const rows = await db.execute(sql`
    DELETE FROM pending_photos WHERE token = ${token} RETURNING photo_b64
  `);
  return (rows.rows[0]?.photo_b64 as string) ?? null;
}

// ── Checkout completed → fulfilment ───────────────────────────────────────────

async function handleCheckoutCompleted(sessionId: string): Promise<void> {
  const stripe = await getUncachableStripeClient();

  const session = (await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items", "line_items.data.price.product"],
  })) as unknown as Record<string, unknown>;

  const details = session["customer_details"] as Record<string, unknown> | undefined;
  const email =
    (details?.["email"] as string | undefined) ??
    (session["customer_email"] as string | undefined) ??
    "";

  const collectedInfo = session["collected_information"] as Record<string, unknown> | undefined;
  const shippingDetails = (session["shipping_details"] ??
    collectedInfo?.["shipping_details"]) as Record<string, unknown> | undefined;

  const addr = shippingDetails?.["address"] as Record<string, unknown> | undefined;

  if (!addr) {
    logger.warn({ sessionId }, "Checkout session has no shipping address — skipping fulfilment");
    return;
  }

  const meta = session["metadata"] as Record<string, string> | undefined;
  const photoToken = meta?.["photo_token"] ?? null;

  let photoBase64 = "";
  if (photoToken) {
    photoBase64 = (await retrieveAndDeletePhoto(photoToken)) ?? "";
  }

  let sku = meta?.["sku"] ?? "";
  if (!sku) {
    const lineItems = session["line_items"] as { data?: unknown[] } | undefined;
    const lineItem = lineItems?.data?.[0] as Record<string, unknown> | undefined;
    const price = lineItem?.["price"] as Record<string, unknown> | undefined;
    const product = price?.["product"] as Record<string, unknown> | undefined;
    const productMeta = product?.["metadata"] as Record<string, string> | undefined;
    sku = productMeta?.["sku"] ?? "";
  }

  if (!sku) {
    logger.warn({ sessionId }, "Could not determine SKU — skipping fulfilment");
    return;
  }

  await ensureFulfilmentTable();

  const paymentIntent = session["payment_intent"];
  const amountPaid = (session["amount_total"] as number | undefined) ?? 0;
  const currency = (session["currency"] as string | undefined) ?? "gbp";
  const bonusCard = amountPaid >= 5000;

  const customerName =
    (shippingDetails?.["name"] as string | undefined) ??
    (details?.["name"] as string | undefined) ??
    "Customer";

  const shippingAddress = {
    name: customerName,
    line1: (addr["line1"] as string | undefined) ?? "",
    line2: addr["line2"] as string | undefined,
    city: (addr["city"] as string | undefined) ?? "",
    postal_code: (addr["postal_code"] as string | undefined) ?? "",
    country: (addr["country"] as string | undefined) ?? "GB",
  };

  let productName = sku;
  try {
    const lineItems2 = session["line_items"] as { data?: unknown[] } | undefined;
    const li = lineItems2?.data?.[0] as Record<string, unknown> | undefined;
    const desc = li?.["description"] as string | undefined;
    if (desc) productName = desc;
  } catch {}

  await fulfilOrder({
    stripeSessionId: sessionId,
    stripePaymentIntentId: typeof paymentIntent === "string" ? paymentIntent : null,
    sku,
    customerEmail: email,
    shippingAddress,
    photoBase64,
    amountPaid,
    currency,
  });

  const bolOrderId = await getBolOrderId(sessionId);
  const fulfilmentStatus = bolOrderId ? "auto" : "queued";

  await Promise.allSettled([
    sendOrderConfirmation({
      customerName,
      customerEmail: email,
      productName,
      amountPaid,
      currency,
      shippingAddress,
      stripeSessionId: sessionId,
      bonusCard,
    }),
    sendAdminNotification({
      customerName,
      customerEmail: email,
      productName,
      amountPaid,
      currency,
      sku,
      shippingAddress,
      stripeSessionId: sessionId,
      bolOrderId,
      fulfilmentStatus,
      bonusCard,
    }),
  ]);
}

async function getBolOrderId(stripeSessionId: string): Promise<string | null> {
  try {
    const rows = await db.execute(sql`
      SELECT bol_order_id FROM fulfilment_queue
      WHERE stripe_session = ${stripeSessionId} AND bol_order_id IS NOT NULL
      LIMIT 1
    `);
    return (rows.rows[0]?.bol_order_id as string) ?? null;
  } catch {
    return null;
  }
}

// ── Stripe webhook processor (FINAL, FIXED VERSION) ───────────────────────────

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error("Payload must be a Buffer");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      throw new Error("Invalid Stripe signature: " + (err as Error).message);
    }

    logger.info(
      { type: event.type, objectId: event.data?.object?.id },
      `Received webhook ${event.type}`,
    );

    if (event.type === "checkout.session.completed") {
      const sessionId = event.data.object.id;
      try {
        await handleCheckoutCompleted(sessionId);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), sessionId },
          "Fulfilment error after checkout.session.completed",
        );
      }
    }
  }
}
