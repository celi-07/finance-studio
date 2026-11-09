import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { emptyWorkspace, type Collection, type Workspace } from "./ledger";
import type { CloudConfig } from "./ledger-cloud-config";

let connection: { url: string; key: string; client: SupabaseClient } | undefined;
export function getSupabase({ url, key }: CloudConfig) {
  if (connection?.url === url && connection.key === key) return connection.client;
  const client = createClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
  connection = { url, key, client };
  return client;
}
function writeIssue(error: { code: string; message: string }, fallback: string) {
  if (error.code === "P0001") return Error(error.message);
  if (error.code === "23505") return Error("An entry with these details already exists. Refresh and try again.");
  if (error.code === "23503") return Error("This change conflicts with a linked record.");
  return Error(fallback);
}

export async function loadCloud(supabase: SupabaseClient, userId: string): Promise<Workspace> {
  const collections = Object.keys(emptyWorkspace) as Collection[];
  const records = await Promise.all(collections.map(async collection => {
    const rows: unknown[] = [];
    const size = 500;
    for (let offset = 0; ; offset += size) {
      const { data, error } = await supabase.from(collection).select("*").eq("user_id", userId)
        .order("id").range(offset, offset + size - 1);
      if (error) throw Error("Couldn’t load your records. Try again in a moment.");
      rows.push(...data);
      if (data.length < size) break;
    }
    return [collection, rows];
  }));
  return Object.fromEntries(records) as Workspace;
}

export async function upsertCloud<K extends Collection>(supabase: SupabaseClient, userId: string, collection: K, rows: Workspace[K]) {
  const { error } = await supabase.from(collection).upsert(rows.map(row => ({ ...row, user_id: userId })), {
    onConflict: "id",
    ignoreDuplicates: collection === "reimbursement_receipts",
  });
  if (error) throw writeIssue(error, "Couldn’t save this change. Try again in a moment.");
}

export async function deleteCloud(supabase: SupabaseClient, userId: string, collection: Collection, id: string) {
  const { error } = await supabase.from(collection).delete().eq("user_id", userId).eq("id", id);
  if (error) throw writeIssue(error, "Couldn’t delete this entry. Try again in a moment.");
}
