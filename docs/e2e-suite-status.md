# E2E Suite Status

**Current: 299 of 300 pass** — rebuild 5.10 close-out, 2026-09-25. The full suite ran
293 / 7 at `--workers=1`, and the six in-scope failures were then fixed and re-run with their
whole spec files. **The one failure left is `support-revamp`**, which is out of the rebuild
programme (`docs/design/rebuild.md` scoping decision 8). Every failure from the 5.10 *before*
run (210 / 90) was read against a page snapshot and fixed in the code or the spec. Each fix is
listed in `rebuild.md` 5.10 batch 3. **Treat any new red as new.**

**How to run it without losing the run to memory.** The dev server keeps every compiled route
in memory, and warmed across the whole app it sits near 6 GiB. Under a container memory cap
it gets OOM-killed partway, and every later test then fails on `ERR_CONNECTION_REFUSED`: a
wholesale failure that says nothing about the code. Run the suite in three parts of about 20
spec files. Recreate `frontend` before each part (`up -d --no-deps --force-recreate frontend`),
and warm only the routes that part's specs `goto`. Check `docker inspect crm-frontend-1
--format '{{.State.OOMKilled}}'` before reading any wholesale failure.

The sections below are the history from before 5.10. Their groups were written against
causes, and all of them are now fixed.

This is a working document for picking the failures back up later. Each group below records what
was actually observed, how confident the root cause is, and what the fix looks like. Groups are
ordered by how mechanical the fix is, not by count.

## Before you run it

Two environment facts cost real debugging time this session. Both will mislead you again.

**Warm the routes first.** The frontend container runs `npm run dev`, so Next compiles each route
on first request — 11–29s against a 30s test timeout. A cold server does not fail honestly; it
fails as `page.goto` timeouts scattered across unrelated specs. Warming every dashboard route
takes ~51s and turns the run into real signal:

```bash
cd frontend && find app/dashboard -name 'page.tsx' \
  | sed 's|^app||; s|/page.tsx$||; s|/\[\[\?\.\?\.\?\.\?[^]]*\]\]\?|/1|g' | sort -u \
  | xargs -P 4 -I{} curl -s -o /dev/null \
      -H 'Cookie: lynk_access_token=warmup; lynk_refresh_token=warmup' "http://localhost:3000{}"
```

The dummy cookies exist only to get past `proxy.ts`, which checks cookie presence, not validity.
Without them every request 307s to the login page and nothing compiles.

**A green `design-rules` run is not necessarily a complete one.** The spec discovers every
`/[id]` and `/[id]/edit` route by finding a row link on each list page, and it prints
`Audited N routes. Unreachable: …` before asserting. Until 2026-08-20 it waited a flat 1500ms,
and on a loaded box the largest lists (contacts, organizations, opportunities, POS, leads) had
not painted a row by then. Four runs on 2026-08-20 gave **82 routes / 5 unreachable**, **90 /
2**, and **94 / 0** — same server, same warm-up. It waits for `tbody tr` now. **Read the
`Unreachable:` line either way**: anything listed there took its record and edit routes out of
the audit with it, and the run still passes.

**Postgres is remote and it drops.** The database lives off-box. One run this session produced 14
failures that were all `psycopg2.OperationalError: server closed the connection`, surfacing as
`Expected login to reach the dashboard or MFA challenge`. Before believing a batch of login
failures, check `docker compose logs backend | grep OperationalError`.

Run serially — `--workers=1`. Capture to a file; do not pipe through `tail` or `grep` as the only
sink, or you will read the exit code of the pager instead of Playwright's.

```bash
docker compose run --rm frontend-e2e npm run test:e2e -- --workers=1 --reporter=list > run.log 2>&1
```

Playwright writes `frontend/test-results/` as root, and that directory is git-tracked. Clean up
with `docker compose run --rm --entrypoint sh frontend-e2e -c "chown -R 1000:1000 /app/test-results"`
then `git checkout -- frontend/test-results && git clean -fdq frontend/test-results`.

## Group 1 — `getByRole('alert')` also matches Next's route announcer

**4 failures. Cause confirmed. Fix is mechanical.**

Next renders `<div role="alert" aria-live="assertive" id="__next-route-announcer__">` — empty, but
it satisfies the role — so any bare `getByRole('alert')` is a strict-mode violation on every page.

- `automation-builder-revamp.spec.ts:59` — shows distinct loading, error, and empty rule-list states
- ~~`contacts-revamp.spec.ts:112`~~ — fixed 2026-08-12 during the Contact/Organization rollout. It
  needed three fixes, not one: the announcer, then `getByLabel("Email")` also matching the
  "Email opt-out" checkbox, then a stale `button "Lynk QA"` for what is now `role="option"`. Expect
  the same layering elsewhere in this group — clearing the alert only exposes the next assertion.
- `payments-revamp.spec.ts:122` — Payment recording hides backend failure details
- `settings-modules-revamp.spec.ts:209` — shows blocked teams and preserves the draft when a concurrent department change rejects save

Fix: target the form's own error slot instead. Already applied in `leads-revamp.spec.ts`:

```ts
await expect(page.locator('[data-slot="field-error"]')).toHaveText("Email is required.");
```

For page-level alerts that are not field errors, scope to the container the alert belongs to
rather than adding `.first()` — ordering is not guaranteed.

## Group 2 — `role="dialog"` has no box to be visible by

**2 failures. Cause confirmed. Fix is mechanical.**

Headless UI puts `role="dialog"` on its root element, which carries only `relative z-50`. Every
child is `position: fixed`, so the root has a zero-size bounding box and Playwright reports it
`hidden` even though the dialog is on screen and correctly named. This is normal Headless UI
structure, not an accessibility defect — screen readers use the accessibility tree, not layout.

- `settings-modules-revamp.spec.ts:93` — dialog "Discard module changes?" received `hidden`
- `settings-modules-revamp.spec.ts:132` — dialog "Discard module access changes?" received `hidden`

Fix: keep the dialog-scoped locator, assert visibility on the titled panel inside it. Already
applied in `message-templates-revamp.spec.ts`:

```ts
const dialog = page.getByRole("dialog", { name: "Discard module changes?" });
await expect(dialog.getByRole("heading", { name: "Discard module changes?" })).toBeVisible();
```

## Group 3 — the shell header now duplicates page names

**3 failures. Cause confirmed. Contains a real product question — do not just fix the tests.**

The dashboard shell header gained an `<h1>` naming the open page (`app/dashboard/layout.tsx:138`,
commit `0ac016b`). Pages that still render their own heading now expose two headings with the same
accessible name.

- `booking-links-revamp.spec.ts:67` — header `<h1>Booking Links</h1>` + page `<h2>Booking links</h2>`
  (note the casing differs, so this is also a copy inconsistency)
- `profile-revamp.spec.ts:28` — header `<h1>Profile</h1>` + page `<h1 class="sr-only">Profile</h1>`
- `users-revamp.spec.ts:246` — expects heading "User Management"; the header names the page from
  `SETTINGS_NAV_ITEMS`, which calls it "Users"

**The product question:** now that the shell names every page, a page-level `sr-only` h1 repeating
that name is redundant for screen reader users too, not just for the tests. The `profile` case is
a genuine duplicate announcement. Decide whether pages should drop their own heading, and settle
whether "Booking Links"/"Booking links" and "Users"/"User Management" should agree. Fix the tests
to whatever that decision is — do not paper over it with `.first()`.

## Group 4 — ambiguous locators, one element per intent

**8 failures. Causes visible in the log. Each needs a judgement call about which element is meant.**

These resolve to 2–3 elements because the same text legitimately appears more than once. The fix is
per-case: name the element the assertion is actually about, the way `support-revamp` now asserts the
linked requester rather than the plain summary tile.

| Spec | Locator | Resolved |
| --- | --- | --- |
| `application-shell-refactor.spec.ts:43` | `link "Create lead"` | 2 — page action + data-table action |
| `auth-dashboard.spec.ts:44` | `button "Finance"` | 2 |
| `backups-revamp.spec.ts:149` | `button "Delete"` | 2 |
| `booking-links-revamp.spec.ts:115` | `button "Discovery call"` | 2 |
| `client-portal-revamp.spec.ts:47` | `getByLabel("Customer")` | 2 |
| `client-portal-revamp.spec.ts:80` | `button "Publish"` | 2 |
| `fields-revamp.spec.ts:124` | `button /Contract Term/` | 2 |
| ~~`opportunities-revamp.spec.ts:21`~~ | ~~`button "Table"`~~ | **Fixed.** It asserts `role="radio"` now — the segmented control's real role. Passing as of 2026-08-20 |
| `payments-revamp.spec.ts:56` | `getByText("Paid", { exact: true })` | 2 |
| `permissions-revamp.spec.ts:194` | `getByText("Sales", { exact: true })` | 2 — sidebar nav group + the table's module-group row |
| `profile-revamp.spec.ts:146` | `getByText("MFA enabled")` | 2 |
| `users-revamp.spec.ts:364` | `getByText("Custom domains")` | 2 — heading + "No custom domains yet" |

`permissions-revamp.spec.ts:194` was added on 2026-08-13. It is not in the 2026-08-11
snapshot above but reproduces on a stashed, route-warmed HEAD, so it is pre-existing rather
than new — worth stating because it is the one failure in that batch that touches a file the
Phase 2 primitive pass had edited, which is exactly the shape of a false attribution.

Watch for the `getByLabel` trap specifically: it is substring and case-insensitive by default, and
it matches `aria-label` on any element, not just form controls. `getByLabel("Tags")` matched a chip
container labelled "Selected tags" this session. `{ exact: true }` fixes that class.

The `mail-revamp` pair was cleared on 2026-08-12 and shows both shapes of the fix. `getByLabel("To")`
was also matching the Next.js dev-tools button — `aria-label="Open Next.js Dev Tools"` contains
"To" — so naming the role (`getByRole("textbox", { name: "To" })`) excluded it. `button "Cancel"`
matched the page behind the confirmation as well as the confirmation itself, so the assertion now
scopes to `getByRole("dialog", { name: "Disconnect IMAP/SMTP?" })`. Both are product-neutral: the
markup was already correct, the locators were not.

## Not in the groups below: `primitive-behaviour.spec.ts:13`

Observed failing on a clean tree on 2026-08-12 and **absent from every group in this document**, so
it was never triaged. "record tabs support the ARIA tabs keyboard pattern" navigates to the real
`/dashboard/sales/contacts/23` and finds that ArrowRight leaves `aria-selected` unchanged
(`["true","false","false","false","false","false"]` before and after). Confirmed pre-existing by
stashing an unrelated working tree and reproducing. Worth checking against the Radix `RecordTabs`
rebuild in `docs/design/design.md` 7.2 before assuming it is test debt — the spec exists precisely
because that keyboard pattern was broken once already.

## Cleared 2026-08-20 during rebuild 5.5's close-out — two specs asserting a moved contract

Both were found by a full serial run on the post-5.5 tree, both reproduced on a stashed
pre-5.5 frontend, and both were **specs asserting something an earlier sub-phase moved** —
which the rebuild testing policy says to update rather than leave red.

**`foundation-revamp.spec.ts:26` — "table density preference persists and updates shared
tables". Was in no group in this document.** It timed out on
`getByRole("button", { name: "Compact table density" })` with the locator matching nothing —
the Group 5 signature, but not on Group 5's list. The cause is not a missing element:
`TableDensityToggle` is a `SegmentedControl`, which is a Radix ToggleGroup with
`type="single"`, so the group is a `radiogroup` and each segment is a **`radio`**. The spec
was written against whatever preceded that primitive and has matched nothing since. Asserting
`role="radio"` passes, and it is the more useful assertion — the ARIA role is the contract a
screen-reader user actually gets.

**Generalised, and the remaining instances are named.** Every `SegmentedControl` in the app is
a Radix ToggleGroup with `type="single"`, so **every** segment is a `radio`. A sweep of the
suite found exactly three call sites and two still to fix:

| Spec | Line | Locator | State |
| --- | --- | --- | --- |
| `foundation-revamp.spec.ts` | 32, 41 | `button "Compact/Comfortable table density"` | **Fixed** 2026-08-20 |
| `opportunities-revamp.spec.ts` | 42–43 | `button "Table"/"Pipeline"` | **Already fixed** — asserts `radio`, passing |
| `automation-builder-revamp.spec.ts` | 104, 128 | `button "Rules"`, `button "Runs"` | **Open** — `app/dashboard/settings/automation/page.tsx:135-136` |

The `automation-builder` pair was **not** fixed speculatively: both tests die earlier, at
`:98` and `:126`, on the Group 5 `getByLabel('Name', { exact: true })` signature, so changing
the role could not be verified to help. Fix it when Group 5 is cleared — and note the second
hazard there, `page.tsx:151` renders a real `<Button>` also named "Rules" (the back control in
the runs workspace), so `getByRole("button", { name: "Rules" })` is ambiguous as well as
wrong.

**`catalog-revamp.spec.ts:397` — the record archetype's Files tab.** Asserted
`"No documents are linked to this record yet."`, which **5.3 batch 7 renamed** to `"Files
uploaded here stay linked to this record."` and did not update here. Deliberate copy change
(the panel's empty text was shortened while `RecordTable` still laid its empty state out
across the table's scroll width), so the spec was updated to the string the panel renders.
5.5 batch 1 has since fixed the underlying layout defect.

## Group 5 — interaction timeouts, and seven of them are `RequiredMark`

**16 failures. Seven now have a confirmed cause (below); the other nine are still open.**

Every one is a `locator.fill`/`locator.click` that times out with the element never resolving
(`element is not visible` was false in all 16 — the locator matched nothing at all).

Seven of them share a striking signature — `getByLabel('Name'/'Label', { exact: true })`:

- `automation-builder-revamp.spec.ts:75`, `:93` — `getByLabel('Name', { exact: true })`
- `booking-links-revamp.spec.ts:98` — `getByLabel('Name', { exact: true })`
- `fields-revamp.spec.ts:163` — `getByLabel('Label', { exact: true })` (was `:161` before rebuild 5.6 batch 6b)
- `module-builder-revamp.spec.ts:132`, `:163`, `:182` — `getByLabel('Label', { exact: true })`

**Cause CONFIRMED 2026-09-15, during rebuild 5.6 batch 6's close-out. It is `RequiredMark`,
and the earlier command-palette hypothesis is wrong.** The probe that settled it, run against
the `fields` create panel:

```
{"ariaLabel":null,"ariaLabelledby":null,"labelText":"Label *"}
getByLabel("Label", { exact: true })   → 0
getByLabel("Label")                    → 1
getByLabel("Label *", { exact: true }) → 1
```

No `aria-label`, no `aria-labelledby` — so it is not `9ad2553`'s defect and there is nothing
wrong with the accessible name. `<FieldLabel>Label <RequiredMark /></FieldLabel>` renders
`<span aria-hidden="true">*</span>`, and `aria-hidden` removes the asterisk from the
**accessibility tree** but not from the label element's **text**. Playwright's `getByLabel`
matches on that text, so the label reads `"Label *"` and `exact: true` can never match it.

**This is a test-side fix, not an accessibility one.** Every required field in the app carries
a `RequiredMark`, so `getByLabel(<name>, { exact: true })` is unusable on all of them — which
is why the seven failures share one signature and why they are all on required fields. Three
shapes of fix, in order of preference:

```ts
await page.getByLabel(/^Label/).fill("…");          // anchored, still rejects "Display label"
await page.locator("#create-field-label").fill("…"); // the field already has an id
await page.getByLabel("Label *", { exact: true });    // works, but asserts a decoration
```

Do **not** "fix" this by removing `RequiredMark` or its `aria-hidden` — the markup is correct
(design.md §7.5), and the asterisk must stay out of the accessibility tree.

**Not applied.** Batch 6 confirmed the cause during its own attribution run and deliberately
left the seven tests red: they were red before it and fixing them is this document's triage
work, not a design batch's. The remaining nine timeouts below are untouched by this finding.

The other nine timeouts, cause unknown:

- `automation-builder-revamp.spec.ts:114` — `button "Duplicate"`
- `command-palette-actions.spec.ts:285` — `getByText("Create team", { exact: true })`
  (this spec passes 19/19 standalone; suspect order-dependence or shared state)
- `export-controls-revamp.spec.ts:84` — `button "Export CSV"`
- `export-controls-revamp.spec.ts:109`, `:158` — `button "Export"`
- `users-revamp.spec.ts:183` — `getByLabel("Issuer URL")`
- `users-revamp.spec.ts:203` — `combobox "Default role"`
- `users-revamp.spec.ts:321` — `row /Amina Silva/`
- `view-manager-revamp.spec.ts:91` — `button "Add Last Name"`

## Group 6 — content never rendered, needs individual triage

**7 failures. No shared cause identified. Highest chance of hiding real product bugs.**

Each of these is an element the app did not render. Two of the three product bugs found this
session presented exactly this way, so treat them as suspects rather than test debt until proven.

- `automation-builder-revamp.spec.ts:137` — `getByText('Sales Leads automation')` not found
- `calendar-revamp.spec.ts:84` — `getByText('Customer renewal review').first()` received `hidden`
- `customer-groups-revamp.spec.ts:46` — `getByText('Percent discounts cannot exceed 100.')` not found
  (**a validation message — check this one first**, it is the same shape as the custom-module
  `noValidate` bug fixed in `1fd59c5`, where native browser validation blocked submit and the app's
  own message was unreachable)
- `foundation-revamp.spec.ts:9` — `button "Open navigation"` expected focused, received `inactive`
- `import-controls-revamp.spec.ts:42` — `heading "Import preview"` not found
- `payments-revamp.spec.ts:74` — `button "Clear filters"` not found
- `view-manager-revamp.spec.ts:141` — `getByText('2 saved conditions')` not found

## Two recurring test-authoring traps

Both bit multiple specs this session and will bite the remaining ones.

**Unqualified route globs swallow page navigations.** `page.route("**/tasks?**")` matches the
navigation to `/dashboard/tasks?action=create` and Next's RSC requests (`?_rsc=…`), answering them
with API JSON so the route never renders. Always qualify with `/api/v1`. Check any remaining spec
that stubs a path whose suffix is also a dashboard route segment.

**Seeding sessionStorage is not enough.** `useAccessibleModules` revalidates from
`/users/me/modules` and `useSidebarUser` from `/users/me`, then overwrite the cache. A spec that
seeds restricted permissions or a non-admin user but leaves those endpoints serving the real admin
will silently test the wrong thing. This produced two false permission-leak signals this session —
both specs were wrong, and the app does enforce permissions correctly. There is a second-order
version: signing in leaves an *in-flight* `/users/me` write that clobbers a seed applied too
quickly, so wait for it before seeding:

```ts
await expect.poll(async () => page.evaluate(() => sessionStorage.getItem("lynk_user")))
  .toContain('"is_admin":true');
```

## Known flaky

- ~~`application-shell-refactor.spec.ts:19` — "keeps the global search centered" observed
  fail/pass/pass across repeated runs.~~ **Fixed 2026-08-13.** Not flake in the usual
  sense: the spec read `boundingBox()` immediately after clicking Collapse, sampling a
  frame of the sidebar's declared 200ms width transition. Measured at 18.5px off at t=0,
  0.3px at t=100ms, 0 once settled — so whether it passed depended on how long two
  Playwright calls happened to take. Now polls for the settled value. Passes 3/3.
- `accounts-revamp.spec.ts` — "keeps shared controls usable on mobile" passed 3/3 in isolation
  after failing in a full run.
- `accounts-revamp.spec.ts:92` — "Account create, detail, edit…" hit the 30s test timeout in the
  2026-09-17 full run and passed alone in 14.5s (rebuild 5.7 close-out).
- `application-shell-refactor.spec.ts:19` — failed its 5s centring poll in the same full run and passed
  alone in 6.6s. The 2026-08-13 fix made it deterministic on an idle box, not on a loaded one.
- `command-palette-actions.spec.ts:287` — "routes administrator actions" passed in that full run and
  timed out at exactly 30s in a targeted re-run; it loads `/dashboard` four times in one test.
- `payments-revamp.spec.ts:74` — "distinguishes filtered empty results" observed
  **fail/pass/pass** in isolation on 2026-08-14, and passing then failing within the same
  session. Listed above under the unconfirmed-cause group as `button "Clear filters"` not
  found; the button is genuinely rendered. Dumping the DOM in that exact mocked state
  gives `buttonsInTable: ["Clear filters"]` with the filtered title above it, so the spec
  is asserting behaviour the product has. The likely mechanism is the un-debounced search
  (Appendix A.5 of `docs/design/consistency-pass.md`): filling "missing customer" fires a
  request per keystroke, so the empty-state row unmounts and remounts ~16 times while the
  locator is resolving. Fixing the debounce would probably retire this failure; changing
  the spec would only hide it.

## Cleared in rebuild 5.6's close-out (batch 8)

**Eight specs, all asserting a contract 5.6 deliberately moved. None was an app defect.**
Attributed the way the header of this document prescribes: the 49 specs failing at HEAD were
re-run against the pre-5.6 tree (`c9dd8d3`), and **41 also failed there**. The eight below
passed before 5.6 and failed after, so each one was read against the diff before being touched.

| Spec | The contract that moved |
| --- | --- |
| `teams-revamp:41` | Empty-state copy joined the house "… yet." idiom (batch 7b) |
| `teams-revamp:142` | `Organization structure` — a wrapper heading repeating the page name — was deleted (batch 7b); the departments are the headings now |
| `teams-revamp:166` | Panel titles are sentence case: `Create Team` → `Create team`, and the same again for `Create Department` |
| `customer-groups-revamp:140` | Batch 4a moved the state onto `RecordTable`'s `errorState`, whose titles carry no full stop — all six in the app agree |
| `general-settings-revamp:37` | `aria-label="Company settings workspace"` sat on a plain `Card`, so it was never an exposed landmark — only a test hook. Batch 7b replaced it with three real `FormSection` headings |
| `notifications-revamp:39` | **A9.** The fallback for a rejected external link moved from the admin-only activity log to `/dashboard`, which every role can reach. The test's subject — rejecting the external destination — is unchanged |
| `record-layouts-admin:112` | Batch 7c moved the collapse toggle onto `SegmentedBoolean` — a Radix `ToggleGroup type="single"`, whose segments are **radios**. This is the generalisation Group 5 asked for, arriving on schedule |
| `users-revamp:170` | **A8.** The settings rail links every destination from every settings page, and it renders inside `main`, so "no Authentication link on this page" is no longer sayable as a bare count. It now asserts the only such link is the rail's |

**A gap this exposed.** `frontend/tsconfig.json` excludes `tests/e2e/**/*`, and
typescript-eslint turns `no-undef` off because it assumes `tsc` covers it. So a spec can
reference an undefined variable and **neither `tsc --noEmit` nor `npm run lint` will say so** —
only a run will. One of the edits above hit exactly that and was caught by re-running, not by
either gate. Worth a cheap guard; filed to 5.10.

## Cleared in rebuild 5.7's close-out (batch 9)

**285 in-scope tests at `b0d3ff5`: 218 passed / 67 failed.** The 67 were re-run against the pre-5.7
tree (`9923ceb`) on the same dev server, specs at HEAD; **61 also failed there.** Six passed before 5.7:

| Spec | What it was |
| --- | --- |
| `tasks-revamp:61` | Ruling 7 — opening a board card keeps `?display=board` in the address. Spec updated |
| `dashboard-edit-mode-revamp:126` | Discard became a `useConfirm` dialog; the spec listened for a native `dialog` event. Spec updated |
| `command-palette-actions:268` | `PanelError` prints the message and *Check your connection…* separately. Spec updated |
| `custom-modules-revamp:94` | The dashboard summary's module names became links, so `link "Projects"` matched twice. Scoped to the sidebar |
| `accounts-revamp:92` | Load flake — passed alone at HEAD. See *Known flaky* |
| `application-shell-refactor:19` | Load flake — passed alone at HEAD. See *Known flaky* |

## Already fixed this session

For reference when reading the diff. Three were real product bugs, not test debt.

| Commit | What |
| --- | --- |
| `ad39c23` | **Product.** System-default saved views never re-derived from the module's current columns, so a view written before a column rename collapsed lists to a single column. Healed lazily on read; no backfill needed. |
| `9ad2553` | **Product.** Command palette search input had no accessible name — `cmdk` pointed `aria-labelledby` at an empty element, which overrode the `aria-label` already set. |
| `1fd59c5` | **Product.** Custom-module forms never ran their own validation: field inputs carry the native `required` attribute and the forms lacked `noValidate`, so the browser blocked submit and the "… is required." message plus focus handling were unreachable. |
| `9d35f18` | Specs asserting on table cells were reading the signed-in admin's real `user_saved_views` rows — mutable tenant state. Added `stubDefaultSavedViews`. |
| `3ea03bd` | Tasks/message-template specs: unqualified `**/tasks?**` glob, a click lost to an in-flight `router.replace`, an accessible name spanning two block elements, and settings headings that moved into the shell header. |
| `e054f74` | Ambiguous locators and stale fixtures across leads, support, documents. |

## Verification baseline

At the time of this snapshot, everything except the 45 above is green:

- Backend: 809/809 (`docker compose exec -T backend python -m unittest discover -s tests -p 'test_*.py'`)
- Frontend lint: clean · build: clean
- Generated contract drift: none (`./scripts/generate-contracts.sh --check`)
- The ten specs worked this session pass 81/81 together
