import type { EventCatalog, Result } from "../types";
import { supabase } from "./client";
import { check } from "./errors";
import {
  boothFromRow,
  eventFromRow,
  PRODUCT_COLUMNS,
  productFromRow,
  type BoothRow,
  type EventRow,
  type ProductRow,
} from "./mappers";

// The event with its booths and products, readable by anyone without signing in.
export async function getEventCatalog(
  eventSlug: string,
): Promise<Result<EventCatalog, "event_not_found">> {
  const event = check(
    await supabase
      .from("events")
      .select(
        "id, slug, name, venue_name, currency, floor_plan_url, reservation_hold_minutes",
      )
      .eq("slug", eventSlug)
      .maybeSingle<EventRow>(),
    { allowEmpty: true },
  );
  if (!event) return { ok: false, reason: "event_not_found" };

  const booths = check(
    await supabase
      .from("booths")
      .select(
        "id, code, mode, ordering_paused, map_x, map_y, pickup_instructions, vendors(name, slogan, logo_path, banner_path)",
      )
      .eq("event_id", event.id)
      .order("code")
      .returns<BoothRow[]>(),
  );
  const boothIds = booths.map((booth) => booth.id);
  const products = boothIds.length
    ? check(
        await supabase
          .from("products")
          .select(PRODUCT_COLUMNS)
          .in("booth_id", boothIds)
          .order("name")
          .returns<ProductRow[]>(),
      )
    : [];

  return {
    ok: true,
    value: {
      event: eventFromRow(event),
      booths: booths.map(boothFromRow),
      products: products.map(productFromRow),
    },
  };
}
