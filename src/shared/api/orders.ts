// Reads of orders under the access rules: an attendee sees their own, staff see their
// booth's. Both come from the order_details view plus the order's items.
import type { Order } from "../types";
import { supabase } from "./client";
import { check } from "./errors";
import { orderFromRow, type ItemRow, type OrderRow } from "./mappers";

const ORDER_COLUMNS =
  "id, booth_id, event_id, booth_code, booth_name, type, status, total_cents, currency, pickup_code, hold_ends_at, created_at, collected_at, cancel_reason, refund_status";

async function withItems(rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const items = check(
    await supabase
      .from("order_items")
      .select("order_id, product_id, name, quantity, unit_price_cents")
      .in(
        "order_id",
        rows.map((row) => row.id),
      )
      .returns<ItemRow[]>(),
  );
  return rows.map((row) => orderFromRow(row, items));
}

export async function readOrders(
  filter: { boothId: string } | { orderId: string } | "mine",
): Promise<Order[]> {
  let query = supabase.from("order_details").select(ORDER_COLUMNS);
  if (filter !== "mine") {
    query =
      "boothId" in filter
        ? query.eq("booth_id", filter.boothId)
        : query.eq("id", filter.orderId);
  }
  const rows = check(
    await query.order("created_at", { ascending: false }).returns<OrderRow[]>(),
  );
  return withItems(rows);
}
