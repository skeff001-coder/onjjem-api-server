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

const JSON_SAFETY_NOTE = `\n\nImportant formatting rule: your entire reply must be a single valid JSON object string. Do not wrap it in markdown codes block like \`\`\`json.`;

/**
 * POST /api/server/routes/canine
 * Evaluates the free dog scan photo and returns the baseline structural analytics dataset.
 */
router.post("/", async (req: Request, res: Response) => {
  const { breed, imageBase64 } = req.body;

  if (!breed) {
    return res.status(400).json({ error: "Missing required dog breed target identity parameter." });
  }

  try {
    const ai = getAI();
    
    // Explicit, extensive textbook instruction to force maximum text generation details from original scan data
    const detailedPrompt = `You are an expert canine geneticist and veterinary animal behaviorist writing an official, high-end Heritage Almanac entry for the breed "${breed}". Using the dog data provided, you MUST generate an extensive, highly comprehensive multilinear textbook report. Short summaries or generic placeholders are strictly banned. Format your JSON response explicitly into these exact properties:
    
    {
      "breed": "${breed}",
      "ancestralBreakdown": "Write an extensive historical narrative detailing the deep genetic ancestry trees, country geographic origins, historical migration timelines, breeding purposes, and ancient pack migration histories for this type of dog.",
      "ageCalculations": "Provide an exhaustive cellular-to-visual breakdown analyzing coat density patterns, optical transparency characteristics, skeletal joint structural velocities, and historical dental wear configurations to summarize life stage indicators.",
      "personalityMatcher": "Formulate a massive, comprehensive behavioral psychological profile detailing pack hierarchy positions, high-tier energy recovery metrics, natural guarding or social response indexes, and interactive household companion indexes."
    } ${JSON_SAFETY_NOTE}`;

    // Invoke Gemini model execution handler passing the frame configurations
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        detailedPrompt,
        ...(imageBase64 ? [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] : [])
      ],
    });

    const responseText = response.text?.trim() || "{}";
    
    // Safety check parsing filter loops to ensure stable client payloads
    let parsedData;
    try {
      parsedData = JSON.parse(responseText.replace(/```json|```/g, ""));
    } catch (parseError) {
      console.error("JSON Parsing Failure encountered raw response strings:", responseText);
      return res.status(500).json({ error: "Failed to compile the deep reports in valid data matrix structure." });
    }

    // Direct automated return channel safely routing payloads back down to the mobile viewport context
    return res.status(200).json(parsedData);

  } catch (error: any) {
    console.error("Critical error inside core canine processing router handler logic:", error);
    return res.status(500).json({ error: error.message || "Internal application server parsing fault." });
  }
});

export default router;
