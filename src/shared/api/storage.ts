// Product photos and vendor branding are stored as a path inside the public "assets"
// bucket. The path is the same on every project; the address is not, so it is built here.
const supabaseUrl: string =
  import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";

export function publicAssetUrl(path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/assets/${path}`;
}
