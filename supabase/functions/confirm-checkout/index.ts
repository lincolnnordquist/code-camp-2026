import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { providerFromEnvironment } from "../_shared/providers/index.ts";
import { orderEmailFromEnvironment } from "../_shared/order-email.ts";
import { json } from "../_shared/http.ts";
import { handleConfirmCheckout } from "./handler.ts";

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

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

const readEnv = (name: string) => Deno.env.get(name);

const deps = {
  async getUserId(accessToken: string) {
    const { data, error } = await admin.auth.getUser(accessToken);
    return error ? null : data.user.id;
  },
  rpc,
  provider: providerFromEnvironment(readEnv),
  readSecret: readEnv,
  email: orderEmailFromEnvironment(readEnv, rpc),
  wait: (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
};

Deno.serve(async (request) => {
  try {
    return await handleConfirmCheckout(request, deps);
  } catch (error) {
    console.error(JSON.stringify({
      event: "confirm_checkout_failed",
      message: String(error),
    }));
    return json(500, { ok: false, reason: "server_error" });
  }
});
