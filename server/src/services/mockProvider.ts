import type { Analysis, NutritionItem, Unit } from "../schemas/nutrition.js";
import type { NutritionProvider } from "./provider.js";

/**
 * LOCAL DEVELOPMENT ONLY. A tiny keyword table with approximate generic values.
 * Not Grok, not a nutrition database. Photos cannot be analyzed in mock mode.
 */
interface Food { re: RegExp; name: string; unit: Unit; per: number; n: [number, number, number, number] }
const FOODS: Food[] = [
  { re: /egg/, name: "Egg, boiled", unit: "piece", per: 1, n: [78, 6.3, 0.6, 5.3] },
  { re: /bread|toast/, name: "Brown bread", unit: "slice", per: 1, n: [80, 4, 14, 1] },
  { re: /banana/, name: "Banana", unit: "piece", per: 1, n: [105, 1.3, 27, 0.4] },
  { re: /milk/, name: "Milk, toned", unit: "ml", per: 100, n: [58, 3.1, 4.7, 3] },
  { re: /rice/, name: "Rice, cooked", unit: "g", per: 100, n: [130, 2.7, 28, 0.3] },
  { re: /dal|lentil/, name: "Dal, cooked", unit: "g", per: 100, n: [116, 7, 20, 0.4] },
];
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, half: 0.5 };
const r1 = (x: number) => Math.round(x * 10) / 10;

function parseSegment(seg: string): NutritionItem | null {
  const food = FOODS.find((f) => f.re.test(seg));
  if (!food) return null;
  const m = seg.match(/(\d+(?:\.\d+)?|\b(?:a|an|one|two|three|four|half)\b)\s*(g|gm|grams?|ml)?\b/);
  const qty = m ? (WORDS[m[1]!] ?? parseFloat(m[1]!)) : 1;
  const weightUnit = m?.[2] ? (m[2] === "ml" ? "ml" : "g") : null;
  const assumptions = ["MOCK ESTIMATE from a small local table, not from Grok."];
  let quantity = qty, unit: Unit = food.unit, factor: number | null;
  if (weightUnit && weightUnit === food.unit) factor = qty / food.per;
  else if (weightUnit) { factor = null; assumptions.push("Weight given for a per-piece food, so nutrients are unknown."); unit = weightUnit; }
  else if (food.per === 100) { factor = (qty * 150) / 100; assumptions.push("Assumed 150 g per serving."); unit = "serving"; }
  else factor = qty;
  const v = (i: number) => (factor === null ? null : r1(food.n[i]! * factor));
  return {
    name: food.name, quantity, unit, weight_g: null, preparation: null,
    calories_kcal: v(0), protein_g: v(1), carbs_g: v(2), fat_g: v(3),
    saturated_fat_g: null, sugar_g: null, fiber_g: null, sodium_mg: null, // unknown, not zero
    confidence: 0.5, assumptions,
  };
}

export const mockProvider: NutritionProvider = {
  name: "mock",
  async analyzeText(description) {
    const items = description.toLowerCase().split(/,|;|\band\b|\bwith\b/).map(parseSegment).filter((i): i is NutritionItem => i !== null);
    const analysis: Analysis = items.length
      ? { food_detected: true, items, notes: "Mock provider: set XAI_API_KEY to use Grok." }
      : { food_detected: false, items: [], notes: "No known foods found. The mock provider only knows eggs, bread, banana, milk, rice and dal." };
    return { analysis, meta: { model: "mock", latencyMs: 0, usage: null } };
  },
  async analyzeImage() {
    const analysis: Analysis = { food_detected: false, items: [], notes: "Photo analysis needs the Grok provider. Set XAI_API_KEY, XAI_TEXT_MODEL and XAI_VISION_MODEL." };
    return { analysis, meta: { model: "mock", latencyMs: 0, usage: null } };
  },
};
