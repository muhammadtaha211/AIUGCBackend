# 07 — Worker Box (Hetzner)

## Decision: one flat-rate Hetzner VPS, systemd, nothing else

The worker moves off the founder's Windows desktop onto a small Hetzner Cloud instance
(resized up when queue depth demands — docs/02 sized a CPX41 for full volume; start smaller).
Supervision is one systemd unit (`deploy/aiugc-worker.service`). No Docker, no CI, no deploy
tooling — CLAUDE.md decision #10. Updates are `git pull` + restart.

Two things are deliberately NOT decided here:

- **`DATABASE_URL` keeps port 6543.** The ~2/day connection-drop rate
  (`docs/vault/facts/worker-death-tally-2026-08-20-to-25.md`) was measured on a desktop over home
  internet and does not transfer to a datacenter. Re-measure after a week on the box (§12), then
  decide.
- Instance size/region — recorded in a vault decision note after provisioning, not here.

Everything below assumes: you created the server in the Hetzner console (**Ubuntu 24.04 LTS**),
you have its IP, and you have never touched a Linux server before. Every command is paste-able.
Replace `<SERVER_IP>` wherever it appears. Commands run **on the box** unless the step says
"on Windows".

## 1. First login (on Windows, PowerShell)

```
ssh root@<SERVER_IP>
```

First connection asks `Are you sure you want to continue connecting?` — type `yes`. (If you set a
root password instead of an SSH key at creation, it will ask for that password.) **Works:** the
prompt changes to `root@<hostname>:~#`. You are now typing on the server.

## 2. A non-root user

The worker must not run as root (and Chrome behaves worse as root). Still as root:

```
adduser aiugc
```

It asks for a password (choose one, save it) and some optional fields — Enter through them, `Y` at
the end. Then:

```
usermod -aG sudo aiugc
mkdir -p /home/aiugc/.ssh && cp /root/.ssh/authorized_keys /home/aiugc/.ssh/ 2>/dev/null; chown -R aiugc:aiugc /home/aiugc/.ssh 2>/dev/null; chmod 700 /home/aiugc/.ssh 2>/dev/null
```

(The second line copies your SSH key to the new user; it silently does nothing on a
password-only server — then you'll just log in with the password you chose.)

Type `exit`, then reconnect **as aiugc** — every later step assumes this user:

```
ssh aiugc@<SERVER_IP>
```

**Works:** prompt says `aiugc@<hostname>:~$`. `sudo` commands will ask for the aiugc password.

## 3. Firewall

The worker only makes _outbound_ calls (Supabase, Anthropic, ElevenLabs, HeyGen, fal, Google
Fonts); nothing needs to reach it. Allow SSH, block the rest:

```
sudo ufw allow OpenSSH
sudo ufw enable
```

`ufw enable` warns it may disrupt connections — you allowed OpenSSH first, so type `y`.
**Works:** `sudo ufw status` shows `Status: active` with `OpenSSH ALLOW`. **Never** remove the
OpenSSH rule — that locks you out of your own server.

## 4. System packages, ffmpeg, Chrome's libraries, swap

```
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git ffmpeg libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64
```

The `lib*` list is what `@remotion/renderer`'s headless Chrome needs on a bare server. (If apt
says `Unable to locate package` for a `…t64` name, you are on an older Ubuntu — retry that name
without the `t64` suffix.) **Works:**

```
ffmpeg -version && ffprobe -version
```

prints version banners for both (`ffmpeg version 6.x` is fine). Both must be on PATH — the worker
probes/normalizes with them, and even the render sample's fixture generator shells out to ffmpeg.

Swap, so a hungry Chrome render degrades instead of getting OOM-killed on a small instance:

```
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Works:** `free -h` shows a `Swap:` line with `2.0Gi` total.

## 5. Node 22 + pnpm

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
```

**Works:** `node --version` prints `v22.x`. Then:

```
pnpm --version
```

**Works:** it prints a version — but corepack's own bundled default (`11.24.0` when this was
written), **not** the repo's pinned `9.15.9`, and no download prompt appears. Nothing pins pnpm
here yet: the pin is `packageManager` in the repo's `package.json`, which does not exist on this
box until §6 clones it. All this step proves is that corepack put a `pnpm` shim on PATH — §6 is
where the pinned version actually downloads and its prompt gets answered. Also check `which pnpm`
prints `/usr/bin/pnpm` — if it prints something else, that path must replace `ExecStart`'s in §10's
unit.

## 6. Clone the repo

The repo is private, and the box authenticates with a **fine-grained personal access token** —
create it on Windows first: github.com → your avatar → Settings → Developer settings →
Fine-grained tokens → Generate new token. Set **Expiration: No expiration** — an expiry fails
silently and late: months from now `git pull` in §11 starts erroring, the restart after it happily
runs the checkout that is already there, and the box serves stale code with a green
`systemctl status`. Repository access: _Only select repositories_ → `AIUGCBackend`. Permissions:
_Contents: Read-only_. Copy the token (`github_pat_…`), and write down wherever you keep account
records that this token exists and that the worker box depends on it — nothing on the box will ever
remind you, and GitHub is the only place it can be revoked.

On the box:

```
git config --global credential.helper store
git clone https://github.com/muhammadtaha211/AIUGCBackend.git
```

Username: `muhammadtaha211`. Password: **paste the token** (typing shows nothing — that's normal).
It is then saved in `~/.git-credentials` on the box (plain text; read-only scope, revocable on
GitHub any time), so `git pull` never asks again.

```
cd ~/AIUGCBackend && pnpm install
```

This is the first pnpm command run with the repo's `packageManager` pin in scope, so corepack may
ask `? Do you want to continue? [Y/n]` here (it is downloading the exact pnpm the repo pins) — type
`y`. Do not skip it: §10's service runs `/usr/bin/pnpm start` from inside this repo, so answering
that prompt now, by hand, is what stops it hanging the systemd unit later.

**Works:** a few minutes of progress bars ending without red `ERR_` lines. Then confirm the pin
took:

```
cd ~/AIUGCBackend && pnpm --version
```

**Works:** prints `9.15.9` — the repo's pin, not §5's corepack default — with no prompt.

## 7. The box's `.env`

Never committed, created by hand at exactly the path the systemd unit reads:

```
nano ~/AIUGCBackend/apps/worker/.env
```

Paste this skeleton, then replace every `PASTE-…` with the value from the **desktop's** working
`.env` (same database, same provider keys — the box is the same worker, just reliable):

```
DATABASE_URL=PASTE-FROM-DESKTOP-ENV
SUPABASE_URL=PASTE-FROM-DESKTOP-ENV
SUPABASE_SERVICE_ROLE_KEY=PASTE-FROM-DESKTOP-ENV
ANTHROPIC_API_KEY=PASTE-FROM-DESKTOP-ENV
ELEVENLABS_API_KEY=PASTE-FROM-DESKTOP-ENV
FAL_KEY=PASTE-FROM-DESKTOP-ENV
HEYGEN_API_KEY=PASTE-FROM-DESKTOP-ENV
WORKER_ID=hetzner
```

Two lines that are different from the desktop **on purpose**:

- **`WORKER_ID=hetzner`, never `local`.** `jobs.locked_by` is the queue's only record of _which
  machine_ claimed a job, and both of this week's incident investigations pivoted on it — a box
  claiming as `local:*` would be indistinguishable from the desktop forever.
- **No `DRY_RUN` line at all.** `DRY_RUN=1` stubs every provider call; on the box it would
  "succeed" at everything while producing placeholder files.

Save (Ctrl-O, Enter) and exit (Ctrl-X), then lock it down:

```
chmod 600 ~/AIUGCBackend/apps/worker/.env
```

## 8. Hebrew fonts — nothing to install, and here is the proof

This was checked against the code, not assumed. The compositions load their one font through
Remotion's own loader — `packages/remotion/src/overlays.tsx:15`:

```ts
import { loadFont } from "@remotion/google-fonts/Heebo";
export const { fontFamily } = loadFont("normal", {
  weights: ["800"],
  subsets: ["hebrew", "latin"],
});
```

with the comment above it saying exactly why: _"Never rely on system fonts."_ Every text surface —
captions, hook line, step labels, watermark — draws with this `fontFamily`. Headless Chrome fetches
the Heebo WOFF2 (Hebrew + Latin subsets) from Google Fonts **at render time**, so a bare Ubuntu
with zero fonts installed renders Hebrew correctly. **System Hebrew fonts are a non-issue by
construction.** The failure mode is also safe: if the font fetch fails (network blip), the render
_errors loudly_ and retries as transient (`packages/core/src/providers/remotion.ts` names "font
fetches" in its transient list) — it does not silently ship tofu. The acceptance test in §12 still
ends with a human watching real Hebrew, because that is the only proof that closes the loop.

## 9. The disk — bundle leak fixed in code; the cron stays as a backstop

The webpack-bundle leak this section used to mitigate is fixed in code (2026-09-01):
`packages/remotion/src/render.ts` passes a fixed, repo-owned `outDir`, so the bundle lives at
`/home/aiugc/AIUGCBackend/.work/remotion-bundle` — one directory, overwritten in place, never in
`/tmp` — and `getBundle()` re-bundles if the directory vanishes instead of failing every render
until restart (`docs/vault/defects/remotion-temp-dirs-are-never-cleaned-up.md`).

That last clause is not hypothetical: **the first version of this section's cron caused an
outage.** The worker runs for weeks (§10), the bundle was created once per process under `/tmp`,
and the cron deleted any `remotion-*` dir older than 12 hours — so once the worker outlived its
own bundle, every Service A render failed with "Tried to serve the Webpack bundle on a HTTP
server, but the file …/index.html does not exist" until the service was restarted. Full mechanism:
`docs/vault/defects/tmp-cron-deletes-live-worker-bundle.md`. Never point a janitor at a directory
a long-lived process is still serving from.

What still lands in `/tmp`: `remotion-v4.0.499-assets*` dirs. The renderer tears those down on the
happy path; the shells left behind are failed or interrupted cleanups — small and slow, but on a
box nobody logs into they still deserve a janitor. The cron stays for those, and the live bundle
is no longer in its blast radius:

```
crontab -e
```

(First time it asks which editor — choose `1` for nano.) Add this line at the bottom, save, exit:

```
@daily find /tmp -maxdepth 1 -name 'remotion-*' -user aiugc -mmin +720 -exec rm -rf {} +
```

Deletes leftover remotion temp dirs older than 12 hours, daily — an in-flight render's dir is
always younger, and the worker's bundle no longer lives here. **Works:** `crontab -l` shows the
line. The disk check to glance at weekly (and whenever renders start failing mysteriously):

```
df -h / && ls -d /tmp/remotion-* 2>/dev/null | wc -l
```

First line: free space on `/` — worry below ~5 GB `Avail`. Second: how many leaked dirs are
currently sitting there (0 right after the cron ran is healthy).

## 10. The systemd unit — the worker as a service

The unit file is in the repo (`deploy/aiugc-worker.service`); it assumes the paths this runbook
created (`/home/aiugc/AIUGCBackend`). Install and start it:

```
sudo cp ~/AIUGCBackend/deploy/aiugc-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aiugc-worker
```

**Works:**

```
systemctl status aiugc-worker
```

shows `Active: active (running)`, and the live log —

```
journalctl -u aiugc-worker -f
```

— shows a pino JSON line with `"msg":"worker started"` and `"workerId":"hetzner"` (Ctrl-C stops
_watching_, not the service). `Restart=always` + `RestartSec=5` is the supervisor: any exit,
including the intentional boot-time fail-fast on a DB fault, becomes a 5-second retry loop instead
of a dead worker nobody notices. pino's output lands in journald, so incidents are greppable:

```
journalctl -u aiugc-worker -o cat | grep '"claim failed'
journalctl -u aiugc-worker --since today -o cat | grep '"level":50'
```

## 11. Updating the box later

```
cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker
```

That is the entire deploy pipeline, per decision #10.

**Then verify the artifact, not the symptom:**

```
cd ~/AIUGCBackend && git log -1 --oneline && systemctl is-active aiugc-worker
```

The commit must be the one you meant to ship. This step is not ceremony — on 2026-09-01 a
deploy was believed done because a render succeeded afterwards, and it had not happened:
the box was on the merge's other parent, and the render only worked because restarting the
OLD code rebuilt a bundle the cron later deleted again. Renders died for another day.
A succeeding render is NOT evidence a deploy landed; a restart alone produces one. Full
autopsy: `docs/vault/falsified/bundle-fix-reached-the-worker-box.md`.

When a render still fails after a deploy, the customer-facing message is deliberately
vague and Vercel logs hold nothing — all render work is here. The real reason is on
`jobs.last_error`; `packages/core/.work/diag-failed-render.ts` (gitignored, read-only,
session pooler) prints it alongside the job's attempt count and the worker heartbeat.

## 12. Acceptance test — the gate before the box touches a customer

1. **The service is alive:** `systemctl status aiugc-worker` → `Active: active (running)`, and
   `journalctl -u aiugc-worker -o cat | grep '"worker started"'` shows `"workerId":"hetzner"`.
2. **The DB round-trip is real:** within ~2 minutes the box's light lane claims the reaper
   singleton and reschedules it every ~60s:
   `journalctl -u aiugc-worker -o cat | grep reap_dead_renders | tail -3` → `"job rescheduled"`
   lines. Cross-check from the outside (Supabase Studio → `jobs` table): the `reap_dead_renders`
   row's `locked_by` says `hetzner:light`. (If the desktop worker is also running, it may win the
   claim — stop it and check again.)
3. **A real Hebrew render, on the box:** `cd ~/AIUGCBackend && pnpm --filter @aiugc/remotion render:sample:a`
   — the first run downloads Chrome Headless Shell (one-time, ~150 MB), generates fixtures via
   ffmpeg, then renders. **Works:** it ends with `wrote …/packages/remotion/out/sample-a.mp4 in Ns`
   — measured 2026-08-27 on a CPX32 (4 vCPU): **45s**, on a warm run, i.e. one where the Chrome
   Headless Shell download had already happened. Add that one-time ~150 MB download to the first
   run.
4. **Pull it back and watch it** (on Windows, PowerShell):
   `scp aiugc@<SERVER_IP>:AIUGCBackend/packages/remotion/out/sample-a.mp4 "$env:USERPROFILE\Desktop\box-sample.mp4"`
   then open it from the Desktop.
5. **What good looks like:** vertical 1080×1920; the Hebrew hook line
   „זה מה שאף אחד לא מספר לכם" burned crisp in heavy Heebo, reading right-to-left, black outline,
   captions with the yellow active word. That one file proves fonts, Chrome, ffmpeg and the render
   pipeline together; step 2 proved the DB. **Broken looks like:** hollow rectangles or `?` where
   Hebrew should be (font fetch failed — check outbound network), or step 3 dying with a
   `sandbox`/`namespace`/`Operation not permitted` Chrome error — that is Ubuntu 24.04's
   unprivileged-user-namespace restriction; fix with
   `echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-remotion.conf && sudo sysctl --system`
   and rerun step 3.

After the box passes: leave it running for a week, then count the drops —
`journalctl -u aiugc-worker -o cat | grep -c '"claim failed'` — that number, not the desktop's
~2/day, is what decides whether `DATABASE_URL` moves off the transaction pooler.
