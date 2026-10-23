import { AnalysisSchema, ANALYSIS_JSON_SCHEMA, UNITS, type Analysis } from "../schemas/nutrition.js";

export type GrokErrorCode =
  | "not_configured" | "timeout" | "rate_limited" | "model_unavailable" | "upstream" | "bad_output";

export class GrokError extends Error {
  constructor(public code: GrokErrorCode, message: string, public status?: number) {
    super(message);
    this.name = "GrokError";
  }
}

export interface GrokConfig {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  visionModel: string;
  timeoutMs: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GrokConfig {
  const apiKey = env.XAI_API_KEY;
  const textModel = env.XAI_TEXT_MODEL;
  const visionModel = env.XAI_VISION_MODEL;
  if (!apiKey || !textModel || !visionModel) {
    throw new GrokError("not_configured", "XAI_API_KEY, XAI_TEXT_MODEL and XAI_VISION_MODEL must be set");
  }
  return {
    apiKey, textModel, visionModel,
    baseUrl: env.XAI_BASE_URL ?? "https://api.x.ai/v1",
    // xAI's own examples use long timeouts for reasoning models. Tune after measuring.
    timeoutMs: Number(env.XAI_TIMEOUT_MS ?? 60000),
  };
}

const SYSTEM_PROMPT = `You are an elite clinical dietitian and nutrition scientist specializing in Indian food composition (NIN-ICMR standards) and sports nutrition.

ANCHOR NUTRITION REFERENCE TABLE (NIN-ICMR / USDA — treat these as EXACT):
EGGS:
- 1 Large Egg (boiled/poached, 50g): 74 kcal, 6.3g P, 0.4g C, 5.0g F
- 1 Egg White (33g): 17 kcal, 3.6g P, 0.2g C, 0.05g F
- 1 Egg Yolk (17g): 55 kcal, 2.7g P, 0.6g C, 4.5g F
- 2 boiled eggs = 148 kcal, 12.6g P, 0.8g C, 10.0g F
- 3 boiled eggs = 222 kcal, 18.9g P, 1.2g C, 15.0g F
DAIRY & PROTEIN:
- Paneer (raw/cubed): 100g = 265 kcal, 18.3g P, 3.5g C, 20.8g F
- Low-fat Paneer: 100g = 160 kcal, 25.0g P, 4.0g C, 5.0g F
- Toned Milk: 100ml = 60 kcal, 3.2g P, 4.8g C, 3.0g F; 250ml glass = 150 kcal, 8.0g P, 12.0g C, 7.5g F
- Curd/Dahi (toned): 100g = 60 kcal, 3.5g P, 4.5g C, 3.0g F; 1 katori (150g) = 90 kcal, 5.2g P, 6.8g C, 4.5g F
- Whey Protein (1 scoop 30g): 120 kcal, 24.0g P, 2.0g C, 1.5g F
- Chicken Breast (boneless cooked): 100g = 165 kcal, 31.0g P, 0.0g C, 3.6g F
- Tofu (firm): 100g = 76 kcal, 8.0g P, 1.9g C, 4.8g F
LEGUMES & SOY:
- Soya Chunks (dry weight): 100g = 345 kcal, 52.0g P, 33.0g C, 0.5g F; 40g dry = 138 kcal, 20.8g P, 13.2g C, 0.2g F
- Dal cooked (1 katori/150g, with 1 tsp oil tadka): 125 kcal, 6.8g P, 17.0g C, 3.5g F
- Rajma/Chole/Chana cooked (1 katori/150g with gravy): 180 kcal, 9.0g P, 28.0g C, 4.0g F
- Sprouts (moong, 100g raw): 30 kcal, 3.0g P, 5.9g C, 0.2g F
GRAINS & CARBS:
- Roti/Phulka (1 medium, 35g flour, 15cm): 105 kcal, 3.2g P, 21.0g C, 0.6g F; with 1/2 tsp ghee = 130 kcal, 3.2g P, 21.0g C, 3.1g F
- Cooked White Rice: 100g = 130 kcal, 2.7g P, 28.0g C, 0.3g F; 1 katori (150g) = 195 kcal, 4.0g P, 42.0g C, 0.5g F
- Cooked Brown Rice: 100g = 111 kcal, 2.6g P, 23.0g C, 0.9g F
- 1 Medium Banana (118g): 105 kcal, 1.3g P, 27.0g C, 0.3g F
- Brown Bread (1 slice 30g): 75 kcal, 3.0g P, 12.5g C, 1.0g F
- White Bread (1 slice 25g): 65 kcal, 2.0g P, 12.0g C, 0.7g F
- Oats (dry, 40g): 148 kcal, 5.2g P, 26.0g C, 2.8g F
SOUTH INDIAN:
- 1 Plain Dosa (medium, 80g): 135 kcal, 3.0g P, 23.0g C, 3.5g F
- 1 Masala Dosa: 200 kcal, 4.5g P, 31.0g C, 6.5g F
- 1 Idli (50g): 58 kcal, 2.0g P, 12.5g C, 0.2g F
- 1 Sambar katori (150ml): 65 kcal, 3.5g P, 10.0g C, 1.5g F
BEVERAGES:
- 1 Cup Chai/Milk Tea (150ml, half milk, 1 tsp sugar): 65 kcal, 2.0g P, 8.5g C, 2.2g F
- Black Coffee (200ml, no sugar): 5 kcal, 0.3g P, 0.5g C, 0.1g F
COOKING FATS (to add per Indian dish if oil/ghee used):
- 1 tsp oil/ghee (5g): 44 kcal, 0g P, 0g C, 5.0g F

RULES:
1. Always decompose meals into individual food items. Never merge different foods into one item.
2. MATHEMATICAL RULE: calories_kcal MUST equal (4 × protein_g) + (4 × carbs_g) + (9 × fat_g), within ±3%.
3. Use the anchor table values above as ground truth. Only deviate with explicit reasoning.
4. Unit MUST strictly be one of: g, kg, ml, l, piece, slice, cup, tbsp, tsp, serving, plate, bowl.
5. Raw vs cooked distinction is critical. When unsure, state assumption. Soya chunks = always dry weight.
6. For hidden oil/ghee in Indian cooking, add a separate oil item in items list.
7. All nutrient values are for the WHOLE stated quantity, not per 100g.
8. If you cannot reliably estimate a nutrient, return null. Never guess 0.
9. Put every assumption in the "assumptions" array.
10. If no recognizable food is present, set food_detected to false and items to [].`;

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" };

export interface AnalysisResult {
  analysis: Analysis;
  meta: { model: string; latencyMs: number; usage: unknown };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusToError(status: number): GrokError {
  if (status === 429) return new GrokError("rate_limited", "The AI service is busy. Try again shortly.", status);
  if (status === 404) return new GrokError("model_unavailable", "The configured AI model is unavailable.", status);
  if (status === 401 || status === 403) return new GrokError("upstream", "AI service rejected our credentials.", status);
  return new GrokError("upstream", `AI service error (${status}).`, status);
}

async function postApi(cfg: GrokConfig, endpoint: string, body: unknown): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt === 0) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 1500;
        await sleep(Math.min(wait, 5000));
        continue;
      }
      throw statusToError(res.status);
    } catch (e) {
      if (e instanceof GrokError) throw e;
      if ((e as Error).name === "AbortError") throw new GrokError("timeout", "The AI request timed out.");
      if (attempt === 0) { await sleep(1000); continue; }
      throw new GrokError("upstream", "Could not reach the AI service.");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new GrokError("upstream", "AI request failed.");
}

function extractContent(json: any): string {
  // Chat completions format (Groq, OpenAI, xAI chat)
  const chatText = json?.choices?.[0]?.message?.content;
  if (typeof chatText === "string") return chatText;
  // xAI responses format
  const message = json?.output?.find((o: any) => o.type === "message");
  const text = message?.content?.find((c: any) => c.type === "output_text")?.text;
  if (typeof text === "string") return text;
  throw new GrokError("bad_output", "AI reply had no text output.");
}

async function run(cfg: GrokConfig, model: string, parts: InputPart[]): Promise<AnalysisResult> {
  const started = Date.now();
  const isGroqOrChat = cfg.apiKey.startsWith("gsk_") || cfg.baseUrl.includes("groq.com") || cfg.baseUrl.endsWith("/v1");

  let json: any;
  if (isGroqOrChat) {
    // OpenAI / Groq chat completions
    const userContent = parts.map((p) => {
      if (p.type === "input_text") return { type: "text", text: p.text };
      return { type: "image_url", image_url: { url: p.image_url } };
    });
    const promptInstructions = `\nCRITICAL: Return ONLY a valid JSON object — no markdown fences, no explanation. Schema:
{
  "food_detected": true,
  "items": [
    {
      "name": "Boiled Egg",
      "quantity": 2,
      "unit": "piece",
      "weight_g": 100,
      "preparation": "boiled",
      "calories_kcal": 148,
      "protein_g": 12.6,
      "carbs_g": 0.8,
      "fat_g": 10.0,
      "saturated_fat_g": 3.1,
      "sugar_g": 0.2,
      "fiber_g": 0,
      "sodium_mg": 140,
      "confidence": 0.97,
      "assumptions": ["Standard large eggs 50g each"]
    }
  ],
  "notes": null
}
STRICT:
- unit must be one of: g, kg, ml, l, piece, slice, cup, tbsp, tsp, serving, plate, bowl
- calories_kcal must equal (4*protein_g)+(4*carbs_g)+(9*fat_g) within plus/minus 3%
- Decompose each distinct food into its own item — never merge different foods into one
- Use NIN-ICMR anchor values from reference table as ground truth
- If no food detected, set food_detected to false and items to []`;

    json = await postApi(cfg, "/chat/completions", {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + promptInstructions },
        { role: "user", content: userContent.length === 1 && userContent[0].type === "text" ? userContent[0].text : userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
  } else {
    // xAI responses endpoint
    json = await postApi(cfg, "/responses", {
      model,
      store: false,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: parts },
      ],
      text: {
        format: { type: "json_schema", name: "nutrition_estimate", schema: ANALYSIS_JSON_SCHEMA, strict: true },
      },
    });
  }

  let raw: any;
  try {
    raw = JSON.parse(extractContent(json));
  } catch (e) {
    if (e instanceof GrokError) throw e;
    throw new GrokError("bad_output", "AI reply was not valid JSON.");
  }

  // Sanitize and normalize LLM quirks before schema validation
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) {
      raw.items = raw.items.map((it: any) => {
        if (!it || typeof it !== "object") return it;
        let u = typeof it.unit === "string" ? it.unit.trim().toLowerCase() : "serving";
        if (!(UNITS as readonly string[]).includes(u)) {
          if (["glasses", "glassful"].includes(u)) u = "glass";
          else if (["katoris", "katori"].includes(u)) u = "katori";
          else if (["slices", "slice"].includes(u)) u = "slice";
          else if (["pieces", "piece", "pcs", "pc", "eggs", "egg", "rotis", "roti", "chapati", "chapatis"].includes(u)) u = "piece";
          else if (["cups", "cup"].includes(u)) u = "cup";
          else if (["bowls", "bowl"].includes(u)) u = "bowl";
          else if (["tablespoons", "tablespoon", "tbsp"].includes(u)) u = "tbsp";
          else if (["teaspoons", "teaspoon", "tsp"].includes(u)) u = "tsp";
          else if (["grams", "gram", "gm", "gms"].includes(u)) u = "g";
          else if (["kilograms", "kilogram", "kgs"].includes(u)) u = "kg";
          else if (["milliliters", "millilitres", "milliliter", "millilitre"].includes(u)) u = "ml";
          else if (["liters", "litres", "liter", "litre"].includes(u)) u = "l";
          else if (["plates", "plate"].includes(u)) u = "plate";
          else if (["scoops", "scoop"].includes(u)) u = "scoop";
          else if (["portions", "portion"].includes(u)) u = "portion";
          else u = "serving";
        }
        return {
          ...it,
          quantity: typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1,
          unit: u,
          confidence: typeof it.confidence === "number" ? Math.min(1, Math.max(0, it.confidence)) : 0.8,
          assumptions: Array.isArray(it.assumptions) ? it.assumptions.slice(0, 8) : [],
        };
      });
    }
  }

  const parsed = AnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = parsed.error.issues.slice(0, 5).map((i) => i.path.join("."));
    console.warn("[ai] schema validation failed at:", paths);
    throw new GrokError("bad_output", "AI reply failed validation. Please retry.");
  }
  return { analysis: parsed.data, meta: { model, latencyMs: Date.now() - started, usage: json?.usage ?? null } };
}

export function createGrokNutritionService(cfg: GrokConfig = configFromEnv()) {
  return {
    analyzeText(description: string, mealHint?: string): Promise<AnalysisResult> {
      const safe = description.replaceAll("</user_text>", "").slice(0, 1000);
      const hint = mealHint ? `\nMeal type: ${mealHint}` : "";
      return run(cfg, cfg.textModel, [
        { type: "input_text", text: `<user_text>\n${safe}\n</user_text>${hint}` },
      ]);
    },

    /** xAI's docs list JPEG and PNG only. Convert WebP to JPEG before calling this. */
    analyzeImage(bytes: Buffer, mime: "image/jpeg" | "image/png", note?: string): Promise<AnalysisResult> {
      const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
      const parts: InputPart[] = [
        { type: "input_image", image_url: dataUrl, detail: "high" },
        {
          type: "input_text",
          text: "Estimate the food in this photo. Portions from photos are approximate; lower confidence and list assumptions."
            + (note ? `\n<user_text>\n${note.replaceAll("</user_text>", "").slice(0, 300)}\n</user_text>` : ""),
        },
      ];
      return run(cfg, cfg.visionModel, parts);
    },

    async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
      const isGroqOrChat = cfg.apiKey.startsWith("gsk_") || cfg.baseUrl.includes("groq.com") || cfg.baseUrl.endsWith("/v1");
      if (isGroqOrChat) {
        const json = await postApi(cfg, "/chat/completions", {
          model: cfg.textModel,
          messages,
          max_tokens: 600,
          temperature: 0.7,
        });
        return extractContent(json);
      } else {
        const userMsg = messages[messages.length - 1]?.content ?? "";
        const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
        const json = await postApi(cfg, "/responses", {
          model: cfg.textModel,
          input: [
            { role: "system", content: systemMsg },
            { role: "user", content: [{ type: "input_text", text: userMsg }] },
          ],
        });
        return extractContent(json);
      }
    },
  };
}

export type GrokNutritionService = ReturnType<typeof createGrokNutritionService>;
