declare namespace Cloudflare {
  interface Env {
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    FINANCE_AUTH_MODE?: string;
    GOOGLE_CLIENT_ID?: string;
    GEMINI_API_KEY?: string;
    GEMINI_FALLBACK_API_KEY?: string;
    GEMINI_MODEL?: string;
    GEMINI_FALLBACK_MODEL?: string;
  }
}
