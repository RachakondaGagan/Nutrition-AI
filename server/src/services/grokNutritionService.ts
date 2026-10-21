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

const SYSTEM_PROMPT = `You are an expert nutrition and dietetics assistant specializing in Indian foods and fitness journaling.
Rules:
- Identify each food item, its quantity and unit, and preparation method.
- Unit MUST be strictly one of: 'g', 'kg', 'ml', 'l', 'piece', 'slice', 'cup', 'tbsp', 'tsp', 'serving', 'plate', 'bowl'.
- Raw vs cooked strictly matters. E.g. "100 g dry rice" vs "100 g cooked rice", "40 g dry soya chunks" vs "100 g cooked soya chunks".
- Specialize in Indian foods: eggs, soya chunks, paneer, dal, rajma, chana, roti/chapati, rice, curd/yogurt, poha, dosa, idli, biryani, sabzi, college mess meals.
- Account for hidden cooking oil/ghee (typically 5-10g per serving in Indian dishes) and list it explicitly in assumptions.
- All nutrient values are for the WHOLE stated quantity of that item, not per 100 g.
- If you cannot estimate a nutrient, return null. Never return 0 as a guess.
- Put every assumption (recipe, hidden oil/ghee, portion depth) in "assumptions".
- "confidence" is 0 to 1 and should be realistic for mixed dishes and photo portions.
- If no recognizable food is present, set food_detected to false and items to [].
- Do not return daily totals. The application calculates them.`;

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
    const promptInstructions = `\nCRITICAL: Return ONLY a valid JSON object matching this EXACT schema:
{
  "food_detected": true,
  "items": [
    {
      "name": "Food Name",
      "quantity": 1,
      "unit": "piece",
      "weight_g": null,
      "preparation": null,
      "calories_kcal": 150,
      "protein_g": 10,
      "carbs_g": 20,
      "fat_g": 5,
      "saturated_fat_g": null,
      "sugar_g": null,
      "fiber_g": null,
      "sodium_mg": null,
      "confidence": 0.85,
      "assumptions": ["Standard preparation"]
    }
  ],
  "notes": null
}
Unit MUST be strictly one of: g, kg, ml, l, piece, slice, cup, tbsp, tsp, serving, plate, bowl.
If no food is recognized, set food_detected to false and items to [].`;

    json = await postApi(cfg, "/chat/completions", {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + promptInstructions },
        { role: "user", content: userContent.length === 1 && userContent[0].type === "text" ? userContent[0].text : userContent },
      ],
      response_format: { type: "json_object" },
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
