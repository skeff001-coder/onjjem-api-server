import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

async function ensureContactTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      subject     TEXT NOT NULL,
      message     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

router.post("/contact", async (req: Request, res: Response) => {
  const { name, email, subject, message } = req.body as {
    name?: string;
    email?: string;
    subject?: string;
    message?: string;
  };

  if (!name || !email || !email.includes("@") || !subject || !message) {
    res.status(400).json({ error: "All fields are required and email must be valid." });
    return;
  }

  try {
    await ensureContactTable();

    await db.execute(sql`
      INSERT INTO contact_messages (name, email, subject, message)
      VALUES (${name.trim()}, ${email.trim().toLowerCase()}, ${subject.trim()}, ${message.trim()})
    `);

    logger.info({ email, subject }, "Contact message received");
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, email }, "Contact form submission failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
