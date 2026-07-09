import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import {
  getUncachableStripeClient,
  getPublishableKey,
} from "../stripeClient";
import { applyEnhancements } from "./process";
import type { EnhancementMode } from "./process";
import { storePhoto } from "../webhookHandlers";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { SHOP_SKU_PRICES } from "../shopPrices";

const router = Router();

// ── Config (publishable key for frontend Stripe.js) ──────────────────────────

router.get("/stripe/config", async (_req: Request, res: Response) => {
  try {
    const publishableKey = await getPublishableKey();
    res.json({ publishableKey });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Create payment intent for photo restoration (£1.99) ───────────────────────

router.post("/stripe/create-intent", async (req: Request, res: Response) => {
  try {
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.create({
      amount: 149,
      currency: "gbp",
      description: "ONJJEM Photo Restoration — HD result",
      metadata: { product: "photo_restoration" },
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Verify payment + process HD photo ─────────────────────────────────────────

router.post("/stripe/verify-process", async (req: Request, res: Response) => {
  const body = req.body as {
    paymentIntentId?: string;
    imageBase64?: string;
    modes?: EnhancementMode[];
  };

  const { paymentIntentId, imageBase64, modes } = body;

  if (!paymentIntentId || !imageBase64 || !modes?.length) {
    res
      .status(400)
      .json({ error: "paymentIntentId, imageBase64, and modes are required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== "succeeded") {
      res
        .status(402)
        .json({ error: "Payment not completed", status: intent.status });
      return;
    }

    const inputBuffer = Buffer.from(imageBase64, "base64");
    const outputBuffer = await applyEnhancements(inputBuffer, modes);
    const resultBase64 = outputBuffer.toString("base64");

    res.json({ resultBase64 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ msg }, "stripe/verify-process error");
    res.status(500).json({ error: msg });
  }
});

// ── Create Stripe checkout for physical products ───────────────────────────────
// Accepts `sku` only. Price is always looked up from the server-side catalog
// (SHOP_SKU_PRICES) — client-supplied amounts are intentionally ignored to
// prevent price-tampering attacks.

router.post("/stripe/checkout", async (req: Request, res: Response) => {
  const body = req.body as {
    sku?: string;
    photoBase64?: string;
    successUrl?: string;
    cancelUrl?: string;
  };

  if (!body.sku) {
    res.status(400).json({ error: "sku is required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();

    // ── Resolve price from server-side catalog (trusted) ────────────────────
    // Fall back to a Stripe product/price lookup only when the SKU is not yet
    // in the local catalog (e.g. a newly-added product not yet deployed).
    let lineItem: {
      price?: string;
      price_data?: {
        currency: string;
        unit_amount: number;
        product_data: { name: string; metadata: { sku: string } };
      };
      quantity: number;
    };

    const catalogEntry = SHOP_SKU_PRICES[body.sku];

    if (catalogEntry) {
      lineItem = {
        price_data: {
          currency: "gbp",
          unit_amount: catalogEntry.pricePence,
          product_data: {
            name: catalogEntry.name,
            metadata: { sku: body.sku },
          },
        },
        quantity: 1,
      };
    } else {
      // SKU not in local catalog — try the Stripe product index as a fallback.
      // Try the search index first (fast). Newly-created products may not be
      // indexed yet, so fall back to a full paginated list scan if needed.
      let product:
        | Awaited<ReturnType<typeof stripe.products.list>>["data"][number]
        | undefined;

      const searchResults = await stripe.products.search({
        query: `active:"true" AND metadata["sku"]:"${body.sku}"`,
        limit: 1,
      });
      product = searchResults.data[0];

      if (!product) {
        for await (const p of stripe.products.list({ active: true, limit: 100 })) {
          if (p.metadata?.sku === body.sku) {
            product = p;
            break;
          }
        }
      }

      if (!product) {
        res.status(404).json({ error: "Product not found. Please contact orders@onjjem.co.uk." });
        return;
      }

      const priceList = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 1,
      });

      const price = priceList.data[0];

      if (!price) {
        res.status(404).json({ error: "No active price for this product. Please contact orders@onjjem.co.uk." });
        return;
      }

      lineItem = { price: price.id, quantity: 1 };
    }

    // Store the customer's photo so the webhook can retrieve it after payment
    let photoToken: string | null = null;
    if (body.photoBase64) {
      photoToken = crypto.randomUUID();
      await storePhoto(photoToken, body.photoBase64);
    }

    const origin = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [lineItem],
      mode: "payment",
      allow_promotion_codes: true,
      shipping_address_collection: {
        allowed_countries: ["GB", "US", "CA", "AU", "DE", "FR", "IE", "NL", "SE", "NO", "DK"],
      },
      success_url: body.successUrl || `${origin}/?order=success`,
      cancel_url: body.cancelUrl || `${origin}/#shop`,
      metadata: {
        sku: body.sku,
        ...(photoToken ? { photo_token: photoToken } : {}),
      },
      custom_text: {
        submit: {
          message: "Your restored photo will be printed and dispatched within 3–5 working days.",
        },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ msg }, "stripe/checkout error");
    res.status(500).json({ error: msg });
  }
});

// ── Create Stripe checkout for web subscriptions (monthly / annual) ───────────

router.post("/stripe/subscribe", async (req: Request, res: Response) => {
  const body = req.body as { plan?: "monthly" | "annual" };

  if (!body.plan || !["monthly", "annual"].includes(body.plan)) {
    res.status(400).json({ error: "plan must be 'monthly' or 'annual'" });
    return;
  }

  const interval = body.plan === "monthly" ? "month" : "year";

  try {
    const stripe = await getUncachableStripeClient();

    // Look up the subscription price directly via the Stripe API.
    // This avoids any dependency on the stripe-sync database schema.
    const priceList = await stripe.prices.list({
      active: true,
      type: "recurring",
      limit: 100,
    });

    const price = priceList.data.find(
      (p) => p.recurring?.interval === interval,
    );

    if (!price) {
      res.status(404).json({ error: `No active ${body.plan} subscription price found.` });
      return;
    }

    const priceId = price.id;
    const origin = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/?subscribed=success`,
      cancel_url: `${origin}/#pricing`,
      custom_text: {
        submit: {
          message: "Your subscription starts immediately. Cancel anytime from your account.",
        },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ msg }, "stripe/subscribe error");
    res.status(500).json({ error: msg });
  }
});

// ── List active products with prices ─────────────────────────────────────────

router.get("/stripe/products", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.description AS product_description,
        p.metadata AS product_metadata,
        pr.id AS price_id,
        pr.unit_amount,
        pr.currency,
        pr.recurring,
        pr.metadata AS price_metadata
      FROM stripe.products p
      LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
      WHERE p.active = true
      ORDER BY p.name, pr.unit_amount
    `);

    const map = new Map<string, {
      id: string;
      name: string;
      description: string | null;
      metadata: Record<string, string>;
      prices: { id: string; unit_amount: number; currency: string; recurring: unknown }[];
    }>();

    for (const row of rows.rows) {
      const pid = row.product_id as string;
      if (!map.has(pid)) {
        map.set(pid, {
          id: pid,
          name: row.product_name as string,
          description: row.product_description as string | null,
          metadata: (row.product_metadata as Record<string, string>) ?? {},
          prices: [],
        });
      }
      if (row.price_id) {
        map.get(pid)!.prices.push({
          id: row.price_id as string,
          unit_amount: row.unit_amount as number,
          currency: row.currency as string,
          recurring: row.recurring,
        });
      }
    }

    res.json({ data: Array.from(map.values()) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

export default router;
