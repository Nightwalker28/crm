# E2E Suite Status — 43 Remaining Failures

Snapshot taken 2026-08-11 from a full serial run on `docs/crm-evolution-2026-plan`, with the
two `mail-revamp` locator failures cleared on 2026-08-12.

**201 passed / 43 failed**, up from 159 passed / 85 failed at the start of the 2026-08-11 session.

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
| `opportunities-revamp.spec.ts:21` | `button "Table"` | 3 |
| `payments-revamp.spec.ts:56` | `getByText("Paid", { exact: true })` | 2 |
| `profile-revamp.spec.ts:146` | `getByText("MFA enabled")` | 2 |
| `users-revamp.spec.ts:364` | `getByText("Custom domains")` | 2 — heading + "No custom domains yet" |

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

## Group 5 — interaction timeouts, likely one shared cause

**16 failures. Cause NOT yet confirmed — this is the group worth investigating first.**

Every one is a `locator.fill`/`locator.click` that times out with the element never resolving
(`element is not visible` was false in all 16 — the locator matched nothing at all).

Seven of them share a striking signature — `getByLabel('Name'/'Label', { exact: true })`:

- `automation-builder-revamp.spec.ts:75`, `:93` — `getByLabel('Name', { exact: true })`
- `booking-links-revamp.spec.ts:98` — `getByLabel('Name', { exact: true })`
- `fields-revamp.spec.ts:161` — `getByLabel('Label', { exact: true })`
- `module-builder-revamp.spec.ts:132`, `:163`, `:182` — `getByLabel('Label', { exact: true })`

**Hypothesis, unverified:** this is the same defect already fixed in the command palette
(`9ad2553`) — an input whose `aria-label` is overridden by an `aria-labelledby` pointing at an
element with no text, leaving the control with an empty accessible name. `aria-labelledby` wins
over `aria-label`, so the label in the source is ignored and `getByLabel` finds nothing. That bug
was invisible until a test looked for it, and it made the control unnamed for screen readers.

**Verify before assuming.** These fields may simply live inside an inspector panel that never
opened — `module-builder-revamp.spec.ts:163` clicks `button "Edit Priority"` first, and if that
button was renamed the panel never appears. Probe the real DOM:

```ts
console.log(await page.getByPlaceholder("…").evaluate((el) => {
  const lb = el.getAttribute("aria-labelledby");
  return { ariaLabel: el.getAttribute("aria-label"), lb,
           lbText: lb ? document.getElementById(lb)?.textContent : null };
}));
```

If `lbText` is empty while `ariaLabel` is set, it is the same bug and it is a real accessibility
fix, not a test fix.

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

- `application-shell-refactor.spec.ts:19` — "keeps the global search centered" observed
  fail/pass/pass across repeated runs. Not in this run's failure list.
- `accounts-revamp.spec.ts` — "keeps shared controls usable on mobile" passed 3/3 in isolation
  after failing in a full run.

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
