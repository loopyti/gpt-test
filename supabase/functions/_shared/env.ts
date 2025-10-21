export interface StorageEnvironment {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  folderPrefix: string;
}

export function loadStorageEnvironment(): StorageEnvironment {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }

  const bucket = Deno.env.get("IMAGE_BUCKET") ?? "image-outputs";
  const folderPrefix = Deno.env.get("IMAGE_FOLDER_PREFIX") ?? "gpt";

  return { supabaseUrl, serviceRoleKey, bucket, folderPrefix };
}
