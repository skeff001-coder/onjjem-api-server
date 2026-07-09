import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendWelcomeEmail } from "../email/mailer";
import { logger } from "../lib/logger";

const router = Router();

const DISCOUNT_CODE = "WELCOME10";

async function ensureSubscribersTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_subscribers (
      email       TEXT PRIMARY KEY,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

router.post("/email-signup", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }

  const normalised = email.trim().toLowerCase();

  try {
    await ensureSubscribersTable();

    const existing = await db.execute(sql`
      SELECT email FROM email_subscribers WHERE email = ${normalised}
    `);

    if (existing.rows.length > 0) {
      res.json({ ok: true, alreadySubscribed: true, code: DISCOUNT_CODE });
      return;
    }

    await db.execute(sql`
      INSERT INTO email_subscribers (email) VALUES (${normalised})
    `);

    await sendWelcomeEmail(normalised, DISCOUNT_CODE).catch((err: unknown) => {
      logger.warn({ err }, "Welcome email failed — subscriber still saved");
    });

    logger.info({ email: normalised }, "New email subscriber");
    res.json({ ok: true, alreadySubscribed: false, code: DISCOUNT_CODE });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, email: normalised }, "Email signup failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
