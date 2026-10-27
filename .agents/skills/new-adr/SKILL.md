---
name: new-adr
description: Write or supersede an architecture decision record (ADR) in docs/adr. Use when a significant decision — expensive to reverse, or likely to raise "why?" — is being made or needs recording, e.g. "write an ADR", "record this decision", "supersede ADR-0003".
---

# New architecture decision record

ADRs live in `docs/adr/`. Read `docs/adr/README.md` (process and index) and
`docs/adr/template.md` (structure) before writing.

## 1. Check that it deserves an ADR

- The decision is expensive to reverse, or likely to raise "why?".
- It is recorded before significant work depends on it, not after the fact.
- It covers one decision. If the draft decides two things, split it.
- Accepted ADRs are never edited. To change a decision, supersede it (step 6).

## 2. Number and file name

Take the highest `NNNN-*.md` in `docs/adr/` plus one, zero-padded to four digits.
Name the file `NNNN-<short-kebab-title>.md` and start from `template.md`.

## 3. Content

- **Title:** the decision as a short phrase, e.g. "Use Jest as the unit test runner".
- **Status:** `Accepted` once agreed, `Proposed` while still open. **Date:** today.
- **Context:** the situation before the decision: the problem, the forces and
  constraints, and why it must be decided now. No "we will" here; that is the Decision.
- **Considered options:** two or three real alternatives, each with pros and cons.
- **Decision:** "We will use **X**, because …".
- **Consequences:** positive, negative and follow-ups. State trade-offs honestly,
  including when an option was chosen deliberately to practice a technology.

## 4. Review before writing

Show the full draft to the user and wait for approval. Write the file only after that.

## 5. Index

Add a row to the index table in `docs/adr/README.md`, then run
`pnpm exec prettier --write docs/adr` (it re-aligns the table). Check the new link.

## 6. Superseding

Write the new ADR as above; its Context explains what changed. Then make the one edit
an accepted ADR allows: set the old ADR's Status to
`Superseded by [ADR-NNNN](NNNN-title.md)` and update its row in the index.

## 7. Commit

Propose `docs: add ADR-NNNN on <topic>` and commit once the user agrees.
