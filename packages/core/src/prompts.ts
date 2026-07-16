import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROMPTS_DIR } from "./paths";

/**
 * Prompts are versioned files in-repo: prompts/<name>/v<N>.md. A new prompt
 * revision is a new file (v2.md), never an edit — scripts record which
 * prompt_version produced them (`<name>@v<N>`), so outputs stay traceable.
 */
export function latestPromptVersion(name: string): number {
  const dir = path.join(PROMPTS_DIR, name);
  const versions = readdirSync(dir)
    .map((f) => /^v(\d+)\.md$/.exec(f)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number);
  if (versions.length === 0) throw new Error(`no prompt versions found in ${dir}`);
  return Math.max(...versions);
}

export function renderPrompt(
  name: string,
  vars: Record<string, string | number>,
  version?: number,
): { text: string; promptVersion: string } {
  const v = version ?? latestPromptVersion(name);
  const template = readFileSync(path.join(PROMPTS_DIR, name, `v${v}.md`), "utf8");
  const text = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`prompt ${name}@v${v}: missing variable "${key}"`);
    return String(value);
  });
  return { text, promptVersion: `${name}@v${v}` };
}
