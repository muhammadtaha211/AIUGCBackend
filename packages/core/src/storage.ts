import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "./config";
import { LOCAL_STORAGE_DIR } from "./paths";

/**
 * Three private buckets (docs/03-storage.md):
 * - raw:     user uploads as-is (deleted 30 days after normalization)
 * - assets:  normalized demos, hook bank, persona clips, thumbnails
 * - renders: audio previews and video outputs (retention per app_config)
 */
export type Bucket = "raw" | "assets" | "renders";

/** Storage path format: "<bucket>/<key>", where key follows {business_id|bank}/{entity}/{id}/{filename}. */
export interface Storage {
  put(bucket: Bucket, key: string, localFile: string): Promise<string>;
  download(storagePath: string, localFile: string): Promise<void>;
  remove(storagePath: string): Promise<void>;
  signedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;
}

export function storageKey(parts: {
  businessId?: string;
  entity: "demo" | "hook_clip" | "persona_clip" | "audio" | "video" | "thumb";
  id: string;
  filename: string;
}): string {
  return [parts.businessId ?? "bank", parts.entity, parts.id, parts.filename].join("/");
}

function splitPath(storagePath: string): { bucket: Bucket; key: string } {
  const slash = storagePath.indexOf("/");
  return { bucket: storagePath.slice(0, slash) as Bucket, key: storagePath.slice(slash + 1) };
}

/** Filesystem-backed storage for the CLI phase / local dev (no Supabase project needed). */
class LocalStorage implements Storage {
  async put(bucket: Bucket, key: string, localFile: string): Promise<string> {
    const dest = path.join(LOCAL_STORAGE_DIR, bucket, key);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(localFile, dest);
    return `${bucket}/${key}`;
  }

  async download(storagePath: string, localFile: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    mkdirSync(path.dirname(localFile), { recursive: true });
    copyFileSync(path.join(LOCAL_STORAGE_DIR, bucket, key), localFile);
  }

  async remove(storagePath: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    rmSync(path.join(LOCAL_STORAGE_DIR, bucket, key), { force: true });
  }

  async signedUrl(storagePath: string): Promise<string> {
    const { bucket, key } = splitPath(storagePath);
    return `file://${path.join(LOCAL_STORAGE_DIR, bucket, key).replaceAll("\\", "/")}`;
  }
}

class SupabaseStorage implements Storage {
  constructor(private client: SupabaseClient) {}

  async put(bucket: Bucket, key: string, localFile: string): Promise<string> {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(key, readFileSync(localFile), { upsert: true });
    if (error) throw new Error(`storage upload failed (${bucket}/${key}): ${error.message}`);
    return `${bucket}/${key}`;
  }

  async download(storagePath: string, localFile: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error) throw new Error(`storage download failed (${storagePath}): ${error.message}`);
    mkdirSync(path.dirname(localFile), { recursive: true });
    writeFileSync(localFile, Buffer.from(await data.arrayBuffer()));
  }

  async remove(storagePath: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    const { error } = await this.client.storage.from(bucket).remove([key]);
    if (error) throw new Error(`storage remove failed (${storagePath}): ${error.message}`);
  }

  async signedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    const { bucket, key } = splitPath(storagePath);
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds);
    if (error) throw new Error(`signed url failed (${storagePath}): ${error.message}`);
    return data.signedUrl;
  }
}

let instance: Storage | undefined;

export function getStorage(): Storage {
  if (!instance) {
    const env = getEnv();
    instance =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseStorage(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
        : new LocalStorage();
  }
  return instance;
}

/** Test hook. */
export function setStorage(s: Storage | undefined): void {
  instance = s;
}
