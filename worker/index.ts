import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { configuredCloud } from "../lib/ledger-cloud-config";

function documentPolicy(env: Cloudflare.Env) {
  const random = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...random));
  let projectOrigin = "";
  try {
    const cloud = configuredCloud(env);
    if (cloud) projectOrigin = ` ${new URL(cloud.url).origin}`;
  } catch {
    // Invalid configuration renders the connection screen with same-origin access only.
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${projectOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // All writes go directly to Supabase. This app has no server actions or image optimizer.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const pathname = new URL(request.url).pathname;
    if (/^\/(?:_next|_vinext)\/image\/?$/.test(pathname)) return new Response(null, { status: 404 });

    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    if (import.meta.env.DEV) return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));

    // Vinext uses the request policy to apply the nonce to its hydration scripts.
    const policy = documentPolicy(env);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", policy);
    requestHeaders.delete("Content-Security-Policy-Report-Only");
    const scopedRequest = new Request(request, { headers: requestHeaders });
    const response = await runWithConnectorBinding(binding, () => handler.fetch(scopedRequest, env, ctx));
    if (!response.headers.get("Content-Type")?.startsWith("text/html")) return response;

    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", policy);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set("Cache-Control", "private, no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

export default worker;
