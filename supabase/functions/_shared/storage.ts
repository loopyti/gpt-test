import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";
import { loadStorageEnvironment } from "./env.ts";

export interface StoredFile {
  path: string;
  publicUrl: string;
  bucket: string;
}

export interface StorageContext {
  client: SupabaseClient;
  bucket: string;
  folderPrefix: string;
}

export function createStorageContext(): StorageContext {
  const { supabaseUrl, serviceRoleKey, bucket, folderPrefix } = loadStorageEnvironment();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return { client, bucket, folderPrefix };
}

export async function uploadPng(
  context: StorageContext,
  filename: string,
  data: Uint8Array,
): Promise<StoredFile> {
  const path = `${context.folderPrefix}/${filename}`;
  const blob = new Blob([data], { type: "image/png" });
  const { error } = await context.client.storage.from(context.bucket).upload(path, blob, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to upload ${filename}: ${error.message}`);
  }

  const publicUrlResult = context.client.storage
    .from(context.bucket)
    .getPublicUrl(path);

  if (publicUrlResult.error) {
    throw new Error(`Failed to create public URL for ${filename}: ${publicUrlResult.error.message}`);
  }

  return { path, publicUrl: publicUrlResult.data.publicUrl, bucket: context.bucket };
}

export async function downloadPng(
  context: StorageContext,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await context.client.storage.from(context.bucket).download(path);
  if (error || !data) {
    throw new Error(`Failed to download ${path}: ${error?.message ?? "unknown error"}`);
  }
  const arrayBuffer = await data.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
    ...init,
  });
}
