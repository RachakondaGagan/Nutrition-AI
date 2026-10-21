import { z } from "zod";

export const UNITS = [
  "g", "kg", "ml", "l", "piece", "slice", "cup", "tbsp", "tsp", "serving", "plate", "bowl",
  "glass", "katori", "portion", "scoop", "bottle", "can", "pack",
] as const;
export type Unit = (typeof UNITS)[number];

export const NUTRIENT_KEYS = [
  "calories_kcal", "protein_g", "carbs_g", "fat_g",
  "saturated_fat_g", "sugar_g", "fiber_g", "sodium_mg",
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

// null means "unknown". It is never coerced to 0 anywhere in the app.
const nutrient = (max: number) => z.number().min(0).max(max).nullable();

export const NutritionItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    quantity: z.number().positive().max(10000),
    unit: z.enum(UNITS),
    weight_g: z.number().positive().max(10000).nullable(),
    preparation: z.string().max(120).nullable(),
    calories_kcal: nutrient(5000),
    protein_g: nutrient(500),
    carbs_g: nutrient(1000),
    fat_g: nutrient(500),
    saturated_fat_g: nutrient(500),
    sugar_g: nutrient(1000),
    fiber_g: nutrient(200),
    sodium_mg: nutrient(20000),
    confidence: z.number().min(0).max(1),
    assumptions: z.array(z.string().max(300)).max(8),
  })
  .strict(); // rejects unexpected fields

export const AnalysisSchema = z
  .object({
    food_detected: z.boolean(),
    items: z.array(NutritionItemSchema).max(30),
    notes: z.string().max(500).nullable(),
  })
  .strict()
  .refine((v) => v.food_detected || v.items.length === 0, {
    message: "items must be empty when food_detected is false",
  });

export type NutritionItem = z.infer<typeof NutritionItemSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * JSON Schema sent to xAI via text.format. Hand-written on purpose so it only uses
 * features xAI documents as supported: nullable via type arrays, additionalProperties:false,
 * every property listed in `required`. Zod still re-validates the reply on our side.
 * Note: the model does NOT return totals. The server sums confirmed items itself.
 */
const num = { type: ["number", "null"], minimum: 0 } as const;

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["food_detected", "items", "notes"],
  properties: {
    food_detected: { type: "boolean" },
    notes: { type: ["string", "null"] },
    items: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name", "quantity", "unit", "weight_g", "preparation",
          ...NUTRIENT_KEYS, "confidence", "assumptions",
        ],
        properties: {
          name: { type: "string" },
          quantity: { type: "number", exclusiveMinimum: 0 },
          unit: { type: "string", enum: [...UNITS] },
          weight_g: num,
          preparation: { type: ["string", "null"] },
          calories_kcal: num,
          protein_g: num,
          carbs_g: num,
          fat_g: num,
          saturated_fat_g: num,
          sugar_g: num,
          fiber_g: num,
          sodium_mg: num,
          confidence: { type: "number", minimum: 0, maximum: 1 },
          assumptions: { type: "array", maxItems: 8, items: { type: "string" } },
        },
      },
    },
  },
} as const;
