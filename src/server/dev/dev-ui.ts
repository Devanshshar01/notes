/**
 * Local development UI access mode.
 *
 * This module ONLY affects behavior when:
 *   - `process.env.NODE_ENV !== "production"`
 *   - `process.env.NOTES_DEV_UI` is truthy ("true" / "1")
 *
 * In that case it lets the existing Notes UI render locally without requiring
 * the future central Couple Space authentication app. It does NOT:
 *   - bypass server-side note authorization in production
 *   - touch the database when disabled
 *   - fabricate persistent data
 *   - accept arbitrary userId / spaceId from the client
 *
 * In production, every helper here returns `false` / no-op, so the
 * Step 2 server-side authorization path is fully preserved.
 */

export const DEV_UI_USER_ID = "dev-ui";
export const DEV_UI_SPACE_ID = "dev-ui";

export function isDevUiMode(): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  const flag = process.env["NOTES_DEV_UI"];
  if (!flag) return false;
  return flag === "true" || flag === "1";
}

export function isDevUiSpace(spaceId: string): boolean {
  return isDevUiMode() && spaceId === DEV_UI_SPACE_ID;
}
