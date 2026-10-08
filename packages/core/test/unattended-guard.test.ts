// The unattended-run refusals that are enforced by configuration (vault 0097,
// docs/unattended/protocol.md). Not product code: it tests .claude/settings.json and .claude/hooks/,
// which live outside every package, so it sits here with the other repo-file tests.
//
// A push to main is refused by a git pre-push hook that .claude/hooks/session-start.mjs installs at
// every session start: proven here against a temp bare remote, in every spelling the founder listed,
// with the hook installed the cloud way and the local way. Settings are frozen in a cloud session by
// a ConfigChange hook. Every spawn gets an environment built from scratch, so the CLAUDECODE and
// CLAUDE_CODE_REMOTE this test may inherit from a Claude session never leak in, and nothing touches
// the real checkout's git setup.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SESSION_START = join(REPO, ".claude", "hooks", "session-start.mjs");

type HookEntry = { type: string; command: string; timeout?: number };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks: Record<string, HookGroup[]> };

const settings = JSON.parse(
  readFileSync(join(REPO, ".claude", "settings.json"), "utf8"),
) as Settings;

function onlyHook(event: string): HookGroup & { hook: HookEntry } {
  const groups = settings.hooks[event] ?? [];
  expect(groups).toHaveLength(1);
  const group = groups[0]!;
  expect(group.hooks).toHaveLength(1);
  return { ...group, hook: group.hooks[0]! };
}

const temps: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "aiugc-guard-"));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

// An environment with nothing from the caller but what processes need to start.
const PASSTHROUGH = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "LANG",
]);
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (PASSTHROUGH.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

function findSh(): string {
  if (process.platform !== "win32") return "/bin/sh";
  const execPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim();
  const gitRoot = resolve(execPath, "..", "..", "..");
  const found = [join(gitRoot, "bin", "sh.exe"), join(gitRoot, "usr", "bin", "sh.exe")].find((p) =>
    existsSync(p),
  );
  if (!found) throw new Error(`Git's sh.exe was not found under ${gitRoot}`);
  return found;
}

describe("settings.json", () => {
  it("holds only the pre-push installer and the settings freeze", () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(["ConfigChange", "SessionStart"]);
    expect(Object.keys(settings).sort()).toEqual(["hooks"]);
  });

  it("runs session-start.mjs at every session start", () => {
    const { matcher, hook } = onlyHook("SessionStart");
    expect(matcher).toBeUndefined();
    expect(hook.command).toBe('node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.mjs"');
  });

  it("freezes settings in a cloud session and does nothing locally", () => {
    const { matcher, hook } = onlyHook("ConfigChange");
    expect(matcher).toBe("project_settings|local_settings|user_settings");
    const shell = findSh();
    const run = (env: Record<string, string>) =>
      spawnSync(shell, ["-c", hook.command], {
        input: "{}",
        env: cleanEnv(env),
        encoding: "utf8",
        timeout: 20_000,
      });
    const locals: Record<string, string>[] = [
      {},
      { CLAUDE_CODE_REMOTE: "" },
      { CLAUDE_CODE_REMOTE: "false" },
    ];
    for (const env of locals) {
      const local = run(env);
      expect(local.status).toBe(0);
      expect(local.stderr).toBe("");
    }
    for (const flag of ["true", "1"]) {
      const cloud = run({ CLAUDE_CODE_REMOTE: flag });
      expect(cloud.status).toBe(2);
      expect(cloud.stderr).toContain("frozen");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The pre-push hook against a temp bare remote.

type Repos = {
  root: string;
  remote: string;
  work: string;
  env: (extra?: Record<string, string>) => NodeJS.ProcessEnv;
};

function setUp(mode: "cloud" | "local"): Repos {
  const root = temp();
  const home = join(root, "home");
  mkdirSync(home);
  const gitconfig = join(home, "gitconfig");
  writeFileSync(gitconfig, "");
  const base = {
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    ...(mode === "cloud" ? { CLAUDE_CODE_REMOTE: "true" } : {}),
  };
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const repos: Repos = { root, remote, work, env: (extra = {}) => cleanEnv({ ...base, ...extra }) };
  ok(git(repos, root, ["init", "-q", "--bare", "-b", "main", remote]));
  ok(git(repos, root, ["init", "-q", "-b", "main", work]));
  commit(repos, work);
  ok(git(repos, work, ["remote", "add", "origin", remote]));
  ok(git(repos, work, ["push", "-q", "origin", "HEAD:main"]));
  return repos;
}

function git(
  repos: Repos,
  cwd: string,
  args: string[],
  extra: Record<string, string> = {},
): SpawnSyncReturns<string> {
  const result = spawnSync("git", args, {
    cwd,
    env: repos.env(extra),
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return result;
}
function ok(result: SpawnSyncReturns<string>): string {
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}
function commit(repos: Repos, cwd: string): void {
  ok(git(repos, cwd, ["commit", "-q", "--allow-empty", "-m", "c"]));
}
function remoteRef(repos: Repos, ref: string): string {
  return ok(git(repos, repos.root, ["--git-dir", repos.remote, "rev-parse", ref]));
}
function sessionStart(repos: Repos, check = false): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, check ? [SESSION_START, "--check"] : [SESSION_START], {
    cwd: repos.work,
    env: repos.env({ CLAUDE_PROJECT_DIR: repos.work }),
    encoding: "utf8",
    timeout: 30_000,
  });
}
function expectRefused(
  repos: Repos,
  cwd: string,
  args: string[],
  extra: Record<string, string> = {},
): void {
  const before = remoteRef(repos, "refs/heads/main");
  const result = git(repos, cwd, args, extra);
  expect(result.status, `git ${args.join(" ")} should be refused`).not.toBe(0);
  expect(result.stderr).toContain("aiugc pre-push: refused");
  expect(remoteRef(repos, "refs/heads/main")).toBe(before);
}

describe("the pre-push hook, installed the cloud way", { timeout: 120_000 }, () => {
  it("refuses every spelling of a push to main, and lets the task branch through", () => {
    const repos = setUp("cloud");
    const { work, root } = repos;
    expect(sessionStart(repos, true).status).toBe(1);
    const installed = sessionStart(repos);
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.stdout).toContain("cloud mode. The pre-push hook");
    expect(ok(git(repos, root, ["config", "--global", "--get", "core.hooksPath"]))).toBe(
      join(root, "home", ".config", "aiugc", "hooks"),
    );
    const checked = sessionStart(repos, true);
    expect(checked.status, checked.stdout).toBe(0);

    commit(repos, work);
    const spellings: [string, string[]][] = [
      [work, ["push", "origin", "HEAD:main"]],
      [root, ["-C", work, "push", "origin", "HEAD:main"]],
      [work, ["push", "origin", "main"]],
      [work, ["push", "--all", "origin"]],
      [work, ["push", "--mirror", "origin"]],
      [work, ["push", "-f", "origin", "HEAD:main"]],
      [work, ["push", "origin", "+HEAD:main"]],
      [work, ["push", "--force-with-lease", "origin", "HEAD:main"]],
      [work, ["push", "origin", "HEAD:refs/heads/main"]],
      [work, ["push", "origin", ":main"]],
      [work, ["-c", "alias.p=push", "p", "origin", "HEAD:main"]],
      [work, ["push", "--dry-run", "origin", "HEAD:main"]],
    ];
    for (const [cwd, args] of spellings) expectRefused(repos, cwd, args);

    // An implicit push from main, with main's upstream set.
    ok(git(repos, work, ["fetch", "-q", "origin"]));
    ok(git(repos, work, ["branch", "-q", "--set-upstream-to=origin/main", "main"]));
    expectRefused(repos, work, ["push"]);

    // A fresh clone has no hook of its own: the global core.hooksPath covers it.
    const fresh = join(root, "fresh");
    ok(git(repos, root, ["clone", "-q", repos.remote, fresh]));
    expect(existsSync(join(fresh, ".git", "hooks", "pre-push"))).toBe(false);
    commit(repos, fresh);
    expectRefused(repos, fresh, ["push", "origin", "HEAD:main"]);

    // The task branch goes through.
    ok(git(repos, work, ["switch", "-q", "-c", "feat/x"]));
    commit(repos, work);
    ok(git(repos, work, ["push", "-q", "-u", "origin", "feat/x"]));
    expect(remoteRef(repos, "refs/heads/feat/x")).toBe(ok(git(repos, work, ["rev-parse", "HEAD"])));

    // --no-verify skips every pre-push hook. In a cloud run that is instruction only (vault 0097).
    const before = remoteRef(repos, "refs/heads/main");
    ok(git(repos, work, ["push", "-q", "--no-verify", "origin", "HEAD:main"]));
    expect(remoteRef(repos, "refs/heads/main")).not.toBe(before);
  });
});

describe("the pre-push hook, installed the local way", { timeout: 120_000 }, () => {
  it("refuses a push to main from a Claude session only, and leaves global git config alone", () => {
    const repos = setUp("local");
    const { work, root } = repos;
    const installed = sessionStart(repos);
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.stdout).toBe("");
    expect(git(repos, root, ["config", "--global", "--get", "core.hooksPath"]).status).toBe(1);
    expect(sessionStart(repos, true).status).toBe(0);

    commit(repos, work);
    expectRefused(repos, work, ["push", "origin", "HEAD:main"], { CLAUDECODE: "1" });
    expectRefused(repos, work, ["push", "--dry-run", "origin", "HEAD:main"], { CLAUDECODE: "1" });
    ok(git(repos, work, ["push", "-q", "origin", "HEAD:feat/x"], { CLAUDECODE: "1" }));

    // The founder's own terminal has no CLAUDECODE: untouched.
    const before = remoteRef(repos, "refs/heads/main");
    ok(git(repos, work, ["push", "-q", "origin", "HEAD:main"]));
    expect(remoteRef(repos, "refs/heads/main")).not.toBe(before);
  });

  it("leaves a pre-push hook that is not ours alone, and says so", () => {
    const repos = setUp("local");
    const foreign = join(repos.work, ".git", "hooks", "pre-push");
    writeFileSync(foreign, "#!/bin/sh\nexit 0\n");
    const installed = sessionStart(repos);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("not installed");
    expect(readFileSync(foreign, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(sessionStart(repos, true).status).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the paid-check key name", () => {
  it("is read by no app code: a paid check passes it to the one command that spends", () => {
    const roots = ["packages", "apps"].flatMap((top) =>
      readdirSync(join(REPO, top)).map((pkg) => join(REPO, top, pkg, "src")),
    );
    const hits: string[] = [];
    for (const root of roots.filter((r) => existsSync(r))) {
      for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
        const file = join(entry.parentPath, entry.name);
        if (readFileSync(file, "utf8").includes("PAID_CHECK_ANTHROPIC_KEY")) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
