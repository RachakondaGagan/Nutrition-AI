import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server/dist/app.js";
import { cleanEnv, loadEnv } from "./server/dist/lib/env.js";
import { authFromEnv } from "./server/dist/middleware/auth.js";
import { createProvider } from "./server/dist/services/provider.js";
import { Store } from "./server/dist/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const raw = cleanEnv(process.env);
const env = loadEnv(raw);
const provider = createProvider(raw);
const store = new Store(undefined, env.DATABASE_URL);

const app = createApp({
  provider,
  store,
  authenticate: authFromEnv(env),
  corsOrigin: env.CLIENT_ORIGIN || "*",
  staticDir: path.join(__dirname, "public"),
});

export default app;
