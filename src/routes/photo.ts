import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// Serves a customer photo publicly by id so a print provider (Prodigi)
// can download it. The image is stored in the prodigi_photos table by
// objectStorage.uploadBufferAndGetSignedUrl().
router.get("/photo/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const rows = await db.execute(sql`
      SELECT photo_b64, content_type FROM prodigi_photos WHERE id = ${id} LIMIT 1
    `);
    const row = rows.rows[0] as
      | { photo_b64?: string; content_type?: string }
      | undefined;
    if (!row?.photo_b64) {
      res.status(404).send("Not found");
      return;
    }
    const buffer = Buffer.from(row.photo_b64, "base64");
    res.setHeader("Content-Type", row.content_type || "image/jpeg");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).end(buffer);
  } catch (err) {
    res.status(500).send("Error retrieving photo");
  }
});

export default router;
