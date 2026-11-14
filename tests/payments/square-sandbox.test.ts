import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { createSquareProvider } from "../../supabase/functions/_shared/providers/square";
import type { CreateCheckoutInput } from "../../supabase/functions/_shared/providers/types";

const TOKEN_NAME = "SQUARE_ACCESS_TOKEN_VENDOR_A";
const ENV_FILE = new URL("../../supabase/functions/.env", import.meta.url);
const LOCATION_ID = "LT26AY1A3MCK2";

async function readSandboxToken(): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(ENV_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const line = text.split("\n").find((entry) =>
    entry.startsWith(`${TOKEN_NAME}=`)
  );
  const value = line?.slice(TOKEN_NAME.length + 1).trim().replace(
    /^["']|["']$/g,
    "",
  );
  return value || undefined;
}

const accessToken = await readSandboxToken();
if (!accessToken) {
  console.log(
    `Skipping the Square sandbox tests: ${TOKEN_NAME} is not set in supabase/functions/.env`,
  );
}

test.skipIf(!accessToken)(
  "sandbox: a repeated create returns the same link, the unpaid order has no payment, closing the link cancels that order, and closing it again names no order",
  { timeout: 30_000 },
  async () => {
    const provider = createSquareProvider("sandbox");
    const connection = {
      accessToken: accessToken as string,
      locationId: LOCATION_ID,
    };
    const input: CreateCheckoutInput = {
      connection,
      lineItems: [
        { name: "Sandbox test item", quantity: 2, unitPriceCents: 350 },
      ],
      currency: "USD",
      returnUrl: "http://localhost:5173/orders/sandbox-test",
      // Square refuses buyer@example.com with INVALID_EMAIL_ADDRESS.
      buyerEmail: "sandbox.buyer@squareup.com",
      idempotencyKey: crypto.randomUUID(),
    };

    const checkout = await provider.createCheckout(input);
    try {
      assert.match(checkout.url, /^https:\/\//);
      assert.deepEqual(await provider.createCheckout(input), checkout);
      assert.equal(
        await provider.getPayment(connection, checkout.providerOrderId),
        null,
      );
      assert.equal(
        await provider.getOrderState(connection, checkout.providerOrderId),
        "draft",
      );
    } finally {
      assert.equal(
        await provider.closeCheckout(connection, checkout.checkoutLinkId),
        checkout.providerOrderId,
      );
    }
    assert.equal(
      await provider.closeCheckout(connection, checkout.checkoutLinkId),
      null,
    );
    assert.equal(
      await provider.getOrderState(connection, checkout.providerOrderId),
      "cancelled",
    );
  },
);
