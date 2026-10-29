import { previewPathPrefix } from "@/lib/preview-path-prefix";

/** Prefix relative app paths so path-based previews still hit this app. */
export function resolveAppPath(path: string): string {
  if (!path || path.startsWith("blob:") || path.startsWith("data:") || /^https?:\/\//.test(path)) {
    return path;
  }
  if (typeof window === "undefined") return path;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
  if (!prefix || path.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}
