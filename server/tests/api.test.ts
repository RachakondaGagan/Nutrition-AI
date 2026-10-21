import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AppError } from "../src/lib/errors.js";
import { mockProvider } from "../src/services/mockProvider.js";
import { Store } from "../src/store.js";

const TZ = "Asia/Kolkata";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
let server: Server, base = "";

beforeAll(async () => {
  const app = createApp({
    provider: mockProvider, store: new Store(),
    authenticate: async (req) => { const u = req.header("x-test-user"); if (!u) throw new AppError(401, "unauthorized", "no"); return u; },
  });
  await new Promise<void>((r) => { server = app.listen(0, r); });
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const call = (path: string, o: { method?: string; user?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  fetch(base + path, { method: o.method ?? "GET", body: o.body === undefined ? undefined : JSON.stringify(o.body),
    headers: { "content-type": "application/json", "x-test-user": o.user ?? "alice", "x-timezone": TZ, ...o.headers } });

const egg = { name: "Egg, boiled", quantity: 2, unit: "piece", meal_type: "breakfast", calories_kcal: 156, protein_g: 12.6, carbs_g: 1.2, fat_g: 10.6, source: "ai_text" };

describe("API", () => {
  it("rejects unauthenticated requests", async () => {
    const r = await fetch(`${base}/api/water?date=${today}`);
    expect(r.status).toBe(401);
  });

  it("analyze-text returns an editable estimate that needs confirmation and saves nothing", async () => {
    const r = await call("/api/nutrition/analyze-text", { method: "POST", body: { description: "2 boiled eggs and 2 slices of brown bread" } });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.needs_confirmation).toBe(true);
    expect(j.analysis.items).toHaveLength(2);
    expect(j.totals.values.calories_kcal).toBe(316);
    const list = await (await call(`/api/food-entries?date=${today}`, { user: "carol" })).json();
    expect(list).toHaveLength(0);
  });

  it("returns food_detected=false instead of inventing values", async () => {
    const j = await (await call("/api/nutrition/analyze-text", { method: "POST", body: { description: "xyzzy plugh" } })).json();
    expect(j.analysis.food_detected).toBe(false);
    expect(j.analysis.items).toEqual([]);
  });

  it("creates, summarizes, scales and deletes entries; totals always match saved data", async () => {
    const created = await (await call("/api/food-entries", { method: "POST", body: egg })).json();
    let s = await (await call(`/api/nutrition/daily-summary?date=${today}`)).json();
    expect(s.totals.calories_kcal).toBe(156);
    expect(s.unknown_items.sodium_mg).toBe(1); // unknown is counted, not zero-filled silently

    const patched = await (await call(`/api/food-entries/${created.id}`, { method: "PATCH", body: { quantity: 3 } })).json();
    expect(patched.calories_kcal).toBe(234);
    s = await (await call(`/api/nutrition/daily-summary?date=${today}`)).json();
    expect(s.totals.calories_kcal).toBe(234);

    expect((await call(`/api/food-entries/${created.id}`, { method: "DELETE" })).status).toBe(204);
    s = await (await call(`/api/nutrition/daily-summary?date=${today}`)).json();
    expect(s.totals.calories_kcal).toBe(0);
    expect(s.entry_count).toBe(0);
  });

  it("is idempotent when the same client_request_id is retried", async () => {
    const body = { ...egg, client_request_id: "6f1b2a9e-0c5d-4e0a-8a43-3b1d5f6c7a10" };
    await call("/api/food-entries", { method: "POST", body, user: "dave" });
    await call("/api/food-entries", { method: "POST", body, user: "dave" });
    const list = await (await call(`/api/food-entries?date=${today}`, { user: "dave" })).json();
    expect(list).toHaveLength(1);
  });

  it("keeps users' data separate", async () => {
    const e = await (await call("/api/food-entries", { method: "POST", body: egg, user: "erin" })).json();
    const other = await (await call(`/api/food-entries?date=${today}`, { user: "frank" })).json();
    expect(other).toHaveLength(0);
    expect((await call(`/api/food-entries/${e.id}`, { method: "PATCH", body: { quantity: 9 }, user: "frank" })).status).toBe(404);
    expect((await call(`/api/food-entries/${e.id}`, { method: "DELETE", user: "frank" })).status).toBe(404);
  });

  it("rejects invalid input", async () => {
    expect((await call("/api/food-entries", { method: "POST", body: { ...egg, quantity: -1 } })).status).toBe(400);
    expect((await call("/api/food-entries", { method: "POST", body: { ...egg, user_id: "attacker" } })).status).toBe(400);
    expect((await call("/api/food-entries", { method: "POST", body: { ...egg, unit: "furlong" } })).status).toBe(400);
  });

  it("tracks water totals and supports delete", async () => {
    const a = await (await call("/api/water", { method: "POST", user: "gina", body: { amount_ml: 250 } })).json();
    await call("/api/water", { method: "POST", user: "gina", body: { amount_ml: 500 } });
    let w = await (await call(`/api/water?date=${today}`, { user: "gina" })).json();
    expect(w.total_ml).toBe(750);
    await call(`/api/water/${a.id}`, { method: "DELETE", user: "gina" });
    w = await (await call(`/api/water?date=${today}`, { user: "gina" })).json();
    expect(w.total_ml).toBe(500);
  });

  it("history marks days without entries as untracked, not zero", async () => {
    await call("/api/food-entries", { method: "POST", body: egg, user: "hank" });
    const days = await (await call(`/api/nutrition/history?from=2020-01-01&to=2020-01-02`, { user: "hank" })).json();
    expect(days[0]).toMatchObject({ tracked: false, totals: null, water_ml: null });
  });

  it("rejects non-image uploads on analyze-image", async () => {
    const r = await fetch(`${base}/api/nutrition/analyze-image`, { method: "POST", body: "hello", headers: { "content-type": "text/plain", "x-test-user": "alice" } });
    expect(r.status).toBe(415);
  });
});
