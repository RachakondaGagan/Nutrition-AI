import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server/dist/app.js";
import { cleanEnv, loadEnv } from "./server/dist/lib/env.js";
import { authFromEnv } from "./server/dist/middleware/auth.js";
import { createProvider } from "./server/dist/services/provider.js";
import { Store } from "./server/dist/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Clean and parse environment variables (injected by Vercel)
const raw = cleanEnv(process.env);
const env = loadEnv(raw);
const provider = createProvider(raw);

// Initialize Store with Supabase PostgreSQL connection
const store = new Store(undefined, env.DATABASE_URL);

// Create Express app serving both API and static frontend
const app = createApp({
  provider,
  store,
  authenticate: authFromEnv(env),
  corsOrigin: env.CLIENT_ORIGIN || "*",
  staticDir: path.join(__dirname, "public"),
});

export default app;
