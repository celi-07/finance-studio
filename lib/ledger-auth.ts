// The client uses these claims to choose a screen. Database policies enforce them on signed tokens.
export function readVerificationClaims(accessToken: string) {
  try {
    const segment = accessToken.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!segment) return null;
    const bytes = Uint8Array.from(atob(segment), char => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof claims?.session_id !== "string") return null;
    const email = typeof claims.email === "string" ? claims.email : "";
    const verified = !!email && !claims.phone && Array.isArray(claims.amr) &&
      claims.amr.some((item: unknown) => !!item && typeof item === "object" && "method" in item && item.method === "otp");
    return { id: claims.session_id, email, verified };
  } catch {
    return null;
  }
}
