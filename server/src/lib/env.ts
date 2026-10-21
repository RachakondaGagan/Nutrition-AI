import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(4000),
  CLIENT_ORIGIN: z.string().default("*"),
  DATABASE_URL: z.string().optional(),
  DEFAULT_USER_ID: z.string().default("a0000000-0000-0000-0000-000000000001"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().optional(),
  XAI_TEXT_MODEL: z.string().optional(),
  XAI_VISION_MODEL: z.string().optional(),
  XAI_TIMEOUT_MS: z.coerce.number().optional(),
  DATA_FILE: z.string().default("data/dev-store.json"),
});
export type Env = z.infer<typeof Env>;

/** Treat empty strings (from a copied .env.example) as unset. */
export function cleanEnv(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(src).filter(([, v]) => v !== "")) as NodeJS.ProcessEnv;
}

export function loadEnv(src: NodeJS.ProcessEnv): Env {
  const r = Env.safeParse(src);
  if (!r.success) {
    console.error("Invalid environment:\n" + r.error.issues.map((i) => `- ${i.path.join(".") || "env"}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  return r.data;
}
