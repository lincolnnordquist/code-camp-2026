import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { providerFromEnvironment } from "../_shared/providers/index.ts";
import { json } from "../_shared/http.ts";
import { handleCreateCheckout } from "./handler.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const admin = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const deps = {
  async getUserId(accessToken: string) {
    const { data, error } = await admin.auth.getUser(accessToken);
    return error ? null : data.user.id;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`${name} failed: ${error.message}`);
    return data;
  },
  provider: providerFromEnvironment((name) => Deno.env.get(name)),
  readSecret: (name: string) => Deno.env.get(name),
  appUrl: requiredEnv("APP_URL"),
};

Deno.serve(async (request) => {
  try {
    return await handleCreateCheckout(request, deps);
  } catch (error) {
    console.error(JSON.stringify({
      event: "create_checkout_failed",
      message: String(error),
    }));
    return json(500, { ok: false, reason: "checkout_unavailable" });
  }
});
