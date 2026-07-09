import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { makeFreePreview } from "./process";
import type { EnhancementMode } from "./process";

const router = Router();

async function ensureSubscribersTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_subscribers (
      email         TEXT PRIMARY KEY,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

router.post("/restoration/free", async (req: Request, res: Response) => {
  const body = req.body as {
    email?: string;
    imageBase64?: string;
    modes?: EnhancementMode[];
  };

  const email = (body.email ?? "").trim().toLowerCase();
  const { imageBase64, modes } = body;

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }

  if (!imageBase64 || !modes?.length) {
    res.status(400).json({ error: "imageBase64 and modes are required." });
    return;
  }

  try {
    await ensureSubscribersTable();

    // Claim the slot atomically BEFORE processing.
    // INSERT returns 0 rows if the email already exists — prevents any race
    // condition where multiple concurrent requests all pass a SELECT check.
    const claimed = await db.execute(sql`
      INSERT INTO email_subscribers (email) VALUES (${email})
      ON CONFLICT (email) DO NOTHING
    `);

    if ((claimed.rowCount ?? 0) === 0) {
      res.json({ alreadyUsed: true });
      return;
    }

    const validModes: EnhancementMode[] = ["sharpen", "brighten", "denoise", "restore", "vivid", "colorize"];
    const filtered = modes.filter((m) => validModes.includes(m)) as EnhancementMode[];
    if (!filtered.length) {
      // Release the claimed slot so they can try again with valid modes
      await db.execute(sql`DELETE FROM email_subscribers WHERE email = ${email}`);
      res.status(400).json({ error: "No valid modes provided." });
      return;
    }

    const inputBuffer = Buffer.from(imageBase64, "base64");
    const outputBuffer = await makeFreePreview(inputBuffer, filtered);
    const resultBase64 = outputBuffer.toString("base64");

    req.log.info({ email }, "Free restoration used");
    res.json({ alreadyUsed: false, resultBase64 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "restoration/free error");
    res.status(500).json({ error: msg });
  }
});

// Lightweight email check — returns {alreadyUsed} without processing any image
router.get("/restoration/check-email", async (req: Request, res: Response) => {
  const email = ((req.query.email as string) ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.json({ alreadyUsed: false });
    return;
  }
  try {
    await ensureSubscribersTable();
    const existing = await db.execute(
      sql`SELECT 1 FROM email_subscribers WHERE email = ${email} LIMIT 1`
    );
    res.json({ alreadyUsed: (existing.rowCount ?? 0) > 0 });
  } catch {
    res.json({ alreadyUsed: false }); // fail open — let them try
  }
});

export default router;
