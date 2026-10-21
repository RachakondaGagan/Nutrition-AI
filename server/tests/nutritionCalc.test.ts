import { describe, expect, it } from "vitest";
import { AnalysisSchema, NutritionItemSchema } from "../src/schemas/nutrition.js";
import { energyCheck, scaleItem, sumNutrients } from "../src/services/nutritionCalc.js";

const base = { calories_kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 4, saturated_fat_g: null, sugar_g: null, fiber_g: null, sodium_mg: null };
const item = { ...base, name: "x", quantity: 100, unit: "g", weight_g: 100, preparation: null, confidence: 0.5, assumptions: [] };

describe("sumNutrients", () => {
  it("sums known values and counts unknown ones instead of treating them as zero", () => {
    const t = sumNutrients([base, { ...base, calories_kcal: null }]);
    expect(t.values.calories_kcal).toBe(100);
    expect(t.unknownItems.calories_kcal).toBe(1);
    expect(t.unknownItems.sodium_mg).toBe(2);
  });
});
describe("scaleItem", () => {
  it("scales 100 g to 150 g proportionally and keeps unknown as null", () => {
    const s = scaleItem(item, 150);
    expect(s.calories_kcal).toBe(150);
    expect(s.weight_g).toBe(150);
    expect(s.sodium_mg).toBeNull();
  });
  it("rejects non-positive quantities", () => expect(() => scaleItem(item, 0)).toThrow(RangeError));
});
describe("energyCheck", () => {
  it("passes consistent macros, flags inconsistent ones, skips unknowns", () => {
    expect(energyCheck({ ...base, calories_kcal: 96 })?.ok).toBe(true);
    expect(energyCheck({ ...base, calories_kcal: 900 })?.ok).toBe(false);
    expect(energyCheck({ ...base, fat_g: null })).toBeNull();
  });
});
describe("schema validation", () => {
  it("rejects negative values and unexpected fields", () => {
    expect(NutritionItemSchema.safeParse({ ...item, calories_kcal: -1 }).success).toBe(false);
    expect(NutritionItemSchema.safeParse({ ...item, extra: 1 }).success).toBe(false);
    expect(NutritionItemSchema.safeParse(item).success).toBe(true);
  });
  it("requires items to be empty when no food is detected", () => {
    expect(AnalysisSchema.safeParse({ food_detected: false, items: [item], notes: null }).success).toBe(false);
  });
});
