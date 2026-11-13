import type { EventCatalog, Result } from "../types";
import { catalog } from "./sample-store";

export async function getEventCatalog(
  eventSlug: string,
): Promise<Result<EventCatalog, "event_not_found">> {
  if (eventSlug !== catalog.event.slug)
    return { ok: false, reason: "event_not_found" };
  return { ok: true, value: structuredClone(catalog) };
}
