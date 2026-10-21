import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import type { NutrientKey } from "./schemas/nutrition.js";

export type NutrientFields = Record<NutrientKey, number | null>;
export type FoodEntry = NutrientFields & {
  id: string; user_id: string; client_request_id: string | null;
  name: string; quantity: number; unit: string; weight_g: number | null;
  meal_type: string; eaten_at: string; local_date: string;
  source: string; confidence: number | null; preparation: string | null; assumptions: string[];
  created_at: string; updated_at: string;
};
export type WaterEntry = {
  id: string; user_id: string; client_request_id: string | null;
  amount_ml: number; drunk_at: string; local_date: string; created_at: string;
};
export type SavedFood = NutrientFields & {
  id: string; user_id: string; name: string; quantity: number; unit: string; created_at: string;
};
export type WeightEntry = {
  id: string; user_id: string; weight_kg: number; waist_cm: number | null;
  logged_date: string; notes: string | null; created_at: string;
};
export type ActivityEntry = {
  id: string; user_id: string; activity_type: string; duration_mins: number;
  steps: number | null; calories_burned: number | null; logged_date: string;
  notes: string | null; created_at: string;
};
export type UserProfile = {
  id: string; display_name: string; age?: number; height_cm: number;
  weight_kg: number; target_weight_kg: number; activity_level: string;
  diet: string; calorie_target: number; protein_target_g: number;
  carb_target_g: number; fat_target_g: number; water_target_ml: number;
  units: string; theme: string; timezone: string;
};

interface Data {
  entries: FoodEntry[];
  water: WaterEntry[];
  saved: SavedFood[];
  weights: WeightEntry[];
  activities: ActivityEntry[];
}

/** Store with dual-mode: in-memory / local JSON and Supabase PostgreSQL persistence */
export class Store {
  data: Data = { entries: [], water: [], saved: [], weights: [], activities: [] };
  pool?: pg.Pool;

  constructor(private file?: string, databaseUrl?: string) {
    if (file && fs.existsSync(file)) {
      try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
      catch { console.warn("[store] could not read data file; starting empty"); }
    }
    if (databaseUrl) {
      this.pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
      this.initDb();
    }
  }

  private async initDb(): Promise<void> {
    if (!this.pool) return;
    try {
      const [feRes, wRes, sRes, wtRes, actRes] = await Promise.all([
        this.pool.query("SELECT * FROM public.food_entries ORDER BY eaten_at ASC"),
        this.pool.query("SELECT * FROM public.water_entries ORDER BY drunk_at ASC"),
        this.pool.query("SELECT * FROM public.saved_foods ORDER BY created_at ASC"),
        this.pool.query("SELECT * FROM public.weight_entries ORDER BY logged_date DESC"),
        this.pool.query("SELECT * FROM public.activity_entries ORDER BY logged_date DESC"),
      ]);

      const dbEntries: FoodEntry[] = feRes.rows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        client_request_id: r.client_request_id,
        name: r.name,
        quantity: Number(r.quantity),
        unit: r.unit,
        weight_g: r.weight_g != null ? Number(r.weight_g) : null,
        meal_type: r.meal_type,
        eaten_at: new Date(r.eaten_at).toISOString(),
        local_date: r.local_date instanceof Date ? r.local_date.toISOString().slice(0, 10) : String(r.local_date),
        calories_kcal: r.calories_kcal != null ? Number(r.calories_kcal) : null,
        protein_g: r.protein_g != null ? Number(r.protein_g) : null,
        carbs_g: r.carbs_g != null ? Number(r.carbs_g) : null,
        fat_g: r.fat_g != null ? Number(r.fat_g) : null,
        saturated_fat_g: r.saturated_fat_g != null ? Number(r.saturated_fat_g) : null,
        sugar_g: r.sugar_g != null ? Number(r.sugar_g) : null,
        fiber_g: r.fiber_g != null ? Number(r.fiber_g) : null,
        sodium_mg: r.sodium_mg != null ? Number(r.sodium_mg) : null,
        source: r.source,
        confidence: r.confidence != null ? Number(r.confidence) : null,
        preparation: r.preparation,
        assumptions: Array.isArray(r.assumptions) ? r.assumptions : [],
        created_at: new Date(r.created_at).toISOString(),
        updated_at: new Date(r.updated_at).toISOString(),
      }));

      const dbWater: WaterEntry[] = wRes.rows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        client_request_id: r.client_request_id,
        amount_ml: Number(r.amount_ml),
        drunk_at: new Date(r.drunk_at).toISOString(),
        local_date: r.local_date instanceof Date ? r.local_date.toISOString().slice(0, 10) : String(r.local_date),
        created_at: new Date(r.created_at).toISOString(),
      }));

      const dbWeights: WeightEntry[] = wtRes.rows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        weight_kg: Number(r.weight_kg),
        waist_cm: r.waist_cm != null ? Number(r.waist_cm) : null,
        logged_date: r.logged_date instanceof Date ? r.logged_date.toISOString().slice(0, 10) : String(r.logged_date),
        notes: r.notes,
        created_at: new Date(r.created_at).toISOString(),
      }));

      const dbActivities: ActivityEntry[] = actRes.rows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        activity_type: r.activity_type,
        duration_mins: Number(r.duration_mins),
        steps: r.steps != null ? Number(r.steps) : null,
        calories_burned: r.calories_burned != null ? Number(r.calories_burned) : null,
        logged_date: r.logged_date instanceof Date ? r.logged_date.toISOString().slice(0, 10) : String(r.logged_date),
        notes: r.notes,
        created_at: new Date(r.created_at).toISOString(),
      }));

      const entryIds = new Set(this.data.entries.map((e) => e.id));
      for (const e of dbEntries) {
        if (!entryIds.has(e.id)) { this.data.entries.push(e); entryIds.add(e.id); }
      }
      const waterIds = new Set(this.data.water.map((w) => w.id));
      for (const w of dbWater) {
        if (!waterIds.has(w.id)) { this.data.water.push(w); waterIds.add(w.id); }
      }
      this.data.weights = dbWeights;
      this.data.activities = dbActivities;

      console.log(`[supabase] Loaded ${dbEntries.length} food entries, ${dbWater.length} water entries, ${dbWeights.length} weight logs from PostgreSQL.`);
    } catch (err) {
      console.warn("[supabase] Failed to load data from postgres:", (err as Error).message);
    }
  }

  save(): void {
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
      } catch {}
    }
    if (this.pool) {
      this.syncDb().catch((e) => console.warn("[supabase] Sync failed:", e.message));
    }
  }

  private async syncDb(): Promise<void> {
    if (!this.pool) return;
    for (const e of this.data.entries) {
      await this.pool.query(`
        INSERT INTO public.food_entries (
          id, user_id, client_request_id, name, quantity, unit, weight_g,
          meal_type, eaten_at, local_date, calories_kcal, protein_g, carbs_g,
          fat_g, saturated_fat_g, sugar_g, fiber_g, sodium_mg, source,
          confidence, preparation, assumptions, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
        ) ON CONFLICT (id) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          meal_type = EXCLUDED.meal_type,
          calories_kcal = EXCLUDED.calories_kcal,
          protein_g = EXCLUDED.protein_g,
          carbs_g = EXCLUDED.carbs_g,
          fat_g = EXCLUDED.fat_g,
          updated_at = EXCLUDED.updated_at
      `, [
        e.id, e.user_id, e.client_request_id, e.name, e.quantity, e.unit, e.weight_g,
        e.meal_type, e.eaten_at, e.local_date, e.calories_kcal, e.protein_g, e.carbs_g,
        e.fat_g, e.saturated_fat_g, e.sugar_g, e.fiber_g, e.sodium_mg, e.source,
        e.confidence, e.preparation, e.assumptions, e.created_at, e.updated_at
      ]).catch((err) => console.warn(`[supabase] entry insert error:`, err.message));
    }
    for (const w of this.data.water) {
      await this.pool.query(`
        INSERT INTO public.water_entries (
          id, user_id, client_request_id, amount_ml, drunk_at, local_date, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET amount_ml = EXCLUDED.amount_ml
      `, [w.id, w.user_id, w.client_request_id, w.amount_ml, w.drunk_at, w.local_date, w.created_at])
      .catch((err) => console.warn(`[supabase] water insert error:`, err.message));
    }
  }

  async deleteEntryDb(id: string): Promise<void> {
    if (this.pool) {
      await this.pool.query("DELETE FROM public.food_entries WHERE id = $1", [id]).catch(() => {});
    }
  }

  async deleteWaterDb(id: string): Promise<void> {
    if (this.pool) {
      await this.pool.query("DELETE FROM public.water_entries WHERE id = $1", [id]).catch(() => {});
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    if (this.pool) {
      try {
        const res = await this.pool.query("SELECT * FROM public.profiles WHERE id = $1", [userId]);
        if (res.rows[0]) return res.rows[0];
      } catch {}
    }
    // Default Gagan's personalized profile
    return {
      id: userId,
      display_name: "Gagan",
      height_cm: 183,
      weight_kg: 80,
      target_weight_kg: 75,
      activity_level: "moderate",
      diet: "vegetarian_eggs",
      calorie_target: 1900,
      protein_target_g: 120,
      carb_target_g: 210,
      fat_target_g: 60,
      water_target_ml: 2850,
      units: "metric",
      theme: "dark",
      timezone: "Asia/Kolkata",
    };
  }

  async updateProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile> {
    if (this.pool) {
      const keys = Object.keys(patch).filter((k) => k !== "id");
      if (keys.length > 0) {
        const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
        const values = keys.map((k) => (patch as any)[k]);
        await this.pool.query(`UPDATE public.profiles SET ${sets}, updated_at = now() WHERE id = $1`, [userId, ...values]).catch(() => {});
      }
    }
    return (await this.getProfile(userId))!;
  }

  async addWeight(userId: string, weightKg: number, waistCm?: number | null, loggedDate?: string, notes?: string): Promise<WeightEntry> {
    const entry: WeightEntry = {
      id: crypto.randomUUID(),
      user_id: userId,
      weight_kg: weightKg,
      waist_cm: waistCm ?? null,
      logged_date: loggedDate ?? new Date().toISOString().slice(0, 10),
      notes: notes ?? null,
      created_at: new Date().toISOString(),
    };
    this.data.weights.unshift(entry);
    this.save();
    if (this.pool) {
      await this.pool.query(
        "INSERT INTO public.weight_entries (id, user_id, weight_kg, waist_cm, logged_date, notes) VALUES ($1, $2, $3, $4, $5, $6)",
        [entry.id, entry.user_id, entry.weight_kg, entry.waist_cm, entry.logged_date, entry.notes]
      ).catch(() => {});
    }
    return entry;
  }

  async addActivity(userId: string, activityType: string, durationMins: number, steps?: number | null, caloriesBurned?: number | null, loggedDate?: string, notes?: string): Promise<ActivityEntry> {
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      user_id: userId,
      activity_type: activityType,
      duration_mins: durationMins,
      steps: steps ?? null,
      calories_burned: caloriesBurned ?? null,
      logged_date: loggedDate ?? new Date().toISOString().slice(0, 10),
      notes: notes ?? null,
      created_at: new Date().toISOString(),
    };
    this.data.activities.unshift(entry);
    this.save();
    if (this.pool) {
      await this.pool.query(
        "INSERT INTO public.activity_entries (id, user_id, activity_type, duration_mins, steps, calories_burned, logged_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [entry.id, entry.user_id, entry.activity_type, entry.duration_mins, entry.steps, entry.calories_burned, entry.logged_date, entry.notes]
      ).catch(() => {});
    }
    return entry;
  }
}
