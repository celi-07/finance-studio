import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { emptyWorkspace, type Collection, type Workspace } from "./ledger";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
export const configured = Boolean(url && key);

let client: SupabaseClient | undefined;
export function getSupabase() {
  if (!configured || !url || !key) throw Error("Supabase connection details are missing.");
  return client ??= createClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
}
function issue(error: { message: string }) {
  return Error(error.message);
}

export async function loadCloud(userId: string): Promise<Workspace> {
  const supabase = getSupabase();
  const collections = Object.keys(emptyWorkspace) as Collection[];
  const records = await Promise.all(collections.map(async collection => {
    const rows: unknown[] = [];
    const size = 500;
    for (let offset = 0; ; offset += size) {
      const { data, error } = await supabase.from(collection).select("*").eq("user_id", userId)
        .order("id").range(offset, offset + size - 1);
      if (error) throw issue(error);
      rows.push(...data);
      if (data.length < size) break;
    }
    return [collection, rows];
  }));
  return Object.fromEntries(records) as Workspace;
}

export async function upsertCloud<K extends Collection>(userId: string, collection: K, rows: Workspace[K]) {
  const { error } = await getSupabase().from(collection).upsert(rows.map(row => ({ ...row, user_id: userId })), {
    onConflict: "id",
    ignoreDuplicates: collection === "reimbursement_receipts",
  });
  if (error) throw issue(error);
}

export async function deleteCloud(userId: string, collection: Collection, id: string) {
  const { error } = await getSupabase().from(collection).delete().eq("user_id", userId).eq("id", id);
  if (error) throw issue(error);
}
