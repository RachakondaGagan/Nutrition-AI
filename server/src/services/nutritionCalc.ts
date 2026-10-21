import { NUTRIENT_KEYS, type NutrientKey } from "../schemas/nutrition.js";

type NutrientFields = Record<NutrientKey, number | null>;

export interface Totals {
  values: Record<NutrientKey, number>;
  /** How many items had an unknown (null) value for each nutrient. Show this in the UI. */
  unknownItems: Record<NutrientKey, number>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sum confirmed items. Unknown (null) values are skipped and counted, never treated as 0. */
export function sumNutrients(items: NutrientFields[]): Totals {
  const values = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;
  const unknownItems = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;
  for (const item of items) {
    for (const k of NUTRIENT_KEYS) {
      const v = item[k];
      if (v === null) unknownItems[k] += 1;
      else values[k] += v;
    }
  }
  for (const k of NUTRIENT_KEYS) values[k] = round1(values[k]);
  return { values, unknownItems };
}

/**
 * Change an item's quantity and scale nutrients proportionally.
 * Unknown values stay unknown. Only valid within the same unit (100 g -> 150 g).
 * Changing unit (g -> cup) is NOT a scale; it needs a new estimate.
 */
export function scaleItem<T extends NutrientFields & { quantity: number; weight_g: number | null }>(
  item: T,
  newQuantity: number,
): T {
  if (!(item.quantity > 0) || !(newQuantity > 0)) throw new RangeError("Quantities must be positive");
  const f = newQuantity / item.quantity;
  const out = { ...item, quantity: newQuantity, weight_g: item.weight_g === null ? null : round1(item.weight_g * f) };
  for (const k of NUTRIENT_KEYS) out[k] = item[k] === null ? null : round1((item[k] as number) * f);
  return out;
}

/**
 * Cheap hallucination check: kcal should roughly equal 4*protein + 4*carbs + 9*fat.
 * Fibre and alcohol make exact equality unrealistic, so we allow 25% drift.
 * Returns null when it cannot be checked (any macro unknown).
 */
export function energyCheck(i: NutrientFields): { ok: boolean; expectedKcal: number } | null {
  const { calories_kcal: k, protein_g: p, carbs_g: c, fat_g: f } = i;
  if (k === null || p === null || c === null || f === null) return null;
  const expected = 4 * p + 4 * c + 9 * f;
  const drift = Math.abs(k - expected) / Math.max(expected, 1);
  return { ok: drift <= 0.25 || Math.abs(k - expected) <= 15, expectedKcal: round1(expected) };
}
