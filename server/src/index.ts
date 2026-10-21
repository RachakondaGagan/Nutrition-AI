import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { cleanEnv, loadEnv } from "./lib/env.js";
import { authFromEnv } from "./middleware/auth.js";
import { createProvider } from "./services/provider.js";
import { Store } from "./store.js";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) }); // repo-root .env
const raw = cleanEnv(process.env);
const env = loadEnv(raw);
const provider = createProvider(raw);

const clientDir = fileURLToPath(new URL("../../client-prototype", import.meta.url));

createApp({
  provider,
  store: new Store(env.DATA_FILE, env.DATABASE_URL),
  authenticate: authFromEnv(env),
  corsOrigin: env.CLIENT_ORIGIN,
  staticDir: clientDir,
}).listen(env.PORT, () => {
  console.log(`NutritionX running at http://localhost:${env.PORT}`);
  console.log(`  AI provider : ${provider.name}`);
  console.log(`  Database    : ${env.DATABASE_URL ? "Supabase PostgreSQL" : "Local JSON file"}`);
  console.log(`  App URL     : http://localhost:${env.PORT}`);
});
