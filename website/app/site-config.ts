const DEFAULT_SITE_URL = "https://teamcopilot.ai";

export function getSiteUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;

  return siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
}
