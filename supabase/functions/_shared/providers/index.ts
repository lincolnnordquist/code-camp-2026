import { createSquareProvider } from "./square.ts";
import type { PaymentProvider } from "./types.ts";

export function providerFromEnvironment(
  readEnv: (name: string) => string | undefined,
): PaymentProvider {
  const environment = readEnv("SQUARE_ENVIRONMENT");
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("SQUARE_ENVIRONMENT must be sandbox or production");
  }
  return createSquareProvider(environment);
}
