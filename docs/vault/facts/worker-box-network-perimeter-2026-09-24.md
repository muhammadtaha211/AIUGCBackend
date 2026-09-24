---
type: fact
status: verified
verified: 2026-09-24
method: "founder-run, on the box and in the Hetzner console: `sudo ufw status verbose`; `sudo sshd -T` (before and after editing sshd_config.d); the Hetzner Cloud Firewall console; the SSH login history; `command -v docker`. This session ran nothing against the box itself — see docs/07-worker-box.md 'Network perimeter and SSH' for the exact commands to re-run."
source: founder
---

# The worker box's network perimeter, and the SSH hole that was open since day one

Every item below carries its own provenance tag. **Do not promote a `[REASONED]` line to
`[MEASURED]`, and do not read a `[founder-reported]` line as something this session verified —
this session ran no command against the box.**

## Current state

| #   | Item                                 | Value                                                                                                                                                                                                                                                                                                                                      | Tag                                            |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| A1  | `ufw`                                | Active, logging low. Defaults: deny incoming, allow outgoing, routed disabled. Only allow rule: `22/tcp` from Anywhere, IPv4 and IPv6.                                                                                                                                                                                                     | `[MEASURED, founder; sudo ufw status verbose]` |
| A2  | Hetzner Cloud Firewall               | None existed before 2026-09-24. Created that day, applied to the worker server. Inbound: TCP 22 + ICMP from any IPv4/IPv6. Outbound: **no rules** — see "Why no outbound rule" below. SSH confirmed working in a new session after it was applied. Name: `tavnit-worker-firewall`.                                                         | `[founder-reported]`                           |
| A3  | SSH password auth, before the change | `sudo sshd -T`: `passwordauthentication yes`, `kbdinteractiveauthentication no`, `permitrootlogin without-password`, `pubkeyauthentication yes`.                                                                                                                                                                                           | `[MEASURED, founder]`                          |
| A4  | The fix                              | `/etc/ssh/sshd_config.d/00-hardening.conf`: `PasswordAuthentication no` / `KbdInteractiveAuthentication no`. `00-` prefix sorts before cloud-init's `50-sshd_config.d` entry; sshd keeps the first value it reads for a directive. `sshd -t` passed, then `systemctl reload ssh`.                                                          | `[founder-reported]`                           |
| A5  | After the change                     | `sshd -T` shows both `no`. Key login from the laptop works. A password-only attempt, run from the box against its own public IP (tests `sshd`'s setting, not the network path), returned `Permission denied (publickey)`. Login history checked before the change: only `Accepted publickey` lines, 0 failed-password attempts in 30 days. | `[MEASURED, founder]`                          |
| A7  | Host key                             | `ED25519 SHA256:jlOaU5XHz41HQJg4ER6u4Yx2jW8sdDrO4d5XQ38uhAU` — public, not a secret.                                                                                                                                                                                                                                                       | `[MEASURED]`                                   |
| A8  | Non-sudo service user                | OPEN, not fixed. The worker runs as `aiugc`, which has password-protected sudo. Target: a dedicated non-sudo service user.                                                                                                                                                                                                                 | `[REASONED, from a sudo password prompt]`      |
| A9  | Docker                               | `command -v docker` returns nothing — not installed. Relevant because a container's published ports bypass `ufw`; with no Docker, that vector doesn't exist today.                                                                                                                                                                         | `[MEASURED, founder]`                          |

## What A3–A5 actually mean

**Password login for the `aiugc` user was reachable from the open internet from the day
`docs/07-worker-box.md` §2 created that user until 2026-09-24.** §3's firewall step (`ufw allow
OpenSSH`) never closed this — it opens port 22 to everyone and says nothing about which
authentication method a connection on that port is allowed to use. Likely cause
`[REASONED, not verified]`: Hetzner's Ubuntu 24.04 image commonly ships
`/etc/ssh/sshd_config.d/50-cloud-init.conf`, which enables password login, and nothing in the runbook
ever overrode it until A4.

**Nothing is known to have exploited the window** — the login history the founder checked before the
change showed only `Accepted publickey` lines and 0 failed-password attempts in the last 30 days. But
that is luck observed after the fact, not a property of the configuration: the setting being open,
not the absence of an attempt, was the actual exposure.

## A2 — why the Hetzner firewall has no outbound rule

On Hetzner Cloud Firewalls, adding **any** outbound rule switches the firewall from "allow all
outbound" to "allow only what's listed," dropping every other outbound flow. The worker calls out to
Supabase, Anthropic, ElevenLabs, HeyGen, fal, Sentry, GitHub, npm and apt — enumerating all of that as
explicit outbound rules is more surface to get wrong for no inbound benefit, since the box making
outbound-only connections it initiated is not the threat this firewall is closing. So outbound is left
with no rules at all, which on Hetzner means "unrestricted," matching `ufw`'s own default-allow-outbound
posture.

## Recovery if SSH ever locks out

`sshd` settings don't affect the Hetzner Cloud Console's web console — it's a local login to the VM,
independent of the network stack:

1. Open the server's console in the Hetzner Cloud dashboard.
2. `sudo rm /etc/ssh/sshd_config.d/00-hardening.conf && sudo systemctl reload ssh`

## Re-measure with

```
sudo ufw status verbose
sudo sshd -T
```

plus a password-only SSH attempt from the box against its own public IP (never from an untrusted
host, and never with a real password typed anywhere it could be logged).

## Related

- `docs/07-worker-box.md` §3 (the original `ufw` setup) and §14 (this hardening, operational summary).
- A8 (non-sudo service user) and A2's platform-ACL counterpart, `SB-6` in the live Supabase snapshot,
  are both open queue items in `docs/vault/state-of-play.md`.
- [[supabase-live-snapshot-2026-09-24]] — the same day's other external-state measurement.
