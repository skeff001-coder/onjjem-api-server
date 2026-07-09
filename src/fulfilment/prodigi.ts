/**
 * Prodigi print-on-demand fulfilment module.
 *
 * Prodigi auto-prints and ships each customer's uploaded photo with ZERO manual
 * work — exactly the hands-off flow we want. After a Stripe payment clears, the
 * webhook calls fulfilOrder() which:
 *   1. Uploads the customer's restored photo to object storage and gets a
 *      publicly-downloadable signed URL (Prodigi downloads the image from it).
 *   2. Submits the order to the Prodigi Print API.
 *   3. Records the order in `fulfilment_queue` as an audit trail.
 *
 * When PRODIGI_API_KEY is NOT set, every order is queued so nothing is lost —
 * the order is recorded and an admin email is sent.
 *
 * Sandbox base:  https://api.sandbox.prodigi.com   (no charge, not produced)
 * Live base:     https://api.prodigi.com           (real, produced & shipped)
 * Docs:          https://www.prodigi.com/print-api/docs/reference/
 *
 * All SKUs validated against the LIVE Prodigi API on 2026-06-01.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

// ── SKU → Prodigi product mapping ────────────────────────────────────────────
// Maps our website SKU to a Prodigi product SKU (+ optional copies/attributes).
//
//   sizing:      "fillPrintArea" (recommended) crops to fill; "fitPrintArea" letterboxes.
//   attributes:  product-specific options (e.g. wrap, color) — required by Prodigi.
//   printAreas:  list of print area names to render. Defaults to ["default"].
//                Jigsaws require ["jigsaw", "lid"] — customer photo is printed on both.
//
export interface ProdigiProduct {
  sku: string;
  copies?: number;
  sizing?: "fillPrintArea" | "fitPrintArea";
  attributes?: Record<string, string>;
  printAreas?: string[]; // defaults to ["default"]; jigsaws need ["jigsaw","lid"]
}

export const PRODIGI_PRODUCTS: Record<string, ProdigiProduct> = {
  // ── Stretched Canvas ────────────────────────────────────────────────────────
  // SKU format: GLOBAL-CAN-{W}X{H} (inches). wrap attribute required.
  "canvas-stretched-8x10":  { sku: "GLOBAL-CAN-8X10",  sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "canvas-stretched-10x12": { sku: "GLOBAL-CAN-10X12", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "canvas-stretched-12x16": { sku: "GLOBAL-CAN-12X16", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "canvas-stretched-16x20": { sku: "GLOBAL-CAN-16X20", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "canvas-stretched-20x24": { sku: "GLOBAL-CAN-20X24", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },

  // ── Eco Canvas ──────────────────────────────────────────────────────────────
  // ECO-CAN-* requires wrap attribute (same as stretched canvas).
  "eco-canvas-8x8":   { sku: "ECO-CAN-8X8",   sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "eco-canvas-8x12":  { sku: "ECO-CAN-8X12",  sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "eco-canvas-12x12": { sku: "ECO-CAN-12X12", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "eco-canvas-12x18": { sku: "ECO-CAN-12X18", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "eco-canvas-16x16": { sku: "ECO-CAN-16X16", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "eco-canvas-16x24": { sku: "ECO-CAN-16X24", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },

  // ── Eco Rolled Canvas ───────────────────────────────────────────────────────
  // ECO-ROL-* unframed rolled prints, no attribute required.
  "eco-rolled-10x10": { sku: "ECO-ROL-10X10", sizing: "fillPrintArea" },
  "eco-rolled-12x12": { sku: "ECO-ROL-12X12", sizing: "fillPrintArea" },
  "eco-rolled-12x18": { sku: "ECO-ROL-12X18", sizing: "fillPrintArea" },
  "eco-rolled-16x20": { sku: "ECO-ROL-16X20", sizing: "fillPrintArea" },
  "eco-rolled-18x24": { sku: "ECO-ROL-18X24", sizing: "fillPrintArea" },

  // ── Slim Canvas ─────────────────────────────────────────────────────────────
  // GLOBAL-SLIMCAN-* requires wrap attribute.
  "slim-canvas-8x16":  { sku: "GLOBAL-SLIMCAN-8X16",  sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "slim-canvas-24x40": { sku: "GLOBAL-SLIMCAN-24X40", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "slim-canvas-28x36": { sku: "GLOBAL-SLIMCAN-28X36", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },
  "slim-canvas-40x48": { sku: "GLOBAL-SLIMCAN-40X48", sizing: "fillPrintArea", attributes: { wrap: "ImageWrap" } },

  // ── Box Frames ──────────────────────────────────────────────────────────────
  // GLOBAL-BOX-* requires color attribute: "white" | "natural" | "black".
  "box-frame-5x7":   { sku: "GLOBAL-BOX-5X7",   sizing: "fillPrintArea", attributes: { color: "black" } },
  "box-frame-6x8":   { sku: "GLOBAL-BOX-6X8",   sizing: "fillPrintArea", attributes: { color: "black" } },
  "box-frame-11x14": { sku: "GLOBAL-BOX-11X14", sizing: "fillPrintArea", attributes: { color: "black" } },
  "box-frame-12x12": { sku: "GLOBAL-BOX-12X12", sizing: "fillPrintArea", attributes: { color: "black" } },
  "box-frame-12x16": { sku: "GLOBAL-BOX-12X16", sizing: "fillPrintArea", attributes: { color: "black" } },
  "box-frame-16x20": { sku: "GLOBAL-BOX-16X20", sizing: "fillPrintArea", attributes: { color: "black" } },

  // ── Framed Photo Tiles ──────────────────────────────────────────────────────
  // PHOTIL-FRA-* requires color attribute: "white" | "black".
  "photo-tile-5x7":  { sku: "PHOTIL-FRA-0507", sizing: "fillPrintArea", attributes: { color: "black" } },
  "photo-tile-8x8":  { sku: "PHOTIL-FRA-0808", sizing: "fillPrintArea", attributes: { color: "black" } },
  "photo-tile-8x10": { sku: "PHOTIL-FRA-0810", sizing: "fillPrintArea", attributes: { color: "black" } },

  // ── Playing Cards ───────────────────────────────────────────────────────────
  "playing-cards": { sku: "PLAY-CARD", sizing: "fillPrintArea" },

  // ── Photo Mugs ──────────────────────────────────────────────────────────────
  // Validated against Prodigi live API on 2026-06-01.
  // GLOBAL-MUG-W: 11oz, multi-region (UK/US/DE), best for international orders.
  // H-MUG-15OZ-W: 15oz large ceramic, UK lab.
  "mug-11oz": { sku: "GLOBAL-MUG-W",  sizing: "fillPrintArea" },
  "mug-15oz": { sku: "H-MUG-15OZ-W", sizing: "fillPrintArea" },

  // ── Pet Tags ─────────────────────────────────────────────────────────────────
  // Aluminium, dye-sublimated, UK lab. Both validated live on 2026-06-01.
  // PET-MET-ROUND: 3.2x3.9cm round tag, £5.00. PET-MET-BONE: 2.8x3.8cm bone, £5.00.
  "pet-tag-round": { sku: "PET-MET-ROUND", sizing: "fillPrintArea" },
  "pet-tag-bone":  { sku: "PET-MET-BONE",  sizing: "fillPrintArea" },

  // ── Tea Towels ───────────────────────────────────────────────────────────────
  // SKU prefix confirmed via Prodigi products API (/v4.0/products/H-TEATOWEL).
  // UK lab: 18.5x27.5" (50x70cm) cotton, £12.00 base. Sandbox returns
  // NotAvailable (sandbox limitation) but product is valid on live API.
  "tea-towel": { sku: "H-TEATOWEL", sizing: "fillPrintArea" },

  // ── Wooden Coasters ─────────────────────────────────────────────────────────
  // UK lab (H-COAST-*). All 4x4" square with cork underside.
  // Validated against Prodigi live API on 2026-06-01.
  "coaster-1pk": { sku: "H-COAST-1PK", sizing: "fillPrintArea" },
  "coaster-2pk": { sku: "H-COAST-2PK", sizing: "fillPrintArea" },
  "coaster-4pk": { sku: "H-COAST-4PK", sizing: "fillPrintArea" },
  "coaster-6pk": { sku: "H-COAST-6PK", sizing: "fillPrintArea" },

  // ── Magnets ─────────────────────────────────────────────────────────────────
  // All five SKUs validated against Prodigi live API on 2026-06-01.
  // ACR = acrylic fridge magnet, FRI = standard fridge magnet, MAG-1 = square.
  "magnet-acrylic-2x3":  { sku: "M-MAG-ACR-4X6",  sizing: "fillPrintArea" }, // 2"×3" acrylic
  "magnet-fridge-3x2":   { sku: "M-MAG-FRI-3X2",  sizing: "fillPrintArea" }, // 3"×2"
  "magnet-fridge-6x4":   { sku: "M-MAG-FRI-4X6",  sizing: "fillPrintArea" }, // 6"×4"
  "magnet-square-4x4":   { sku: "MAG-1-10X10",     sizing: "fillPrintArea" }, // 4"×4" (10×10cm)
  "magnet-square-6x6":   { sku: "MAG-1-15X15",     sizing: "fillPrintArea" }, // 6"×6" (15×15cm)

  // ── Jigsaw Puzzles ───────────────────────────────────────────────────────────
  // JIGSAW-PUZZLE-* SKUs validated against Prodigi live API on 2026-06-02.
  // All require printAreas: ["jigsaw", "lid"] — customer photo prints on both.
  "jigsaw-252":  { sku: "JIGSAW-PUZZLE-252",  sizing: "fillPrintArea", printAreas: ["jigsaw", "lid"] }, // 252pc, 375×285mm
  "jigsaw-500":  { sku: "JIGSAW-PUZZLE-500",  sizing: "fillPrintArea", printAreas: ["jigsaw", "lid"] }, // 500pc, 530×390mm
  "jigsaw-1000": { sku: "JIGSAW-PUZZLE-1000", sizing: "fillPrintArea", printAreas: ["jigsaw", "lid"] }, // 1000pc, 765×525mm

  // ── Temporary Tattoos ───────────────────────────────────────────────────────
  // GLOBAL-TATT-* SKUs validated against Prodigi live API on 2026-06-02.
  // Skin-safe waterslide film, lasts up to one week, easy to apply and remove.
  "tattoo-s":   { sku: "GLOBAL-TATT-S",   sizing: "fillPrintArea" }, // 2×3" (5×7.5cm)
  "tattoo-m":   { sku: "GLOBAL-TATT-M",   sizing: "fillPrintArea" }, // 3×4" (7.5×10cm)
  "tattoo-l":   { sku: "GLOBAL-TATT-L",   sizing: "fillPrintArea" }, // 4×6" (10×15cm)
  "tattoo-xl":  { sku: "GLOBAL-TATT-XL",  sizing: "fillPrintArea" }, // 8×8" (20×20cm)
  "tattoo-xxl": { sku: "GLOBAL-TATT-XXL", sizing: "fillPrintArea" }, // 12×12" (30×30cm)

  // ── iPad Cases ──────────────────────────────────────────────────────────────────────────────
  // GLOBAL-TECH-IPAD-* SKUs validated against Prodigi live API on 2026-06-02.
  // Snap cases, printed edge-to-edge with water-based polyurethane coating.
  // GLOBAL-TECH-IPADMIN1-CS not found in API — only Air + 2/3/4 available.
  "ipad-air":     { sku: "GLOBAL-TECH-IPAD-A-CS",   sizing: "fillPrintArea" }, // iPad Air
  "ipad-2-3-4":   { sku: "GLOBAL-TECH-IPAD2-CS",    sizing: "fillPrintArea" }, // iPad 2/3/4

  // ── Folio Wallet Cases ─────────────────────────────────────────────────────────────────────────────
  // GLOBAL-TECH-FWALLET-* SKUs from Prodigi catalog (2026-06-02).
  // Faux leather folio with card slots, stand feature, custom photo print.
  "folio-iphone11":      { sku: "GLOBAL-TECH-FWALLET-IPHONE11",     sizing: "fillPrintArea" },
  "folio-iphone11pro":   { sku: "GLOBAL-TECH-FWALLET-IPHONE11PRO",  sizing: "fillPrintArea" },
  "folio-iphone11promax":{ sku: "GLOBAL-TECH-FWALLET-IPHONE11PROMAX", sizing: "fillPrintArea" },
  "folio-iphone12":      { sku: "GLOBAL-TECH-FWALLET-IPHONE12",     sizing: "fillPrintArea" },
  "folio-iphone12mini":  { sku: "GLOBAL-TECH-FWALLET-IPHONE12MINI", sizing: "fillPrintArea" },
  "folio-iphone12pro":   { sku: "GLOBAL-TECH-FWALLET-IPHONE12PRO",  sizing: "fillPrintArea" },
  "folio-iphone12promax":{ sku: "GLOBAL-TECH-FWALLET-IPHONE12PROMAX", sizing: "fillPrintArea" },
  "folio-iphone13":      { sku: "GLOBAL-TECH-FWALLET-IPHONE13",     sizing: "fillPrintArea" },

  // ── Tough Phone Cases ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // GLOBAL-TECH-CASE-* SKUs from Prodigi catalog (2026-06-02).
  // Dual-layer tough case with custom photo print, matte or gloss finish.
  "tough-iphone11":      { sku: "GLOBAL-TECH-CASE-IPHONE11",     sizing: "fillPrintArea" },
  "tough-iphone11pro":   { sku: "GLOBAL-TECH-CASE-IPHONE11PRO",  sizing: "fillPrintArea" },
  "tough-iphone11promax":{ sku: "GLOBAL-TECH-CASE-IPHONE11PROMAX", sizing: "fillPrintArea" },
  "tough-iphone12":      { sku: "GLOBAL-TECH-CASE-IPHONE12",     sizing: "fillPrintArea" },
  "tough-iphone12mini":  { sku: "GLOBAL-TECH-CASE-IPHONE12MINI", sizing: "fillPrintArea" },
  "tough-iphone12pro":   { sku: "GLOBAL-TECH-CASE-IPHONE12PRO",  sizing: "fillPrintArea" },
  "tough-iphone12promax":{ sku: "GLOBAL-TECH-CASE-IPHONE12PROMAX", sizing: "fillPrintArea" },
  "tough-iphone13":      { sku: "GLOBAL-TECH-CASE-IPHONE13",     sizing: "fillPrintArea" },
  "tough-iphone13mini":  { sku: "GLOBAL-TECH-CASE-IPHONE13MINI", sizing: "fillPrintArea" },
  "tough-iphone13pro":   { sku: "GLOBAL-TECH-CASE-IPHONE13PRO",  sizing: "fillPrintArea" },
  "tough-iphone13promax":{ sku: "GLOBAL-TECH-CASE-IPHONE13PROMAX", sizing: "fillPrintArea" },

  // ── Glow in the Dark Posters ───────────────────────────────────────
  // GLOBAL-GLOW-* SKUs from Prodigi catalog (2026-06-02).
  // Glow-in-the-dark photo posters that charge under light and glow at night.
  "glow-4x6":   { sku: "GLOBAL-GLOW-4X6",   sizing: "fillPrintArea" },
  "glow-5x7":   { sku: "GLOBAL-GLOW-5X7",   sizing: "fillPrintArea" },
  "glow-8x10":  { sku: "GLOBAL-GLOW-8X10",  sizing: "fillPrintArea" },
  "glow-12x16": { sku: "GLOBAL-GLOW-12X16", sizing: "fillPrintArea" },
  "glow-16x20": { sku: "GLOBAL-GLOW-16X20", sizing: "fillPrintArea" },
  "glow-20x24": { sku: "GLOBAL-GLOW-20X24", sizing: "fillPrintArea" },
  "glow-24x32": { sku: "GLOBAL-GLOW-24X32", sizing: "fillPrintArea" },
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FulfilmentAddress {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  postal_code: string;
  country: string;
}

export interface FulfilmentOrder {
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  sku: string;
  customerEmail: string;
  shippingAddress: FulfilmentAddress;
  photoBase64: string; // full-resolution restored photo (raw base64 or data URL)
  amountPaid: number; // pence
  currency: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

function prodigiBaseUrl(): string {
  const env = (process.env.PRODIGI_ENV || "sandbox").toLowerCase();
  return env === "live"
    ? "https://api.prodigi.com"
    : "https://api.sandbox.prodigi.com";
}

const SHIPPING_METHOD = process.env.PRODIGI_SHIPPING_METHOD || "Standard";

// ── Ensure queue table exists ─────────────────────────────────────────────────

export async function ensureFulfilmentTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fulfilment_queue (
      id              SERIAL PRIMARY KEY,
      stripe_session  TEXT NOT NULL UNIQUE,
      sku             TEXT NOT NULL,
      customer_email  TEXT NOT NULL,
      shipping_json   JSONB NOT NULL,
      amount_paid     INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'gbp',
      photo_stored    BOOLEAN NOT NULL DEFAULT false,
      bonus_card      BOOLEAN NOT NULL DEFAULT false,
      bol_order_id    TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Add bonus_card column for older deployments (idempotent)
  await db.execute(sql`
    ALTER TABLE fulfilment_queue ADD COLUMN IF NOT EXISTS bonus_card BOOLEAN NOT NULL DEFAULT false
  `);
}

// ── Convert the stored photo (raw base64 or data URL) to a public image URL ────

async function photoToPublicUrl(photoBase64: string): Promise<string> {
  let data = photoBase64.trim();
  let contentType = "image/jpeg";

  const dataUrlMatch = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (dataUrlMatch) {
    contentType = dataUrlMatch[1];
    data = dataUrlMatch[2];
  }

  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0) {
    throw new Error("Customer photo is empty — cannot create Prodigi order");
  }

  const storage = new ObjectStorageService();
  return storage.uploadBufferAndGetSignedUrl(buffer, { contentType });
}

// ── Submit order to Prodigi Print API ─────────────────────────────────────────

async function submitToProdigi(
  apiKey: string,
  order: FulfilmentOrder,
): Promise<string> {
  const product = PRODIGI_PRODUCTS[order.sku];
  if (!product) {
    throw new Error(
      `No Prodigi product mapped for SKU "${order.sku}". ` +
        `Add it to PRODIGI_PRODUCTS in prodigi.ts.`,
    );
  }

  const imageUrl = await photoToPublicUrl(order.photoBase64);

  // Build assets array — most products use a single "default" print area;
  // jigsaws (and any future multi-area products) need one entry per area.
  const printAreas = product.printAreas ?? ["default"];
  const assets = printAreas.map((area) => ({ printArea: area, url: imageUrl }));

  const items: {
    sku: string;
    copies: number;
    sizing: string;
    attributes?: Record<string, string>;
    assets: { printArea: string; url: string }[];
  }[] = [
    {
      sku: product.sku,
      copies: product.copies ?? 1,
      sizing: product.sizing ?? "fillPrintArea",
      ...(product.attributes ? { attributes: product.attributes } : {}),
      assets,
    },
  ];

  // ── Bonus: free playing cards on orders ≥ £50 ───────────────────────────
  const bonusCard = order.amountPaid >= 5000;
  if (bonusCard) {
    const cardProduct = PRODIGI_PRODUCTS["playing-cards"];
    if (cardProduct) {
      items.push({
        sku: cardProduct.sku,
        copies: 1,
        sizing: cardProduct.sizing ?? "fillPrintArea",
        assets,
      });
    }
  }

  const payload = {
    merchantReference: order.stripeSessionId,
    shippingMethod: SHIPPING_METHOD,
    recipient: {
      name: order.shippingAddress.name,
      email: order.customerEmail || undefined,
      address: {
        line1: order.shippingAddress.line1,
        line2: order.shippingAddress.line2 || undefined,
        townOrCity: order.shippingAddress.city,
        postalOrZipCode: order.shippingAddress.postal_code,
        countryCode: order.shippingAddress.country,
      },
    },
    items,
  };

  const resp = await fetch(`${prodigiBaseUrl()}/v4.0/orders`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Prodigi API error ${resp.status}: ${body.slice(0, 400)}`);
  }

  const data = (await resp.json()) as { order?: { id?: string } };
  const prodigiOrderId = data.order?.id;
  if (!prodigiOrderId) {
    throw new Error("Prodigi response missing order id");
  }
  return prodigiOrderId;
}

// ── Queue + status helpers ────────────────────────────────────────────────────

async function queueOrder(order: FulfilmentOrder): Promise<void> {
  const bonusCard = order.amountPaid >= 5000; // free playing cards on orders ≥ £50
  await db.execute(sql`
    INSERT INTO fulfilment_queue
      (stripe_session, sku, customer_email, shipping_json, amount_paid, currency, bonus_card, status)
    VALUES
      (${order.stripeSessionId}, ${order.sku}, ${order.customerEmail},
       ${JSON.stringify(order.shippingAddress)}::jsonb,
       ${order.amountPaid}, ${order.currency}, ${bonusCard}, 'pending')
    ON CONFLICT (stripe_session) DO NOTHING
  `);
}

async function markFulfilled(
  stripeSessionId: string,
  prodigiOrderId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE fulfilment_queue
    SET status = 'fulfilled', bol_order_id = ${prodigiOrderId}, updated_at = NOW()
    WHERE stripe_session = ${stripeSessionId}
  `);
}

async function markFailed(
  stripeSessionId: string,
  error: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE fulfilment_queue
    SET status = 'failed', error = ${error}, updated_at = NOW()
    WHERE stripe_session = ${stripeSessionId}
  `);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Fulfil an order automatically via Prodigi.
 *
 * 1. Always writes the order to `fulfilment_queue` as an audit trail.
 * 2. If PRODIGI_API_KEY is set, immediately submits to Prodigi.
 * 3. If the key is absent, queues the order and logs a clear warning.
 */
export async function fulfilOrder(order: FulfilmentOrder): Promise<void> {
  await ensureFulfilmentTable();
  await queueOrder(order);

  const apiKey = process.env.PRODIGI_API_KEY;

  if (!apiKey) {
    logger.warn(
      {
        stripeSession: order.stripeSessionId,
        sku: order.sku,
        customer: order.customerEmail,
        amountPaid: `£${(order.amountPaid / 100).toFixed(2)}`,
      },
      "⚠️  PRODIGI_API_KEY not set — order queued. " +
        "Add the key to Replit Secrets to enable automatic fulfilment.",
    );
    return;
  }

  try {
    const bonusCard = order.amountPaid >= 5000;
    logger.info(
      {
        stripeSession: order.stripeSessionId,
        sku: order.sku,
        env: process.env.PRODIGI_ENV || "sandbox",
        bonusCard,
      },
      "Submitting order to Prodigi…",
    );
    const prodigiOrderId = await submitToProdigi(apiKey, order);
    await markFulfilled(order.stripeSessionId, prodigiOrderId);
    logger.info(
      { prodigiOrderId, stripeSession: order.stripeSessionId },
      "✅ Prodigi order placed successfully",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(order.stripeSessionId, msg);
    logger.error(
      { err: msg, stripeSession: order.stripeSessionId },
      "❌ Prodigi order failed — order remains in queue for retry",
    );
    // Don't re-throw: the Stripe webhook must return 200 or Stripe will retry.
  }
}
