import { z } from "zod";
import { UNITS } from "./nutrition.js";

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const n = () => z.number().min(0).max(20000).nullable().default(null); // null = unknown

export const EntryInput = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(10000),
  unit: z.enum(UNITS),
  weight_g: z.number().positive().max(10000).nullable().default(null),
  meal_type: z.enum(MEALS),
  eaten_at: z.string().datetime().optional(),
  calories_kcal: n(), protein_g: n(), carbs_g: n(), fat_g: n(),
  saturated_fat_g: n(), sugar_g: n(), fiber_g: n(), sodium_mg: n(),
  source: z.enum(["ai_text", "ai_image", "manual", "saved_meal"]).default("manual"),
  confidence: z.number().min(0).max(1).nullable().default(null),
  preparation: z.string().max(120).nullable().default(null),
  assumptions: z.array(z.string().max(300)).max(8).default([]),
  client_request_id: z.string().uuid().optional(),
}).strict();

export const EntryPatch = EntryInput.partial().omit({ client_request_id: true });

export const SavedFoodInput = EntryInput.pick({
  name: true, quantity: true, unit: true, calories_kcal: true, protein_g: true, carbs_g: true,
  fat_g: true, saturated_fat_g: true, sugar_g: true, fiber_g: true, sodium_mg: true,
});

export const AnalyzeText = z.object({
  description: z.string().trim().min(2).max(1000),
  meal_type: z.enum(MEALS).optional(),
}).strict();

export const WaterInput = z.object({
  amount_ml: z.number().int().min(1).max(5000),
  drunk_at: z.string().datetime().optional(),
  client_request_id: z.string().uuid().optional(),
}).strict();
export const WaterPatch = z.object({ amount_ml: z.number().int().min(1).max(5000) }).strict();
