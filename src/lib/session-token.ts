/**
 * Live preview keeps the session on a bearer token (partitioned iframe cookies
 * are not visible to later requests). Email sign-in returns that token; the
 * auth client reads it from this same sessionStorage key.
 */
const BEARER_KEY = "grok-auth.bearer-token";

export function rememberSessionToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* storage unavailable */
  }
}
