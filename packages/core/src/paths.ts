import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root: from this file's location (packages/core/src -> ../../..) when running
 *  from source (tsx/vitest); bundlers rewrite import.meta.url into a non-Node URL,
 *  so under them (e.g. apps/web via Next.js) walk up from cwd to the workspace file. */
function resolveRepoRoot(): string {
  try {
    return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  } catch {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return process.cwd();
  }
}

export const REPO_ROOT = resolveRepoRoot();

export const PROMPTS_DIR = path.join(REPO_ROOT, "prompts");

/** Checked-in structure skeletons, inserted into the bank by seedStructures. */
export const SEED_STRUCTURES_DIR = path.join(REPO_ROOT, "seed", "structures");

/** Saved timeline+questionnaire fixtures for `aiugc plan regress` — the plan
 *  pass is text-only, so the regression corpus is just JSON. */
export const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures", "timelines");

/** Local storage backend root (used when no Supabase credentials are configured). */
export const LOCAL_STORAGE_DIR = path.join(REPO_ROOT, ".storage");

/** Scratch dir for ffmpeg outputs before they are pushed to storage. */
export const WORK_DIR = path.join(REPO_ROOT, ".work");
