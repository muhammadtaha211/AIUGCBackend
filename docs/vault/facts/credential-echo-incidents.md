---
type: fact
status: verified
verified: 2026-09-29
method: "2026-09-29. MEASURED, printing no value: (1) count-only greps of the local transcripts in C:/Users/USER/.claude/projects/C--Users-USER-Documents-AIUGC/ — grep -c -F 'This is the second occurrence' 561bb0a4-f66f-4127-9d05-7c233b190ad3.jsonl -> 2; grep -c -F 'compromised again' 561bb0a4-….jsonl -> 12; grep -c -F 'rotating the database password now' 908c563b-7ee8-41cc-a145-de6fbf39613d.jsonl -> 2; grep -c -F 'Rotate it when convenient' 908c563b-….jsonl -> 1; grep -c -F 'without exposing secrets' 908c563b-….jsonl -> 1. (2) git show -s 3e443d3; git log -S 'three times' / -S 'echoed in session output' / -S 'two rotations' / -S 'enforce twice' over docs/ and CLAUDE.md. (3) A Node script that reads the five env files in memory and prints only key names, the number of transcript *.jsonl files containing each value, and the earliest/latest file mtime of those files (3534 files scanned). CARRIED, not re-measured: the session dates, which password each incident printed, the first incident’s redaction mechanism, the rotations, and the 2026-09-29 subagent echo, all from a research subagent's report of its own transcript read. That read is also how the 2026-09-29 echo happened — see the last section."
source: inference
---

# Credential echoes in session output: two flagged, both rotated

**Two echoes were flagged, both on 2026-08-26, both the production DB password, both rotated.** The
founder called the second "the second occurrence". No third _flagged_ incident is recorded
anywhere. Unflagged echoes existed before the "three times" line was written, so that count may
have included one of them. Its basis is unknown.

`source: inference` covers the CARRIED parts of the method: reading incidents out of transcript
text rather than out of a vault note, because none existed.

## The two flagged

The details below are CARRIED (see the method); the two founder quotes are MEASURED.

1. **2026-08-26, session `908c563b`.** A command meant to find the new project ref "without exposing
   secrets" printed the DB password, because its redaction missed the direct-connection URL shape.
   The session said so and advised "Rotate it when convenient". The founder replied that he was
   rotating the database password now.
2. **2026-08-26, session `561bb0a4`.** The replacement DB password was printed in a task report,
   while the report showed that the brackets around it were not part of the value. The founder
   wrote "compromised again … This is the second occurrence" and rotated it. Commit `3e443d3`
   (2026-08-26) turned this into CLAUDE.md's credential rule and records it as the second
   occurrence.

## Where the counts in the tree come from

- **CLAUDE.md, "second" and then "twice".** From `3e443d3`. This matches the two above.
- **`docs/08-supabase-project-rebuild.md:522`, "two rotations".** Added in `434eb48` (2026-09-11).
  It repeats CLAUDE.md.
- **`docs/07-worker-box.md:431`, "enforce twice".** Added in `ec0a324` (2026-09-21). It repeats
  CLAUDE.md.
- **`state-of-play.md`, "echoed in session output three times".** First written in `90828f4`
  (2026-08-27).
  - No third flagged incident is recorded.
  - An unflagged one predates that line: the `HEYGEN_API_KEY` in a transcript last modified
    2026-08-20, per the table below.
  - The count may therefore have been right on the rule's own test. Not resolved.

## Echoes nobody flagged

The rule's test is "appears anywhere in a transcript". On that test there are more. The 2026-09-29
script found these **current** values in local transcript files:

| Key                             | Transcript files | Last-modified    |
| ------------------------------- | ---------------- | ---------------- |
| `DATABASE_URL` (the password)   | 3                | 08-31 → 09-28    |
| `SUPABASE_SERVICE_ROLE_KEY`     | 2                | 09-11 → 09-20    |
| `ANTHROPIC_API_KEY`             | 2                | 09-20            |
| `ELEVENLABS_API_KEY`            | 2                | 09-20            |
| `FAL_KEY`                       | 2                | 09-20            |
| `HEYGEN_API_KEY`                | 3                | 08-20 → 09-20    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 2                | public by design |
| `SENTRY_DSN`, `SUMIT_API_KEY`   | 0                | —                |

- **Status.** Under CLAUDE.md's rule, each non-public value above is burned and has to be rotated.
  The rotation is owed and pending the founder; `state-of-play.md` tracks it.
- **Likely cause, REASONED.** A research subagent reported greps over the repo root that read the
  gitignored `.env` files. That comes from the agent's account and is not re-measured here, because
  re-reading the transcripts is itself the hazard.

## 2026-09-29: one more, during the research for this note

A research subagent scanned transcripts for this count and printed the founder's app-account
password into its own tool output. The founder had typed that password into a chat on 2026-08-27.
The agent's redaction pattern did not match the password's shape. The password is burned under the
rule.

**The lesson:** never point an agent at session transcripts. The safe form is count-only greps and
name-and-count scripts, as in the MEASURED part of the method.
