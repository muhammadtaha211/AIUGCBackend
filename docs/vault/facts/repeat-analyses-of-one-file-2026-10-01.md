---
type: fact
status: verified
verified: 2026-10-01
method: "Offline over the read-only export of 2026-10-01 (packages/core/.work/screen-span/: export.ts, then base.ts, agree.ts, vispix.ts; gitignored). Analysis screens are the shipped isNewScreen over each stored timeline; pages are the wizard's inventoryPages rule re-applied to the stored sections. 'Real' is the vision-judged screen segmentation of [[screen-spans-from-the-footage-2026-10-01]] (two independent passes, boundaries both agree on)."
source: db + code + inference
---

# Repeat analyses of one file: same moments, different screens and groups

**MEASURED**, except where a line says **REASONED** (the vision-judged truth). The files are those
of [[demo-recordings-by-file-and-take-2026-10-01]]. Four files were analysed more than once.

## Moments: identical, except where a batch dropped states

The box gives one file the same kept set every time, so the moments (the stored `timestampMs`
values) are the same. They are fewer only where the vision call never returned some states (S3,
`droppedMs`).

| file       | analyses | moments in all / union | why not all                                     |
| ---------- | -------: | ---------------------: | ----------------------------------------------- |
| `8b0dc639` |        4 |                51 / 60 | `1e66c926` holds 51: 9 dropped at transcription |
| `133a6304` |        2 |                53 / 53 | —                                               |
| `b25923dd` |        2 |                27 / 36 | `f6e343d1` holds 27: 9 dropped at transcription |
| `752bf15a` |        4 |                65 / 65 | —                                               |

On the moments every analysis holds, the vision model's own fields agree only partly:

| file       | `actionType` | `screenKind` | `legibility` | `sameStateAsPrevious` |
| ---------- | -----------: | -----------: | -----------: | --------------------: |
| `8b0dc639` |      35 / 51 |      24 / 51 |      41 / 51 |               47 / 51 |
| `133a6304` |      44 / 53 |      53 / 53 |      40 / 53 |               51 / 53 |
| `b25923dd` |      23 / 27 |      27 / 27 |      27 / 27 |               27 / 27 |
| `752bf15a` |      42 / 65 |      64 / 65 |      61 / 65 |               61 / 65 |

## Screen boundaries: mostly the same, and the differences include real changes

A boundary is the state that starts an analysis screen (shipped `isNewScreen`).

| file       | boundaries in all | of those: real / swap / split (REASONED) | in some only | per analysis   |
| ---------- | ----------------: | ---------------------------------------: | -----------: | -------------- |
| `8b0dc639` |            2 of 5 |                                2 / 0 / 0 |            3 | 3, 4, 3, 3     |
| `133a6304` |          14 of 14 |                               11 / 1 / 2 |            0 | 14, 14         |
| `b25923dd` |           9 of 14 |                                8 / 0 / 1 |            5 | 10, 13         |
| `752bf15a` |          12 of 16 |                                6 / 3 / 3 |            4 | 14, 13, 15, 16 |

The boundaries only some analyses have (REASONED: real / swap / split by the footage):

- **`752bf15a`.**
  - The real landing-page → app-home change at 6.8 s is cut by `fc30dc8e` alone; the other three
    keep states 8 and 9 on one screen.
  - The real change at 14.0 s (character grid → hook clips) is missed by `4219e82e` alone.
  - Two splits with no screen change, at states 15→16 and 29→30, are in three of the four.
- **`8b0dc639`.**
  - The real change at 29.8 s (home → results) is cut only by `1e66c926`. All four hold the same
    two states around it, at 29.0 s and 30.2 s. Only `1e66c926`'s labels for those two states
    trip `isNewScreen`, so the other three miss the change. Its 9 dropped states are 10–17 s
    later and play no part.
  - Two splits with no screen change are in some analyses only.
- **`b25923dd`.** Four of the five differences sit where `f6e343d1` holds no states at all. Its 9
  dropped states leave 41.2–64.2 s with no moment: three real changes, and two whole real
  screens. The fifth is a split in `f6e343d1` only.

## Groups (wizard pages): the analyses of a file page it differently

| file       | page starts (s) per analysis                                 |
| ---------- | ------------------------------------------------------------ |
| `8b0dc639` | 14.0 31.0 43.4 · 14.0 30.2 48.8 · 14.0 31.0 45.0 · 12.4 42.0 |
| `133a6304` | 21.4 49.0 66.0 · 24.8 50.6 73.4                              |
| `b25923dd` | 17.2 24.6 64.2 · 6.6 24.6 64.2                               |
| `752bf15a` | 8.0 60.8 · 11.4 32.2 60.8 · 8.0 32.2 45.6 · 8.0 32.2 45.6    |

Each cell is the time of the first moment on each page after the first.

- **Shared boundaries.** Only `b25923dd` has page boundaries that every analysis of the file
  shares, at 24.6 s and 64.2 s.
- **Partly shared.** Some boundaries recur in three of four analyses, never all four:
  `8b0dc639`'s 14.0 s, and `752bf15a`'s 8.0 s and 32.2 s.
- **None shared.** `133a6304`'s two analyses share none.
- **Identical pagings.** `6658999c` and `fc30dc8e` page `752bf15a` identically.
- **Page counts.** Within one file the page count runs from 3 to 4.

## Across one take, three files (T3)

`08b93a8a`, `bd0005b0` and `91c89b65` are three exports of one take. Before 47 s they hold 34
moments each and 8, 6 and 7 analysis-screen boundaries.

- **REASONED:** the real changes at 7.4, 11.2, 12.0, 22.4 and 28.8–29.0 s are in all three.
- The splits vary: 6.3 s is in all three, 18.4 s in two (not `bd0005b0`).
- `08b93a8a` alone also cuts at 40.8 s. That is the script step's in-place swap, generating →
  ready, which vision lists in all three files.
