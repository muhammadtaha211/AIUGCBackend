// SessionStart hook (.claude/settings.json): installs the git pre-push hook that refuses a push to
// main from a Claude Code session (vault 0097). Change this file in a local session only.
//
// Locally it installs into this repo's shared hooks folder. That copy refuses only when CLAUDECODE is
// set, so the founder's own terminal pushes are untouched. It prints nothing unless something is wrong.
// In the cloud (CLAUDE_CODE_REMOTE true or 1) it also installs into ~/.config/aiugc/hooks and points
// `git config --global core.hooksPath` there, so a fresh clone anywhere in the VM is covered. Both
// cloud copies refuse every time. It prints one status line into the session.
//
// `--check` verifies the install for this mode and exits 1 if it is not in place; the unattended
// run's bootstrap stops on that (docs/unattended/protocol.md). Without --check it always exits 0: a
// SessionStart failure must never get in a session's way.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = fileURLToPath(new URL("pre-push", import.meta.url));
const MARKER = "aiugc-pre-push";
const cloud = ["true", "1"].includes(process.env.CLAUDE_CODE_REMOTE ?? "");
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function git(args) {
  return execFileSync("git", ["-C", project, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

function hookBody(always) {
  const template = readFileSync(TEMPLATE, "utf8").replace(/\r\n/g, "\n");
  return template.replace(/^ALWAYS=0$/m, `ALWAYS=${always ? 1 : 0}`);
}

const repoHooks = () =>
  join(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "hooks");
const globalHooks = () => join(homedir(), ".config", "aiugc", "hooks");

// Writes the hook unless an identical copy is there. Leaves a pre-push that is not ours alone.
function install(dir, body) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "pre-push");
  if (existsSync(file)) {
    const current = readFileSync(file, "utf8");
    if (!current.includes(MARKER))
      return `not installed: ${file} is another pre-push hook, left as it is`;
    if (current === body) {
      chmodSync(file, 0o755);
      return null;
    }
  }
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, body);
  chmodSync(temp, 0o755);
  try {
    renameSync(temp, file);
  } catch {
    writeFileSync(file, body);
  }
  chmodSync(file, 0o755);
  return null;
}

function installed(dir, body) {
  const file = join(dir, "pre-push");
  return existsSync(file) && readFileSync(file, "utf8") === body;
}

function check() {
  const body = hookBody(cloud);
  const problems = [];
  if (!installed(repoHooks(), body))
    problems.push(`no ${cloud ? "cloud" : "local"} pre-push hook in ${repoHooks()}`);
  if (cloud) {
    if (!installed(globalHooks(), body))
      problems.push(`no cloud pre-push hook in ${globalHooks()}`);
    let hooksPath = "";
    try {
      hooksPath = git(["config", "--global", "--get", "core.hooksPath"]);
    } catch {
      // unset
    }
    if (hooksPath !== globalHooks())
      problems.push(`git config --global core.hooksPath is "${hooksPath}", not ${globalHooks()}`);
  }
  if (problems.length) {
    console.log(
      `aiugc pre-push check FAILED (${cloud ? "cloud" : "local"} mode): ${problems.join("; ")}`,
    );
    return false;
  }
  console.log(`aiugc pre-push check passed (${cloud ? "cloud" : "local"} mode)`);
  return true;
}

if (process.argv.includes("--check")) {
  let passed = false;
  try {
    passed = check();
  } catch (error) {
    console.log(`aiugc pre-push check FAILED: ${error.message}`);
  }
  process.exit(passed ? 0 : 1);
}

try {
  const body = hookBody(cloud);
  const problems = [install(repoHooks(), body)];
  if (cloud) {
    problems.push(install(globalHooks(), body));
    git(["config", "--global", "core.hooksPath", globalHooks()]);
  } else {
    let localHooksPath = "";
    try {
      localHooksPath = git(["config", "--get", "core.hooksPath"]);
    } catch {
      // unset, as it should be
    }
    if (localHooksPath)
      problems.push(
        `core.hooksPath is set to ${localHooksPath}, so git ignores the installed hook`,
      );
  }
  const found = problems.filter(Boolean);
  if (cloud) {
    console.log(
      found.length
        ? `aiugc guard: cloud mode, but the pre-push hook is ${found.join("; ")}. Stop and ask the founder before pushing anything.`
        : `aiugc guard: cloud mode. The pre-push hook that refuses a push to main is installed in ${globalHooks()} (git config --global core.hooksPath) and ${repoHooks()}.`,
    );
  } else if (found.length) {
    console.log(
      `aiugc guard: the pre-push hook that refuses a push to main from a Claude session is ${found.join("; ")}.`,
    );
  }
} catch (error) {
  console.log(
    `aiugc guard: could not install the pre-push hook (${error.message}).` +
      (cloud ? " Stop and ask the founder before pushing anything." : ""),
  );
}
process.exit(0);
