import { Router } from "express";
import type { Request, Response } from "express";
import sharp from "sharp";
import Replicate from "replicate";
import convert from "heic-convert";

const router = Router(); // Convert HEIC/HEIF photos to JPEG so sharp + Replicate can read them
async function toJpegBuffer(buf: Buffer): Promise<Buffer> {
  const header = buf.slice(4, 12).toString("ascii");
  const isHeic = /heic|heif|mif1|hevc/i.test(header);
  if (!isHeic) return buf;

  const out = await convert({
    buffer: buf as any,
    format: "JPEG",
    quality: 0.92,
  });
  return Buffer.from(out);
}

export type EnhancementMode =
  | "sharpen"
  | "brighten"
  | "denoise"
  | "restore"
  | "vivid"
  | "colorize";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const replicate = REPLICATE_TOKEN
  ? new Replicate({ auth: REPLICATE_TOKEN })
  : null;

// Replicate models for each AI mode
const AI_MODELS: Record<
  string,
  { model: `${string}/${string}`; input: Record<string, unknown> }
> = {
  sharpen: {
    model: "nightmareai/real-esrgan",
    input: { scale: 2 },
  },
  denoise: {
    model: "nightmareai/real-esrgan",
    input: { scale: 1 },
  },
  restore: {
    model: "nightmareai/real-esrgan",
    input: { scale: 2 },
  },
  colorize: {
    model: "piddnad/ddcolor",
    input: {},
  },
};

// ── Replicate AI helper ──────────────────────────────────────────────────────

async function runReplicateAI(
  buf: Buffer,
  mode: EnhancementMode,
): Promise<Buffer> {
  if (!replicate) {
    throw new Error("REPLICATE_API_TOKEN not configured");
  }

  const cfg = AI_MODELS[mode];
  if (!cfg) {
    throw new Error(`No AI model configured for mode: ${mode}`);
  }

  const dataUri = `data:image/jpeg;base64,${buf.toString("base64")}`;

  const output = await replicate.run(cfg.model, {
    input: { ...cfg.input, image: dataUri },
    wait: { mode: "poll", interval: 1000 },
  });

  // Output is usually an array of URL strings
  const resultUrl = Array.isArray(output) ? output[0] : output;
  if (typeof resultUrl !== "string") {
    throw new Error("Replicate returned unexpected output format");
  }

  const response = await fetch(resultUrl);
  if (!response.ok) {
    throw new Error(`Failed to download result: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// ── Sharp-only modes (brighten, vivid) ──────────────────────────────────────

async function applyBrighten(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .normalise({ lower: 0, upper: 100 })
    .modulate({ brightness: 1.4 })
    .modulate({ brightness: 0.85 })
    .toBuffer();
}

async function applyVivid(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .normalise({ lower: 0, upper: 100 })
    .modulate({ saturation: 2.2, brightness: 1.1 })
    .modulate({ brightness: 0.88 })
    .linear([1.12, 1.0, 0.9], [8, 0, -8])
    .toBuffer();
}

// ── AI fallback (if Replicate fails) ─────────────────────────────────────────

async function aiFallback(buf: Buffer, mode: EnhancementMode): Promise<Buffer> {
  switch (mode) {
    case "sharpen":
      return sharp(buf)
        .sharpen({ sigma: 2.0, m1: 2.5, m2: 3.5, x1: 2.0, y2: 10.0, y3: 20.0 })
        .toBuffer();
    case "denoise":
      return sharp(buf)
        .median(3)
        .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
        .toBuffer();
    case "restore":
      return sharp(buf)
        .normalise({ lower: 2, upper: 98 })
        .median(3)
        .sharpen({ sigma: 1.5, m1: 1.5, m2: 2.5 })
        .modulate({ brightness: 1.1, saturation: 1.2 })
        .toBuffer();
    case "colorize":
      // Best we can do with sharp is a warm tint
      return sharp(buf)
        .modulate({ brightness: 1.05, saturation: 1.3 })
        .linear([1.05, 1.0, 0.95], [2, 0, -2])
        .toBuffer();
    default:
      return buf;
  }
}

// ── Full HD processing (AI + sharp) ─────────────────────────────────────────

export async function applyEnhancements(
  inputBuffer: Buffer,
  modes: EnhancementMode[],
): Promise<Buffer> {
  const jpegBuffer = await toJpegBuffer(inputBuffer);
  let buf = await sharp(jpegBuffer).rotate().toBuffer();

  for (const mode of modes) {
    if (mode === "brighten" || mode === "vivid") {
      buf =
        mode === "brighten" ? await applyBrighten(buf) : await applyVivid(buf);
    } else {
      // AI mode
      try {
        buf = await runReplicateAI(buf, mode);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(
          `AI processing failed for ${mode}: ${msg}. Falling back to sharp.`,
        );
        buf = await aiFallback(buf, mode);
      }
    }
  }

  return sharp(buf).jpeg({ quality: 93 }).toBuffer();
}

// ── Free preview (sharp only, downsampled) ───────────────────────────────────

export async function makeFreePreview(
  inputBuffer: Buffer,
  modes: EnhancementMode[],
): Promise<Buffer> {
  const jpegBuffer = await toJpegBuffer(inputBuffer);
  const oriented = await sharp(jpegBuffer).rotate().toBuffer();

  const meta = await sharp(oriented).metadata();
  const w = meta.width ?? 800;
  const h = meta.height ?? 800;

  // Downsample to 50% to create preview-quality
  const smallBuf = await sharp(oriented)
    .resize(Math.round(w * 0.5), Math.round(h * 0.5))
    .toBuffer();

  let buf = smallBuf;
  for (const mode of modes) {
    switch (mode) {
      case "sharpen":
        buf = await sharp(buf)
          .sharpen({ sigma: 1.2, m1: 1.5, m2: 2.0 })
          .toBuffer();
        break;
      case "brighten":
        buf = await sharp(buf)
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: 1.15 })
          .toBuffer();
        break;
      case "denoise":
        buf = await sharp(buf)
          .median(3)
          .sharpen({ sigma: 0.5, m1: 0.5, m2: 1.0 })
          .toBuffer();
        break;
      case "restore":
        buf = await sharp(buf)
          .normalise({ lower: 2, upper: 98 })
          .median(3)
          .sharpen({ sigma: 0.8, m1: 1.0, m2: 1.5 })
          .toBuffer();
        break;
      case "vivid":
        buf = await sharp(buf)
          .normalise({ lower: 1, upper: 99 })
          .modulate({ saturation: 1.5, brightness: 1.05 })
          .toBuffer();
        break;
      case "colorize":
        // Free preview: warm tint since we can't run AI
        buf = await sharp(buf)
          .modulate({ brightness: 1.05, saturation: 1.3 })
          .linear([1.05, 1.0, 0.95], [2, 0, -2])
          .toBuffer();
        break;
    }
  }

  const processed = await sharp(buf)
    .resize(w, h, { kernel: sharp.kernel.linear })
    .jpeg({ quality: 72 })
    .toBuffer();

  // Add watermark overlay
  const meta2 = await sharp(processed).metadata();
  const imgW = meta2.width ?? 800;
  const imgH = meta2.height ?? 600;

  const fontSize = Math.max(18, Math.round(imgW * 0.045));
  const lineH = Math.round(fontSize * 1.6);
  const lines = ["© ONJJEM.COM", "WATERMARKED PREVIEW"];
  const svgH = lines.length * lineH + 16;

  const svgText = `<svg width="${imgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${imgW}" height="${svgH}" fill="rgba(0,0,0,0.45)"/>
    ${lines
      .map(
        (line, i) => `<text
      x="${imgW / 2}" y="${16 + lineH * i + fontSize}"
      font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold"
      fill="rgba(255,255,255,0.85)" text-anchor="middle" letter-spacing="3"
    >${line}</text>`,
      )
      .join("")}
  </svg>`;

  return sharp(processed)
    .composite([{ input: Buffer.from(svgText), gravity: "south" }])
    .jpeg({ quality: 72 })
    .toBuffer();
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/process", async (req: Request, res: Response) => {
  const body = req.body as {
    imageBase64?: string;
    modes?: EnhancementMode[];
    freePreview?: boolean;
    mode?: string;
  };

  const { imageBase64 } = body;
  const freePreview = body.freePreview !== false;

  const modes: EnhancementMode[] =
    body.modes && body.modes.length > 0
      ? (body.modes as EnhancementMode[])
      : body.mode === "sharpen"
        ? ["sharpen"]
        : [];

  const validModes = [
    "sharpen",
    "brighten",
    "denoise",
    "restore",
    "vivid",
    "colorize",
  ];
  const filtered = modes.filter((m) =>
    validModes.includes(m),
  ) as EnhancementMode[];

  if (!imageBase64 || filtered.length === 0) {
    res
      .status(400)
      .json({ error: "imageBase64 and at least one valid mode are required" });
    return;
  }

  if (filtered.length > 3) {
    res
      .status(400)
      .json({ error: "A maximum of 3 enhancements can be combined" });
    return;
  }

  try {
    const inputBuffer = Buffer.from(imageBase64, "base64");
    const outputBuffer = freePreview
      ? await makeFreePreview(inputBuffer, filtered)
      : await applyEnhancements(inputBuffer, filtered);
    const resultBase64 = outputBuffer.toString("base64");
    res.json({ resultBase64 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    req.log.error({ message }, "Process route error");
    res.status(500).json({ error: message });
  }
});

export default router;
