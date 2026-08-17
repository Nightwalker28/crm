---
name: frontend-design
description: Use when frontend work changes the design system rather than consuming it — a new page archetype, a new primitive's visual contract, a restyle that touches more than one screen, or any sub-phase of the rebuild programme. For building UI inside the existing system, use frontend-change instead.
---

# Frontend Design

Use this when the work **changes how Lynk looks**, not when it builds a screen inside the
existing language. The boundary is `design.md` §1.1:

> A change that touches more than one screen's *structure* is not a design fix, it is a
> redesign, and it needs to be proposed before it is built.

| Situation | Skill |
|---|---|
| New page in an existing archetype, new module list, new form | `frontend-change` |
| New archetype, new shared primitive, a restyle across screens, a rebuild sub-phase | **this one** |
| Not sure | Read `design.md` §1.1 and §12. If you would have to *change* a rule to ship it, it is this one. |

---

## 1. The brief is already written. Read it before you design anything

`docs/design/` is the brief. It is unusually complete, and most of what a designer would
normally decide is **already decided and not open for revision**.

| Read | For |
|---|---|
| `design.md` | The design language. Principles, colour policy, the type ladder (§3.3), the panel taxonomy (§1.3), written geometry (§4.4), **the five archetypes (§4.7)**, states (§7.4), a11y floors (§8) |
| `tokens.md` | Every token, both themes, and how light is derived from dark in OKLCH |
| `rebuild.md` | **The active programme.** Rulings R1–R10, the sub-phase index, the testing policy |
| `rebuild-census.md` | Which sub-phase owns which of the 327 files |
| `consistency-pass.md` | What already landed in Phases 0–4, and the audit measurements |

### Pinned — do not spend design effort here

These were decided by the owner and are not up for revision (`rebuild.md` scoping
decision 1):

- **No brand accent.** Colour appears only for status, destructive intent and chart series.
  Primary actions are a neutral high-contrast fill (§1.2, §2.2).
- **Inter only.** No display face, no secondary sans. `.font-lynk` is the wordmark, never
  product UI (§3.1).
- **Density is a feature.** 14px body, tight spacing, a row over a card (§1.5).
- **Dark is the default**, and light is the same palette at a different weight, derived by
  holding OKLCH hue and chroma (§1.4, `tokens.md` §4).
- **The hive is a brand device**, confined to auth, splash and the dashboard backdrop (§9).

A proposal that reaches for a colour, a second typeface or more whitespace has not read
the brief. The interesting constraint here is that the personality has to come from
**structure, rhythm and ink** — which is where the remaining design work lives.

### Open — where design effort belongs

Composition. Page archetypes, panel language, form layout, record structure, button
hierarchy, section headings, and the voice of the states.

---

## 2. Process

Two passes. Do the thinking in your head or in a scratch file; show the owner a proposal
only when you have confidence it will land.

**Pass 1 — brainstorm and plan.** Produce a compact plan covering the axes the brief
leaves open. For Lynk that is almost never colour or type *choice* — it is:

- **Structure.** Which archetype does this belong to? If none, why does a sixth exist?
- **Hierarchy.** Which type roles (§3.3) carry it? Remember the ladder steps *down*: a
  section heading is quieter than the values under it.
- **Containers.** Which of panel / ink group / row (§1.3)? A box is earned by
  interactivity or by separation, never by grouping.
- **States.** All four data-view states and all four interaction states, from the
  composition, not re-implemented (§7.4).

Use ASCII wireframes to compare layouts before writing any CSS. They are cheap and they
make a structural disagreement visible in one screen.

**Pass 2 — critique the plan before building it.** Apply the calibration test:

> **Would I have produced this for any CRM?**

If yes, revise, and say what changed and why. A left rail on a CRM is ordinary; a left
rail that *is the editable surface of the record* is specific to Lynk, because R1 and R2
are. That is the difference between a layout and a decision.

Work **at least two alternatives** before committing to anything structural, and record
the rejected ones with their reason. `rebuild.md` §5.0 is the worked example — the record
spine was chosen over two others, and four candidate signatures were rejected in writing.

**Then build, following the revised plan exactly.**

---

## 3. Write the rule before you write the code

`design.md` §12 is a hard requirement, not a courtesy:

> If a change contradicts a rule here, the rule changes first, in the same PR, with the
> reason written down. Future agents read this file, not the PR description.

So a design slice lands in this order:

1. The rule, into `design.md` (and `tokens.md` if the vocabulary grows).
2. The primitive that supplies it.
3. The call sites that adopt it.
4. The guard that keeps it (`check-design.sh` for source-level, `design-rules.spec.ts` for
   rendered).

**Order matters and is the repeated lesson of this codebase.** `design.md` §4.4 specified a
`space-y-6` section stack for a year and **one** of 27 page roots used it — not because
anyone ignored it, but because no primitive supplied it and no guard checked it. A rule
with no default behind it does not survive contact with the next page.

If you are working a rebuild sub-phase, update `rebuild-census.md` in the same change.
**A sub-phase is not done while a row it owns is unmarked.**

---

## 4. Restraint

- **Spend the boldness once.** One signature element per surface; everything around it
  quiet. Lynk's is the record spine (R9).
- **Reuse before extending, extend before adding.** 54 primitives exist. A new visual
  pattern is a signal to extend one, not to style a div (§0).
- **Cut a decoration that carries no information.** `Pill` was deleted because a capsule
  with a border, a tint, a blur and a noise overlay communicated nothing that ink could
  not — hundreds of times per table (R5).
- **A cleanup that makes a screen more correct and less itself has gone wrong.** §9 records
  a "fix" that replaced the honeycomb with three linear-gradients — a *triangular* lattice
  at invisible contrast — and passed every grep and every assertion.

---

## 5. Verification — the browser is on the exit criteria

Run the standard gates (`release-verification` has the full list):

```bash
./scripts/check-design.sh                       # run at the START of a slice as well as the end
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run build
docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1
```

**And then look at it.** This is not optional padding. In consistency-pass Phase 3, lint,
typecheck, build, the source guard, both rendered guards and 99 module specs were **all
green with a real bug in the tree** — a sticky column that failed to occlude, visible only
on a table wide enough to scroll sideways. It needed a browser, a sideways scroll, and
someone looking.

For any design slice:

- **Both themes**, every changed screen. Nothing invisible, nothing changing identity.
- **One narrow viewport (768px)** per area. Lynk is not becoming responsive; this is a
  regression check that a gutter did not break.
- **Tab through it.** The focus point must be visible at every stop (§2.3, §8).
- **Screenshot before and after** where a change is global and invisible to assertions.

Two checks are mandatory and cannot be delegated to an assertion:

- the honeycomb still renders as a honeycomb after any `/auth` change (§9);
- a tab-through of a rebuilt record page, focus visible at every stop.

Seed first or detail routes are unreachable:

```bash
docker compose exec -T backend python -m scripts.seed_demo_crm --tenant-slug default
docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
```

Run-shape traps already paid for once: a cold run reports sales lists unreachable — warm
the routes first; parallel runs add a dozen timeout failures that vanish serially. Judge on
`--workers=1`, and read `docs/e2e-suite-status.md` before treating a red as new.

---

## 6. Known baseline

`./scripts/check-design.sh` fails **2 of 14 rules at HEAD**. "Green" means *no new failures
and this slice's own rules cleared*, not a clean run. §7.2 (`@headlessui/react`) closed in
rebuild 5.1 batch D — `dialog.tsx` and the import/export `Menu` call sites moved to Radix:

| Failing rule | Site | Owner |
|---|---|---|
| §4.1 spacing on the 4px grid | `LynkSplash.tsx:58` — `pl-[0.2em]` | rebuild 5.9 |
| §4.2 no call-site control heights | `ClientPageCreateForm.tsx:335` — `size-6` | rebuild 5.8 |

---

## 7. Keep the two agent copies in sync

This repo is used with both Claude Code and OpenAI Codex, and the operational rules exist
twice: `.claude/skills/` and `.codex/skills/`. They are kept in sync by hand. **If you
change one, mirror the change in the other in the same commit.**
