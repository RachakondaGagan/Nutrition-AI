import { createApp } from "../server/dist/app.js";
import { cleanEnv, loadEnv } from "../server/dist/lib/env.js";
import { authFromEnv } from "../server/dist/middleware/auth.js";
import { createProvider } from "../server/dist/services/provider.js";
import { Store } from "../server/dist/store.js";

const raw = cleanEnv(process.env);
const env = loadEnv(raw);
const provider = createProvider(raw);

const store = new Store(undefined, env.DATABASE_URL);

const app = createApp({
  provider,
  store,
  authenticate: authFromEnv(env),
  corsOrigin: env.CLIENT_ORIGIN || "*",
});

export default app;
