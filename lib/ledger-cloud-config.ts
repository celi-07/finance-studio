export type CloudConfig = { url: string; key: string };

function isPublicKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return false;
  try {
    const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role === "anon";
  } catch {
    return false;
  }
}

export function readCloudConfig(rawUrl?: string, rawKey?: string): CloudConfig | null {
  const url = rawUrl?.trim() ?? "";
  const key = rawKey?.trim() ?? "";
  if (!url && !key) return null;

  const project = URL.parse(url);
  const local = project && ["localhost", "127.0.0.1", "[::1]"].includes(project.hostname);
  if (!project || (project.protocol !== "https:" && !(local && project.protocol === "http:")) ||
    project.username || project.password || project.search || project.hash || !isPublicKey(key)) {
    throw Error("Check the Supabase project URL and publishable key in Ledger’s hosting settings.");
  }
  return { url, key };
}

export function configuredCloud(env: Pick<Cloudflare.Env, "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY">) {
  if (env.SUPABASE_URL?.trim() || env.SUPABASE_PUBLISHABLE_KEY?.trim()) {
    return readCloudConfig(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);
  }
  return readCloudConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
