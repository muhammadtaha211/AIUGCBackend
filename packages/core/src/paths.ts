import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file's location (packages/core/src -> ../../..). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

export const PROMPTS_DIR = path.join(REPO_ROOT, "prompts");

/** Local storage backend root (used when no Supabase credentials are configured). */
export const LOCAL_STORAGE_DIR = path.join(REPO_ROOT, ".storage");

/** Scratch dir for ffmpeg outputs before they are pushed to storage. */
export const WORK_DIR = path.join(REPO_ROOT, ".work");
