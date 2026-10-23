import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { localDate, resolveTz } from "./lib/dates.js";
import { AppError } from "./lib/errors.js";
import type { Authenticate } from "./middleware/auth.js";
import {
  AnalyzeText, DateStr, EntryInput, EntryPatch, MEALS, SavedFoodInput, WaterInput, WaterPatch,
} from "./schemas/api.js";
import { NUTRIENT_KEYS } from "./schemas/nutrition.js";
import { GrokError, type AnalysisResult } from "./services/grokNutritionService.js";
import { energyCheck, scaleItem, sumNutrients } from "./services/nutritionCalc.js";
import type { NutritionProvider } from "./services/provider.js";
import type { FoodEntry, SavedFood, Store, WaterEntry } from "./store.js";

export interface Deps {
  provider: NutritionProvider;
  store: Store;
  authenticate: Authenticate;
  corsOrigin?: string;
  aiLimitPerMinute?: number;
  staticDir?: string;
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(h(req, res)).catch(next);
const uid = (res: Response) => res.locals.userId as string;
const tzOf = (req: Request) => resolveTz(req.header("x-timezone"));
const now = () => new Date().toISOString();

function analysisResponse(r: AnalysisResult, provider: string) {
  const { items } = r.analysis;
  return {
    provider,
    analysis: r.analysis,
    totals: sumNutrients(items), // computed here, never taken from the model
    warnings: items.flatMap((i) => (energyCheck(i)?.ok === false ? [`Calories for "${i.name}" don't match its macros. Double-check this estimate.`] : [])),
    needs_confirmation: true, // nothing is saved until the user confirms via POST /api/food-entries
    meta: r.meta,
  };
}

export function createApp(d: Deps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: d.corsOrigin ?? "http://localhost:5173" }));
  app.use(express.json({ limit: "100kb" }));

  app.get(["/api/health", "/health"], (_req, res) => res.json({ ok: true, provider: d.provider.name }));

  const api = express.Router();
  api.use(async (req, res, next) => {
    try { res.locals.userId = await d.authenticate(req); next(); } catch (e) { next(e); }
  });
  const aiLimit = rateLimit({ windowMs: 60_000, limit: d.aiLimitPerMinute ?? 10, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: "rate_limited", message: "Too many AI requests. Wait a minute and try again." } } });

  // ---- AI analysis (returns an estimate only; never saves) ----
  api.post("/nutrition/analyze-text", aiLimit, wrap(async (req, res) => {
    const body = AnalyzeText.parse(req.body);
    res.json(analysisResponse(await d.provider.analyzeText(body.description, body.meal_type), d.provider.name));
  }));

  api.post("/nutrition/analyze-image", aiLimit,
    express.raw({ type: ["image/jpeg", "image/png"], limit: "8mb" }),
    wrap(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(415, "unsupported_media", "Send the image as image/jpeg or image/png (max 8 MB). Convert WebP in the browser first.");
      }
      const mime = req.is("image/png") ? "image/png" : "image/jpeg";
      res.json(analysisResponse(await d.provider.analyzeImage(req.body, mime), d.provider.name));
    }));

  // ---- AI Nutrition Coach Chatbot ----
  api.post("/chat", aiLimit, wrap(async (req, res) => {
    const { message, history } = req.body;
    if (!message || typeof message !== "string") {
      throw new AppError(400, "invalid_message", "Message is required.");
    }

    const profile = await d.store.getProfile(uid(res));
    const todayDate = localDate(new Date(), tzOf(req));
    const todayEntries = await d.store.getEntries(uid(res), todayDate);
    const todayTotals = sumNutrients(todayEntries);
    const todayWater = (await d.store.getWater(uid(res), todayDate)).reduce((a, w) => a + w.amount_ml, 0);

    const coachSystemPrompt = `You are NutritionX AI, personal nutrition and fitness coach for ${profile?.display_name ?? "Gagan"}.
User Profile:
- Height: ${profile?.height_cm ?? 183} cm (6 ft), Current Weight: ${profile?.weight_kg ?? 80} kg.
- Primary Goal: Gradual body recomposition & fat loss (0.25-0.5 kg/week) while building a consistent lifestyle.
- Diet: Indian vegetarian who eats eggs (3-4 eggs/day comfortable). Focus on whole foods: boiled eggs, soya chunks, paneer, tofu, dal, rajma, chana, curd, milk, sprouts, roti, rice, fruits.
- Daily Targets: ${profile?.calorie_target ?? 1900} kcal, ${profile?.protein_target_g ?? 120}g Protein, ${profile?.carb_target_g ?? 210}g Carbs, ${profile?.fat_target_g ?? 60}g Fat, ${profile?.water_target_ml ?? 2850}ml Water.
- Today's Live Logged Stats:
  * Calories: ${todayTotals.values.calories_kcal} / ${profile?.calorie_target ?? 1900} kcal
  * Protein: ${todayTotals.values.protein_g} / ${profile?.protein_target_g ?? 120} g
  * Carbs: ${todayTotals.values.carbs_g} / ${profile?.carb_target_g ?? 210} g
  * Fat: ${todayTotals.values.fat_g} / ${profile?.fat_target_g ?? 60} g
  * Water: ${todayWater} / ${profile?.water_target_ml ?? 2850} ml

Style & Instructions:
- Direct, friendly, knowledgeable about Indian diet, college canteen choices, mess food, and realistic meal choices.
- Keep answers concise and actionable (under 3-4 short paragraphs or bullet points).
- Suggest practical high-protein snacks (roasted chana, boiled eggs, curd, soya chunks) when needed.
- Activity is separate from food allowance; do not encourage crash dieting or skipping meals.`;

    const chatHistory = Array.isArray(history) ? history.slice(-6) : [];
    const messages = [
      { role: "system", content: coachSystemPrompt },
      ...chatHistory,
      { role: "user", content: message },
    ];

    if (d.provider.chat) {
      const reply = await d.provider.chat(messages);
      res.json({ reply });
    } else {
      res.json({ reply: `Hi ${profile?.display_name ?? "Gagan"}! You've logged ${todayTotals.values.calories_kcal} kcal and ${todayTotals.values.protein_g}g protein today. Keep aiming for your 120g protein target!` });
    }
  }));

  // ---- Food entries ----
  api.post("/food-entries", wrap(async (req, res) => {
    const b = EntryInput.parse(req.body);
    const userId = uid(res);
    if (b.client_request_id) {
      const dup = (await d.store.getEntries(userId)).find((e) => e.client_request_id === b.client_request_id);
      if (dup) return res.status(200).json(dup); // retry of a request that already succeeded
    }
    const eaten = b.eaten_at ?? now();
    const { eaten_at: _omit, client_request_id, ...rest } = b;
    const entry: FoodEntry = {
      ...rest, id: randomUUID(), user_id: userId, client_request_id: client_request_id ?? null,
      eaten_at: eaten, local_date: localDate(new Date(eaten), tzOf(req)), created_at: now(), updated_at: now(),
    };
    await d.store.addEntry(entry);
    res.status(201).json(entry);
  }));

  api.get("/food-entries", wrap(async (req, res) => {
    const userId = uid(res);
    const date = req.query.date ? DateStr.parse(req.query.date) : undefined;
    const list = await d.store.getEntries(userId, date);
    res.json(list);
  }));

  api.patch("/food-entries/:id", wrap(async (req, res) => {
    const patch = EntryPatch.parse(req.body);
    const userId = uid(res);
    const e = await d.store.getEntry(req.params.id, userId);
    if (!e) throw new AppError(404, "not_found", "Entry not found.");
    // Changing only the quantity scales every known nutrient proportionally; unknown stays unknown.
    const quantityOnly = patch.quantity !== undefined && !NUTRIENT_KEYS.some((k) => patch[k] !== undefined);
    const next: FoodEntry = quantityOnly ? scaleItem(e, patch.quantity as number) : { ...e };
    Object.assign(next, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (patch.eaten_at) next.local_date = localDate(new Date(patch.eaten_at), tzOf(req));
    next.updated_at = now();
    await d.store.updateEntry(next);
    res.json(next);
  }));

  api.delete("/food-entries/:id", wrap(async (req, res) => {
    const userId = uid(res);
    const ok = await d.store.deleteEntry(req.params.id, userId);
    if (!ok) throw new AppError(404, "not_found", "Entry not found.");
    res.status(204).end();
  }));

  // ---- Summaries (always recomputed from saved entries) ----
  api.get("/nutrition/daily-summary", wrap(async (req, res) => {
    const date = DateStr.parse(req.query.date);
    const userId = uid(res);
    const entries = await d.store.getEntries(userId, date);
    const totals = sumNutrients(entries);
    const byMeal = Object.fromEntries(MEALS.map((m) => [m, sumNutrients(entries.filter((e) => e.meal_type === m)).values.calories_kcal]));
    const water = await d.store.getWater(userId, date);
    res.json({ date, entry_count: entries.length, totals: totals.values, unknown_items: totals.unknownItems,
      calories_by_meal: byMeal, water_ml: water.reduce((a, w) => a + w.amount_ml, 0) });
  }));

  api.get("/nutrition/history", wrap(async (req, res) => {
    const from = DateStr.parse(req.query.from), to = DateStr.parse(req.query.to);
    const userId = uid(res);
    const allEntries = await d.store.getEntries(userId);
    const allWater = await d.store.getWater(userId);
    const days: unknown[] = [];
    for (let t = new Date(from + "T00:00:00Z"); t <= new Date(to + "T00:00:00Z") && days.length < 366; t.setUTCDate(t.getUTCDate() + 1)) {
      const date = t.toISOString().slice(0, 10);
      const entries = allEntries.filter((e) => e.local_date === date);
      const water = allWater.filter((w) => w.local_date === date);
      // tracked:false means "nothing logged", which is not the same as eating 0 kcal.
      days.push({ date, tracked: entries.length > 0, totals: entries.length ? sumNutrients(entries).values : null,
        water_ml: water.length ? water.reduce((a, w) => a + w.amount_ml, 0) : null });
    }
    res.json(days);
  }));

  // ---- Saved foods ----
  api.get("/saved-foods", wrap((_req, res) => res.json(d.store.data.saved.filter((s) => s.user_id === uid(res)))));
  api.post("/saved-foods", wrap((req, res) => {
    const s: SavedFood = { ...SavedFoodInput.parse(req.body), id: randomUUID(), user_id: uid(res), created_at: now() };
    d.store.data.saved.push(s);
    d.store.save();
    res.status(201).json(s);
  }));

  // ---- Water ----
  api.get("/water", wrap(async (req, res) => {
    const date = DateStr.parse(req.query.date);
    const userId = uid(res);
    const entries = await d.store.getWater(userId, date);
    res.json({ date, total_ml: entries.reduce((a, w) => a + w.amount_ml, 0), entries });
  }));
  api.post("/water", wrap(async (req, res) => {
    const b = WaterInput.parse(req.body);
    const userId = uid(res);
    if (b.client_request_id) {
      const dup = (await d.store.getWater(userId)).find((w) => w.client_request_id === b.client_request_id);
      if (dup) return res.status(200).json(dup);
    }
    const at = b.drunk_at ?? now();
    const w: WaterEntry = { id: randomUUID(), user_id: userId, client_request_id: b.client_request_id ?? null,
      amount_ml: b.amount_ml, drunk_at: at, local_date: localDate(new Date(at), tzOf(req)), created_at: now() };
    await d.store.addWater(w);
    res.status(201).json(w);
  }));
  api.patch("/water/:id", wrap(async (req, res) => {
    const userId = uid(res);
    const amount_ml = WaterPatch.parse(req.body).amount_ml;
    const w = await d.store.updateWater(req.params.id, userId, amount_ml);
    if (!w) throw new AppError(404, "not_found", "Water entry not found.");
    res.json(w);
  }));
  api.delete("/water/:id", wrap(async (req, res) => {
    const userId = uid(res);
    const ok = await d.store.deleteWater(req.params.id, userId);
    if (!ok) throw new AppError(404, "not_found", "Water entry not found.");
    res.status(204).end();
  }));

  // ---- User Profile ----
  api.get("/profile", wrap(async (_req, res) => {
    const profile = await d.store.getProfile(uid(res));
    res.json(profile);
  }));

  api.patch("/profile", wrap(async (req, res) => {
    const updated = await d.store.updateProfile(uid(res), req.body);
    res.json(updated);
  }));

  // ---- Weight Tracking ----
  api.get("/weight", wrap((_req, res) => {
    const weights = d.store.data.weights.filter((w) => w.user_id === uid(res));
    res.json(weights);
  }));

  api.post("/weight", wrap(async (req, res) => {
    const { weight_kg, waist_cm, logged_date, notes } = req.body;
    if (!weight_kg || Number(weight_kg) <= 0) throw new AppError(400, "invalid_weight", "Weight must be greater than 0");
    const entry = await d.store.addWeight(uid(res), Number(weight_kg), waist_cm ? Number(waist_cm) : null, logged_date, notes);
    res.status(201).json(entry);
  }));

  // ---- Activity Tracking ----
  api.get("/activity", wrap((_req, res) => {
    const activities = d.store.data.activities.filter((a) => a.user_id === uid(res));
    res.json(activities);
  }));

  api.post("/activity", wrap(async (req, res) => {
    const { activity_type, duration_mins, steps, calories_burned, logged_date, notes } = req.body;
    if (!activity_type || !duration_mins) throw new AppError(400, "invalid_activity", "Activity type and duration required");
    const entry = await d.store.addActivity(
      uid(res), String(activity_type), Number(duration_mins),
      steps ? Number(steps) : null,
      calories_burned ? Number(calories_burned) : null,
      logged_date, notes
    );
    res.status(201).json(entry);
  }));

  app.use("/api", api);
  app.use(api);
  app.use(["/api", "/api/*"], (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Unknown endpoint." } }));

  if (d.staticDir) {
    app.use(express.static(d.staticDir));
    app.get("*", (_req, res, next) => {
      res.sendFile("index.html", { root: d.staticDir }, (err) => {
        if (err) next();
      });
    });
  }

  // ---- One consistent error shape ----
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
    if (err instanceof ZodError) return send(400, "validation_error", "Some fields are invalid.", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    if (err instanceof AppError) return send(err.status, err.code, err.message);
    if (err instanceof GrokError) {
      const status = { rate_limited: 429, timeout: 504, model_unavailable: 503, not_configured: 503 }[err.code as string] ?? 502;
      return send(status, err.code, err.message);
    }
    const e = err as { status?: number; type?: string };
    if (e.type === "entity.parse.failed") return send(400, "bad_json", "Request body is not valid JSON.");
    if (e.type === "entity.too.large") return send(413, "too_large", "Request is too large.");
    console.error("[error]", (err as Error)?.message ?? "unknown"); // message only, never payloads
    return send(500, "internal", "Something went wrong. Please try again.");
  });

  return app;
}
