import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { json } from "../_shared/http.ts";
import { orderEmailFromEnvironment } from "../_shared/order-email.ts";
import { handleSendOrderEmail } from "./handler.ts";

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

const deps = {
  async getUserId(accessToken: string) {
    const { data, error } = await admin.auth.getUser(accessToken);
    return error ? null : data.user.id;
  },
  sender: orderEmailFromEnvironment((name) => Deno.env.get(name), rpc),
};

Deno.serve(async (request) => {
  try {
    return await handleSendOrderEmail(request, deps);
  } catch (error) {
    console.error(JSON.stringify({
      event: "send_order_email_failed",
      message: String(error),
    }));
    return json(500, { ok: false, reason: "email_failed" });
  }
});
