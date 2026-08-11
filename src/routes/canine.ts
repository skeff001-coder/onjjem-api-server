import { Router, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

function getAI() {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini AI integration not configured");
  }
  return new GoogleGenAI({ apiKey });
}

// Appended to every prompt that asks Gemini for JSON. The model
// occasionally forgets to escape a double quote or apostrophe inside a
// text field (e.g. a nickname in quotes, or a possessive), which produces
// JSON that looks valid at a glance but fails to parse with an error like
// "Unterminated string in JSON at position X". Telling it explicitly to
// avoid/escape these characters cuts down how often this happens at all.
const JSON_SAFETY_NOTE =
  "\n\nImportant formatting rule: your entire reply must be a single valid JSON object. Inside any text value, never use an unescaped double quote character — if you need to quote something, use single quotes instead. Do not include literal line breaks inside a string value.";

type GeminiParts = ({ text: string } | { inlineData: { mimeType: string; data: string } })[];

// Calls Gemini and parses its JSON response, automatically retrying the
// whole call once if parsing fails. A malformed-JSON response from the
// model is usually a one-off formatting slip rather than something that
// will happen identically twice in a row, so a single retry resolves the
// large majority of cases without the person needing to manually try
// again themselves.
async function generateAndParseJSON<T>(
  parts: GeminiParts,
  maxOutputTokens: number,
  useThinkingBudgetZero: boolean,
): Promise<T> {
  const ai = getAI();
  const config: Record<string, unknown> = {
    maxOutputTokens,
    responseMimeType: "application/json",
  };
  if (useThinkingBudgetZero) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts }],
        config,
      });
      const text = response.text ?? "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try {
        return JSON.parse(cleaned) as T;
      } catch (parseErr) {
        const finishReason = (response as any)?.candidates?.[0]?.finishReason ?? "unknown";
        const snippet = cleaned.slice(0, 120);
        throw new Error(
          `AI returned incomplete JSON (finishReason: ${finishReason}, length: ${cleaned.length}). Snippet: ${snippet}`,
        );
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

router.post("/scan-breed", async (req: Request, res: Response) => {
  const { base64Image, mimeType = "image/jpeg" } = req.body;

  if (!base64Image) {
    res.status(400).json({ error: "base64Image is required" });
    return;
  }

  try {
    const result = await generateAndParseJSON(
      [
        { inlineData: { mimeType, data: base64Image } },
        {
          text: `You are an expert canine breed identifier. Analyze this image and identify the dog breed(s).

Return ONLY valid JSON with this exact structure:
{
  "breed": "Primary breed name (e.g. 'Golden Retriever' or 'Labrador Retriever Mix')",
  "confidence": "high | medium | low",
  "isMix": true or false,
  "mixBreeds": ["Breed1", "Breed2"] (only if isMix is true, otherwise omit or empty array)
}

If no dog is detected, return: {"breed": "Unknown", "confidence": "low", "isMix": false}
If it's a mix, list the most likely component breeds in mixBreeds.
Do not include any text outside the JSON.${JSON_SAFETY_NOTE}`,
        },
      ],
      512,
      true,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Breed scan failed");
    res.status(500).json({ error: "Breed identification failed", details: e?.message });
  }
});

router.post("/breed-knowledge", async (req: Request, res: Response) => {
  const { breed } = req.body;

  if (!breed) {
    res.status(400).json({ error: "breed is required" });
    return;
  }

  try {
    const result = await generateAndParseJSON(
      [
        {
          text: `You are a world-class canine encyclopaedia with deep knowledge of all dog breeds. 
Provide a comprehensive knowledge report for the breed: "${breed}"

Return ONLY valid JSON with this EXACT structure (no markdown, no extra text):
{
  "breed": "${breed}",
  "habitat": {
    "countryOfOrigin": "Country name",
    "climate": "Climate description (e.g. 'Temperate oceanic')",
    "coatAdaptation": "How the coat evolved for the environment",
    "geographicNotes": "2-3 sentences about the geographic origins and how the environment shaped the breed"
  },
  "history": {
    "ancientLineage": "2-3 sentences tracing ancient ancestry",
    "wolfPopulation": "Eurasian wolf / Siberian wolf / South Asian wolf (pick closest ancestor)",
    "firstRecordedUse": "Earliest documented use (e.g. 'Medieval hunting, 14th century England')",
    "evolutionSummary": "2-3 sentences on how the breed was developed over centuries"
  },
  "functionalGroup": {
    "group": "Hound OR Gundog OR Terrier OR Working OR Pastoral OR Toy OR Utility OR Mixed",
    "historicalJob": "Specific historical role in one sentence",
    "modernRole": "Modern use in one sentence",
    "groupDescription": "2 sentences about the group's broader characteristics"
  },
  "grooming": {
    "coatType": "e.g. Double coat, long, wavy",
    "brushingFrequency": "e.g. Daily brushing required",
    "bathingFrequency": "e.g. Every 4-6 weeks",
    "nailCare": "e.g. Trim every 3-4 weeks",
    "earCare": "e.g. Check and clean weekly",
    "noseLearherCare": "e.g. Moisturise with dog-safe balm if dry",
    "pawPadCare": "e.g. Check for cracks, apply paw balm in winter",
    "professionalGroomingFrequency": "e.g. Every 8-12 weeks"
  },
  "health": {
    "lifespan": "e.g. 10-12 years",
    "commonConditions": ["Condition 1", "Condition 2", "Condition 3"],
    "geneticPredispositions": ["Genetic issue 1", "Genetic issue 2"],
    "parasiteRisks": ["Fleas", "Ticks", "Roundworm"],
    "lethargyWarnings": ["Warning sign 1", "Warning sign 2"],
    "exerciseNeeds": "e.g. 60-90 minutes per day"
  },
  "funFacts": [
    "Interesting fact 1",
    "Interesting fact 2",
    "Interesting fact 3"
  ],
  "mapHighlight": "Country/region to highlight on a world map (e.g. 'United Kingdom')"
}${JSON_SAFETY_NOTE}`,
        },
      ],
      8192,
      false,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Breed knowledge fetch failed");
    res.status(500).json({ error: "Knowledge generation failed", details: e?.message });
  }
});

router.post("/glowup", async (req: Request, res: Response) => {
  const { breed, style, dogName } = req.body;

  if (!breed || !style) {
    res.status(400).json({ error: "breed and style are required" });
    return;
  }

  try {
    const name = dogName ? `a ${breed} named ${dogName}` : `a ${breed}`;
    const result = await generateAndParseJSON(
      [
        {
          text: `You are a world-class fine art critic and portrait painter. Imagine ${name} has been immortalised as a "${style}" artwork.

Write a vivid, evocative description of this portrait — as if you are standing in front of it in a gallery. Be specific about brushwork, colours, composition, lighting, and mood. Make it feel real and beautiful. 3–5 sentences, rich and poetic.

Also suggest 3 hex colour codes that capture the palette of this artwork.

Return ONLY valid JSON:
{
  "title": "Portrait title (e.g. 'Biscuit in Golden Hour, after Van Gogh')",
  "vision": "The vivid gallery description here...",
  "palette": ["#hexcode1", "#hexcode2", "#hexcode3"]
}${JSON_SAFETY_NOTE}`,
        },
      ],
      512,
      true,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Glowup generation failed");
    res.status(500).json({ error: "Glow-Up generation failed", details: e?.message });
  }
});

// ─── Premium Scanner Endpoints ───────────────────────────────────────────────

router.post("/mixed-breed-dna", async (req: Request, res: Response) => {
  const { base64Image, mimeType = "image/jpeg" } = req.body;
  if (!base64Image) { res.status(400).json({ error: "base64Image is required" }); return; }
  try {
    const result = await generateAndParseJSON(
      [
        { inlineData: { mimeType, data: base64Image } },
        {
          text: `Analyse this dog photo as a canine geneticist producing a thorough, premium DNA-style heritage report — this is a paid product, so it needs to feel genuinely comprehensive and personal, not a quick summary.

Return ONLY valid JSON:
{
  "primaryBreed": "Main breed",
  "secondaryBreed": "Secondary breed or 'None'",
  "confidence": 85,
  "geneticMarkers": ["Visual marker 1", "Visual marker 2", "Visual marker 3", "Visual marker 4", "Visual marker 5"],
  "ancestralBreeds": [
    { "breed": "Ancestor breed name", "estimatedPercentage": 45, "traitContribution": "What this breed likely contributed (coat, build, temperament)" },
    { "breed": "Ancestor breed name", "estimatedPercentage": 30, "traitContribution": "What this breed likely contributed" }
  ],
  "dnaSummary": "A rich, engaging paragraph (4-5 sentences) telling the story of this dog's genetic heritage, written to be shared and enjoyed",
  "inheritedTraits": [
    { "trait": "Specific behaviour or physical trait", "likelySource": "Which breed in the mix this probably comes from" },
    { "trait": "Specific behaviour or physical trait", "likelySource": "Which breed in the mix this probably comes from" },
    { "trait": "Specific behaviour or physical trait", "likelySource": "Which breed in the mix this probably comes from" }
  ],
  "healthConsiderations": ["Mix-specific health note 1", "Mix-specific health note 2", "Mix-specific health note 3"],
  "geneticFunFact": "One genuinely interesting, specific fact about this breed combination's ancestral history"
}${JSON_SAFETY_NOTE}`,
        },
      ],
      4096,
      true,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Mixed breed DNA failed");
    res.status(500).json({ error: "Mixed breed DNA analysis failed", details: e?.message });
  }
});

router.post("/age-estimate", async (req: Request, res: Response) => {
  const { base64Image, mimeType = "image/jpeg" } = req.body;
  if (!base64Image) { res.status(400).json({ error: "base64Image is required" }); return; }
  try {
    const result = await generateAndParseJSON(
      [
        { inlineData: { mimeType, data: base64Image } },
        {
          text: `Estimate this dog's age from visual cues in the photo (coat condition, eye clarity, muscle tone, grey muzzle, teeth if visible), and produce a thorough, premium age report — this is a paid product, so it needs to feel genuinely comprehensive and personal, not a quick estimate.

Return ONLY valid JSON:
{
  "estimatedAge": "e.g. 3-4 years",
  "ageRange": "e.g. 2-5 years",
  "confidence": 78,
  "lifeStage": "Puppy / Adolescent / Young Adult / Mature Adult / Senior",
  "signs": ["Visual sign 1", "Visual sign 2", "Visual sign 3", "Visual sign 4", "Visual sign 5"],
  "birthdayEstimate": "Born around season year",
  "humanYearsEquivalent": "e.g. Around 28-31 in human years",
  "lifeStageDescription": "2-3 sentences on what this specific life stage means for this dog day-to-day right now",
  "whatsNextMilestone": "1-2 sentences on the next life stage ahead and roughly when to expect it",
  "careRecommendations": ["Age-specific care tip 1", "Age-specific care tip 2", "Age-specific care tip 3"]
}${JSON_SAFETY_NOTE}`,
        },
      ],
      4096,
      true,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Age estimate failed");
    res.status(500).json({ error: "Age estimation failed", details: e?.message });
  }
});

router.post("/personality-scan", async (req: Request, res: Response) => {
  const { base64Image, mimeType = "image/jpeg", breed } = req.body;
  if (!base64Image) { res.status(400).json({ error: "base64Image is required" }); return; }
  try {
    const breedHint = breed ? `The dog is identified as a ${breed}.` : "Identify the breed from the image first.";
    const result = await generateAndParseJSON(
      [
        { inlineData: { mimeType, data: base64Image } },
        {
          text: `Analyse this dog's personality from its expression, posture, and appearance. ${breedHint} Produce a thorough, premium personality profile — this is a paid product, so it needs to feel genuinely comprehensive and personal, not a quick description.

Return ONLY valid JSON:
{
  "traits": ["Trait 1", "Trait 2", "Trait 3", "Trait 4", "Trait 5", "Trait 6"],
  "dominantTrait": "Most dominant personality trait",
  "socialStyle": "How they interact with people and dogs",
  "energyLevel": "e.g. High — needs 90+ min exercise daily",
  "description": "A rich, engaging paragraph (4-5 sentences) describing this dog's personality, written to be shared and enjoyed",
  "idealOwnerMatch": "2-3 sentences on the kind of owner and lifestyle this dog would thrive with",
  "trainingStyle": "2 sentences on how this personality type responds best to training — what motivates them",
  "behaviouralQuirk": "One specific, charming quirk or habit this personality type likely has",
  "compatibilityNotes": "2 sentences on how this dog would likely do with children and other pets"
}${JSON_SAFETY_NOTE}`,
        },
      ],
      3072,
      true,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Personality scan failed");
    res.status(500).json({ error: "Personality scan failed", details: e?.message });
  }
});

router.post("/health-guide", async (req: Request, res: Response) => {
  const { breed, dogName } = req.body;
  if (!breed) { res.status(400).json({ error: "breed is required" }); return; }
  try {
    const name = dogName ? `${dogName} the ${breed}` : `a ${breed}`;
    const result = await generateAndParseJSON(
      [
        {
          text: `Create a personalised health and care guide for ${name}. Include ONJJEM product recommendations (personalised dog merchandise) naturally within the health tips.

Return ONLY valid JSON:
{
  "healthTips": ["Tip 1", "Tip 2", "Tip 3", "Tip 4"],
  "productRecommendations": [
    { "name": "Product name", "description": "Why it helps this breed", "url": "https://onjjem.com" }
  ],
  "exercisePlan": "Daily exercise recommendation",
  "dietNotes": "Diet and nutrition advice",
  "vetChecklist": ["Check 1", "Check 2", "Check 3"]
}${JSON_SAFETY_NOTE}`,
        },
      ],
      8192,
      false,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Health guide failed");
    res.status(500).json({ error: "Health guide generation failed", details: e?.message });
  }
});

router.post("/trick-trainer", async (req: Request, res: Response) => {
  const { breed, dogName } = req.body;
  if (!breed) { res.status(400).json({ error: "breed is required" }); return; }
  try {
    const name = dogName ? `${dogName} the ${breed}` : `a ${breed}`;
    const result = await generateAndParseJSON(
      [
        {
          text: `Create a fun, personalised trick training plan for ${name}. Tailor difficulty and tricks to the breed's intelligence and physical ability.

Return ONLY valid JSON:
{
  "difficulty": "Beginner / Intermediate / Advanced",
  "tricks": [
    { "name": "Trick name", "steps": 3, "time": "2-3 days" }
  ],
  "trainingSchedule": "Daily training routine",
  "tips": ["Tip 1", "Tip 2", "Tip 3"],
  "estimatedTime": "Total time to master all tricks"
}${JSON_SAFETY_NOTE}`,
        },
      ],
      8192,
      false,
    );
    res.json(result);
  } catch (e: any) {
    req.log.error({ err: e }, "Trick trainer failed");
    res.status(500).json({ error: "Trick trainer generation failed", details: e?.message });
  }
});

// Cartoon-ify — unlike every other route in this file, this one asks
// Gemini's image model to generate a new image rather than analyse the
// photo and return JSON.
//
// `style` selects which look to generate:
//   "default"       - free, always available, one generation per dog
//   "oil-painting"  - paid, part of the £3.99 unlock
//   "anime"         - paid, part of the £3.99 unlock
//   "pop-art"       - paid, part of the £3.99 unlock
//
// Paid styles are gated app-side via entitlement check before this is ever
// called - this endpoint itself doesn't verify purchase status.
const CARTOON_STYLE_PROMPTS: Record<string, string> = {
  default:
    "Turn this dog photo into a charming, vibrant 3D-animated cartoon character illustration in the style of a modern animated family film. Keep the dog's real markings, coat colour, and breed features recognisable, but render them as a playful, expressive cartoon character. Clean background, warm lighting, high detail.",
  "oil-painting":
    "Turn this dog photo into a rich, textured oil painting portrait in the style of a classical fine art masterpiece. Keep the dog's real markings, coat colour, and breed features clearly recognisable. Use visible brushstrokes, warm gallery lighting, and a painterly, timeless quality — as if it belongs on a gallery wall.",
  anime:
    "Turn this dog photo into a vibrant Japanese anime-style illustration. Keep the dog's real markings, coat colour, and breed features recognisable, but render with bold clean linework, expressive large eyes, and classic anime shading and colour style. Clean, dynamic background.",
  "pop-art":
    "Turn this dog photo into a bold pop art illustration in the style of Andy Warhol / Roy Lichtenstein. Keep the dog's real markings, coat colour, and breed features recognisable, but render with bold flat colours, high contrast, halftone dot shading, and graphic outlines. Vibrant, punchy colour palette.",
};

router.post("/dog-cartoon", async (req: Request, res: Response) => {
  const { base64Image, mimeType = "image/jpeg", style = "default" } = req.body;
  if (!base64Image) { res.status(400).json({ error: "base64Image is required" }); return; }

  const promptText = CARTOON_STYLE_PROMPTS[style];
  if (!promptText) {
    res.status(400).json({ error: `Unknown style: ${style}` });
    return;
  }

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Image } },
            { text: `${promptText} Do not add any text, watermark, or logo to the image.` },
          ],
        },
      ],
      config: {
        responseModalities: ["IMAGE"],
      },
    });

    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData,
    ) as { inlineData: { mimeType: string; data: string } } | undefined;

    if (!imagePart) {
      throw new Error("Gemini did not return an image");
    }

    res.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
    });
  } catch (e: any) {
    req.log.error({ err: e }, "Dog cartoon generation failed");
    res.status(500).json({ error: "Cartoon generation failed", details: e?.message });
  }
});

export default router;
