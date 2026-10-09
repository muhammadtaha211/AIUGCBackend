# Spec template: one unattended run

Copy everything below the line, fill it in, and paste it as the first message of a cloud session
(`runbook.md`). Once you approve the plan, the run saves it verbatim to
`docs/unattended/runs/<date>-<slug>/spec.md`, and everything it does is checked against it. It
replaces the planning chat (vault 0096). Delete the guidance in italics as you fill each section.

---

# <Title: what this run builds, in one line>

Branch type: <feat | fix | docs | tooling | …> Slug: <short-slug>

## 1. Goal

_What is true when this run is done, in a few sentences. Say what it is for, not how to build it._

## 2. Decided

_Each decision the run must follow, numbered, each with its reason and whose reason it is (yours, or
planning's). The run never re-opens these. If the repo contradicts one, it stops and asks._

1. <decision>
   - **Reason (his | planning's):** <why>

## 3. Unverified: confirm first

_Claims the spec relies on that nobody has checked in this repo. The run checks each before it plans.
If one is false, it stops and asks._

- <claim>, from <where you read it>

## 4. Limits

_What the run must not touch: files, packages, prompts, migrations, dependencies, providers, copy._

- <limit>

## 5. Acceptance criteria

### List 1: a command or test proves it

_Every criterion names its proof: the exact command, or the test file and what it asserts. The run is
done only when the gate is green and the reviewer finds every item here PROVEN._

- **C1.** <criterion>. Proof: `<command>` <shows / exits / passes …>
- **C2.** …

### List 2: only you can judge it

_Hebrew copy tone, how a render looks, how a page feels. The run lists these in its report for you
and does not judge them._

- <item>

## 6. Paid-check cap: ₪<amount>

_0 means none: the run makes no paid call. Above 0, Claude calls are pre-approved up to this cap and
no other provider is (vault 0098). If the run needs paid checks, fill in the four lines below._

- **Shipped function to call:** <for example, `generateTextBlocks` in `packages/core/src/pipelines/copy.ts`>
- **Inputs, inline or committed:** <questionnaires, fixtures, clip rows. Paste them here or name
  committed files. A cloud clone has no `.work/` and no production database.>
- **Rows to seed in PGlite:** <what the function reads, for example a business, a questionnaire, a
  text_block_clips row>
- **Number of runs, and the worst-case cost per call:** <so the run can reserve before each call>

## 7. Shipping

_Whether the work needs a migration or the box, and in what order relative to the merge (vault 0039:
box first when new web code needs new core behaviour, box last when old web code must keep working;
a migration that new code needs goes first)._

- Migration: <none | which, and before or after the merge>
- Box restart: <none | needed, and before or after the merge>
- Anything else on your side: <env change, dashboard step, none>
