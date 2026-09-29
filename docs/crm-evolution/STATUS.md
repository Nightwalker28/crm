# CRM evolution — where the waves stand

The handover for `CODEX-RUNBOOK.md`: a new session reads this instead of reconstructing
progress from the code. Update it at the end of every wave run, including partial ones.

Last updated 2026-09-29.

| Wave | State | Evidence |
|---|---|---|
| 0A–0D | Done | Lead journey baseline, `QuickCreateSurface`, `record_layouts.py` resolver, generated contracts in `frontend/contracts/` |
| 1A–1B | Done | `LeadQuickCreate`, `RecordLayoutPreview` |
| 1C–1F | Done | `RecordWorkspace`, `record_activity.py`, `mail_associations.py`, `RecordEmailComposer` |
| 2A | Done | Contact and Organization Quick Create, contextual Account → Contact / Deal |
| 2B–2C | Done | `sales_opportunity_contacts`, `opportunity_participants_routes.py` |
| 2D | Done | Opportunity Quick Create (rebuild 5.4 A3); participant display and management |
| 2E | Done | Configurable pipelines: `sales_pipelines`, stage references, semantic business logic, stage pickers, settings page with add/reorder, board audit, saved-view display. See below | `sales_pipelines`, `pipelines_services.py`, `GET /sales/opportunities/pipeline`, `sales_opportunities.pipeline_stage_id`, `useOpportunityPipeline`, `OpportunityStageSelect`; inventory in `04a-stage-inventory.md` |
| 3A | Done (closed 2026-09-29): Lead, Contact, Organization and Opportunity runs; 05 backend Phases 3–4, frontend Phases 3–4. See below | `RecordEmailComposer` recipient candidates; `related_contact_ids` on `POST /mail/records/{module}/{id}/send`; `related_access` on the summaries |
| **3B onward** | **Not started — next is 3B** | |

## Wave 3A — closed (2026-09-29)

The rendered guards pass: `design-rules.spec.ts` audited 106 routes with none unreachable (8.0
minutes, run on a freshly restarted dev server), and `scroll-containers.spec.ts` passed earlier in the
wave. Getting there took four more audit runs, and each result was a real finding:

1. **Settings rail (A8) and six list routes unreachable.** The host was thrashing (load 11.4,
   `kswapd0` at 96%). A re-run on a quiet host did not repeat it. Environmental.
2. **R4, a real bug from this wave.** The deal header's Email was `size="sm"` (32px) beside the
   38px Edit. `RecordEmailAction` and `CommunicationActions` no longer hard-code a size, so every
   record header's Email, WhatsApp and Call are `default`, like the buttons beside them. The Lead,
   Contact and Account headers had the same mismatch, hidden from the guard because
   `CommunicationActions` wraps its buttons in its own row.
3. **A different set of lists "unreachable" every run.** A harness bug: `discoverRecord` waited for
   any `tbody tr` and resolved on `ModuleTableLoading`'s eight skeleton rows, so lists whose data
   came slowest were dropped. It now waits for a row with no `[data-slot="skeleton"]`.
4. **Deals unreachable on a cold server.** Deal rows have no link, so the audit opens one by click or
   Enter, then waited a fixed 1.8 s. The deal record route compiles on first visit and took longer.
   `waitForRecordUrl` now waits (up to 20 s) for the URL to become a record.

After the size fix the four record-email specs pass 13 of 13; lint is clean.

## Wave 3A — Opportunity run (2026-09-29)

Built to the owner's decision recorded under the Organization run below (Salesforce, Dynamics,
HubSpot: a deal's email is addressed to its participants and filed against the deal and each
of them). This also completes 05 frontend Phase 3 (contextual recipient selection).

**Verified first:** `record_activity._fetch_emails` does not filter on `association_type`, so a
`related` link already reaches the contact's Timeline. No adapter change.

Backend (`mail_services`, no schema or migration change):

- `MailRecordSendRequest.related_contact_ids` (optional, max 50). `_resolve_participant_recipients`
  checks each id before anything is claimed or sent: the source is a deal; the contact is on it
  (the legacy primary or an active participant, through the new shared
  `opportunity_contacts_services.is_contact_on_opportunity`, which `ensure_contact_on_opportunity`
  now uses as well); the contact is active, in this tenant and viewable by the sender
  (`resolve_link_target`); it has not opted out; and its address is actually among To/Cc/Bcc. Every
  "not on this deal" reason returns the same message.
- `_claim_outbound_message` writes each as a `related` association in the same transaction as
  the deal's `primary`, through the existing `upsert_association`. A typed address that
  belongs to no chosen participant files against the deal only. Nothing is linked because an
  address happened to match (the `mail_associations` invariant stands).
- `{{contact.*}}` from a deal resolves to the person the email is to: one chosen participant is
  that participant; several give the primary only if the primary is among them, otherwise nobody;
  with nobody chosen it falls back to the deal's primary, as before.
- `ContactCompactSummary.email_opt_out` (additive) so the deal summary's participants carry it.

Frontend:

- The deal header has **Email** again (`RecordEmailAction` with `recipientCandidates` from
  `participant_contacts`), shown only when the reader can view Contacts and at least one participant
  has an address and has not opted out. One such participant is prefilled. With several, To
  starts empty. The mailto fallback (no connected mailbox) follows the same rule.
- `RecordEmailComposer` lists the candidates under To as a **Participants** checklist, with role,
  "Primary contact" and the address. Ticking one writes its address into To and unticking removes
  it; To stays editable. Opted-out participants are listed, disabled, with "Opted out of email".
  An opted-out participant's address typed by hand is refused before the send. On send, the
  participants whose addresses are in the message go in `related_contact_ids`.
- design.md §4.7 is rewritten: the rule is now **"the message is filed against every CRM record
  whose address it uses"**, replacing "does this record own the address". The deal's rules and the
  CRMs behind them are written there. The `CommunicationActions` doc comment follows it. Account and
  Quote are unchanged: an account still emails its own address only, and a quote offers no channel.

Verification: `test_mail_contextual_send.py` 92 of 92. `OpportunityContextualSendTests` re-runs the
Lead contract from a deal and adds 17 cases: participants filed beside the deal and on each
contact's activity only when chosen; legacy primary without a row; typed non-participant → deal
only; a participant's address alone links nothing; not on the deal, removed participant,
recycle-binned contact, other tenant (same message), opted out, not a recipient, no Contacts view,
non-deal source are all refused before anything is sent; a repeated id is filed once; the three
`{{contact.*}}` cases. The backend suite passes 1226 of 1226 with Redis up. `verify_openapi` passes (362 paths),
compileall is clean, and `generate-contracts.sh --check` is up to date. Frontend lint and build are
clean; `check-design.sh` passes 21 of 21. `opportunity-contextual-email.spec.ts` (new, 5: several
participants → To empty, pick, payload names the pick, lands on the Timeline; untick removes the
address; one usable participant prefilled; a typed opted-out address refused; no usable participant
means no Email) passes 5 of 5. The lead, contact and account email specs, `opportunity-participants` and
`opportunities-revamp` pass 16 of 16. Browser pass: the composer screenshotted in both themes
(background `rgb(11, 13, 16)` → `rgb(247, 248, 250)`), and a real deal checked against the live API:
its participant carries `email_opt_out: false`, and with no connected mailbox the header shows the
mailto fallback with the single participant prefilled. No real email was sent.

The wave close is recorded in the section above.

Left open (added to Deferred): offering an account's contacts as recipients from the Account page
(owner: a separate follow-up); a manually typed address of an opted-out *non-participant*
contact is not checked (only candidates are known to the composer, and the server links by id
only).

**Next:** Wave 3B, README Wave 3 item 15: `06-whatsapp-business.md` Phase 1, which formalizes and
regression-tests the existing external `wa.me` mode. Check the Deferred table first.

## Wave 3A prerequisite — 05 frontend Phase 4: relationship rail on Contact and Account (2026-09-29)

The Contact and Account pages already had a spine **Connected** block and a **Related records**
tab. This phase finishes them against the filtered summaries from backend Phase 4.

- **A contact's deals carry its role.** Each row reads `Decision maker · Primary contact ·
  Proposal · closes Oct 1, 2026`: the role first, because it is what this page adds over the
  deal list, in the same words as the deal's own participant list.
- **A contact has Orders and Insertion orders** in the spine and the tab (the summary already
  carried both). The Contact page's hand-built cards were replaced by the shared
  `RecordRelatedList` the Account and Deal pages use.
- **Hidden vs none.** A section the reader may not view is **left out everywhere**: no card, no
  spine row, not even a zero. The page cannot tell "your role can't view quotes" from "quotes
  aren't enabled here" (`/users/me/modules` lists only role-visible modules), and Salesforce,
  HubSpot and Dynamics all omit inaccessible related lists silently, so a "hidden" notice was not
  added. "None" is a real empty state in the module's own words, and it offers the create
  action where one is allowed. Every section now follows `related_access`, including Deals and
  (on an account) Contacts, which used the module list only. The module list is still checked
  too, so a stale summary can't show a section after the role is revoked.
- **True totals.** `RecordRelatedCard` takes `total`. When the summary's count is higher than the
  rows it sends, the card says "Showing the 8 most recent of 12."
- **Contextual create:** Deal from a Contact; Contact and Deal from an Account (existing Quick
  Creates, now offered in the empty states as well). **Quote and Order creation stays on the Deal
  and the Quote**, following the major CRMs (Salesforce and HubSpot create quotes only from the
  opportunity; Lynk orders come from converting a quote). Tasks and Files keep the create
  actions their own tabs already had.
- Close dates are rendered through `formatDateOnly` (they were raw ISO).

Verification: lint and build are clean; `check-design.sh` passes 21 of 21.
`relationship-rail.spec.ts` (new, 4: role and primary on a contact's deals, true total on
orders, hidden sections absent from spine and tab, empty state with and without the create
right, account following `related_access`) passes 4 of 4. Browser pass: both pages screenshotted
in both themes (the body background changed from `rgb(11, 13, 16)` to `rgb(247, 248, 250)`, so both
themes were actually shown), plus one live contact against the real API (`Other · Primary contact · Lead
· closes Sep 14, 2026`; spine `Deals 1 ; Quotes 0 ; Orders 0 ; Insertion orders 1`). The page specs
`contact-contextual-email`, `organization-contextual-email`, `contact-organization-rollout`,
`accounts-revamp` and `contacts-revamp` pass 16 of 18 first time. `accounts-revamp` "shared
workflow" timed out once on the cold compile and passes 2 of 2 re-run. `contacts-revamp` "shared
workflow" fails on the **edit** form's Email field being empty, and fails the same way with this
change stashed (added to Deferred). Rendered design guards: run at the Wave 3A close.

## Wave 3A prerequisite — 05 backend Phase 4: relationship summaries (2026-09-29)

No new endpoint (01 §7: prefer the existing summaries). The Contact, Account and Deal
summaries (`summary_services.build_*_summary`) already carried related records, with four gaps:

1. **Leak.** They returned related deals, quotes, orders, invoices, insertion orders and (on an
   account) contacts whatever the reader's permissions. The pages hid some, but the API response
   carried everything. Now each section is checked with `related_access` (module availability
   plus the role `view` action, the `require_linked_record_access` bar) and a hidden section is
   **not queried**: empty list, zero count, `related_access.<section> = false`. No reader means
   nothing related. `_can_view_contacts` on the deal summary now goes through the same helper,
   and the deal's quotes and insertion orders are gated too.
2. **Counts were list lengths** (capped at 8–12). They are now true totals (`count()` on the same
   query); the lists stay the most recent few. The deal summary gains `quote_count`.
3. **A contact's deals** were only those with it as legacy primary. They now include deals it is an
   active participant on (removed links, deleted deals and other tenants' deals excluded, a
   corrupt cross-tenant link row matches nothing), each with `contact_role_key`,
   `contact_role_label` and `is_primary_contact`.
4. **A contact had no orders.** `related_orders` / `order_count` added, matched by the same rule
   as its quotes (its account or itself), so a quote and its converted order appear together.

All response changes are additive (`related_access`, the role fields, `related_orders`,
`order_count`, `quote_count` have defaults). The pages read `related_access` through
`lib/related-access.ts` (`canViewRelated`) so a hidden Quotes/Orders/Invoices/Insertion orders
section is left out of the spine and the Related tab instead of showing "0". The deal spine's
Quotes count uses `quote_count`. That is the whole frontend change. Roles on a contact's deals,
a contact's orders and contextual create are for frontend Phase 4.

Verification: new `test_relationship_summaries.py` (14, including route tests that the API
response itself is filtered), and `test_summary_services.py` updated to pass a reader. 25 of 25.
`verify_openapi` passes (362 paths). Backend suite 1187 tests: only the four known Redis
rate-limit tests fail, and none of their modules was touched. Frontend lint and build are clean;
`check-design.sh` passes 21 of 21. No browser run in this slice; the frontend Phase 4 run owns
the rendered pass.

Not done (for frontend Phase 4, or noted): task and document **counts** in the summaries. The
Tasks and Files tabs already load through their own permission-gated endpoints, so they are
not duplicated here. The contact/deal's own `organization` / `contact` compact fields are the
record's own link and are not gated, as before.

**Next:** 05 frontend Phase 4 (done, above), then the Opportunity run.

## Wave 3A prerequisite — 05 backend Phase 3: relationship context downstream (2026-09-29)

The Deferred row "participants propagated through Lead conversion and Quote/Order creation",
due before the Opportunity run.

Inventory. **Lead conversion** already did the right thing: it links only the contact it
converts, as the primary participant (`sync_primary_contact_association`), and copies none of
the account's other contacts. That was covered by a test already, and one more now pins the
"not every contact" half. **Quotes and orders** were the gap. A quote or order linked to a deal
had to name the deal's *primary* contact or be refused ("must match the linked opportunity"),
so a proposal to the deal's finance participant could not be recorded against the deal.

Change. `opportunity_contacts_services.ensure_contact_on_opportunity`, used by both
`quotes_services._ensure_linked_records` and `orders_services._ensure_linked_records`:

- no contact given: the primary is used, as before;
- any **active** participant may be chosen (link not removed, contact not in the recycle bin);
- anyone else is refused with "Quote/Order contact must be a participant on the linked
  opportunity", never silently swapped for the primary;
- the legacy primary (`contact_id`) is accepted even without an association row, so older
  data behaves as before;
- the account rule is unchanged (must match the deal); a quote→order conversion carries the
  quote's contact, which can now be a non-primary participant (before, that failed).

Each downstream record still carries exactly one contact; nothing copies the participant list.
No schema, no migration, no response-shape change; only the refusal message changed. The quote
form's hint under Deal now says the contact must be one of the deal's participants.

Verification: new `test_participant_propagation.py` (14: primary default, participant accepted,
non-participant / removed / recycle-binned / other-tenant refused, update uses the same rule,
legacy primary without a row, quote→order with a participant, manual orders, account rule,
conversion links one contact only). Backend suite 1173 tests, only the four known Redis
rate-limit tests fail without Redis, and those three modules pass 61 of 61 with Redis up.
Frontend lint and build are clean; `check-design.sh` passes 21 of 21. No browser run (a
one-line copy change).

Left open (added to Deferred): a **partial** quote/order update that sends only `contact_id`
is not checked against the deal already stored on the record (it predates this change; only
the submitted fields are validated). And the quote form's Deal picker filters by the *primary*
contact (`contact_id is`), so picking a non-primary participant first hides that deal; picking
the deal first and then the contact works.

**Next:** the remaining Deferred row before the Opportunity run, the relationship summaries
(05 backend Phase 4, then the frontend relationship rail), then the Opportunity run.

## Wave 3A — Organization run (2026-09-29)

Same gap as the Contact run: the Account header's Email was a bare `mailto:`. It now passes
`emailContext` (`sales_organizations`), so it opens `RecordEmailComposer`, the send is filed
against the account, and it lands on the account's Timeline. No backend or persistence change.

**Recipient decision.** 03 §10 asks for "known recipients, deliberate selection when
ambiguous". design.md §4.7 is narrower: a record offers a channel only for an address it owns.
Following §4.7, the composer is prefilled with the account's own `primary_email` (a
system-locked field) and never with one of its contacts' addresses. A contact is emailed from
the contact's record, so the conversation lands on that person's Timeline instead of being split
across two records. An account with no address of its own shows no Email action, however many
contacts it has. `To` stays editable, as it is on every record. The account has no opt-out
column, so there is no opt-out gate; `secondary_email` is not offered.

Verification: `test_mail_contextual_send.py` 75 of 75. `OrganizationContextualSendTests`
re-runs the Lead contract with an account fixture and adds five cases: filed against the
account, on the account's activity only, another tenant's account refused, a soft-deleted
account refused, `{{organization.*}}` rendered. Lint and build are clean; `check-design.sh`
passes 21 of 21. `organization-contextual-email.spec.ts` (new, 2: To holds only the account's
address although it has two contacts; no address means no Email action),
`contact-contextual-email.spec.ts`, `lead-contextual-email.spec.ts` and
`contact-organization-rollout.spec.ts` pass 14 of 14. The first run failed two Contact tests on
the 30s timeout while the dev server was still compiling (the send had succeeded); both pass
re-run warm.

**Next:** the two Deferred rows due before the Opportunity run, then the Opportunity run.

**Decided (owner, 2026-09-29): the Opportunity run follows the major CRMs, not §4.7's ban.**
Salesforce (email activity with Who = contact and What = opportunity), Dynamics (email
*Regarding* the opportunity, recipients as activity parties) and HubSpot (email associated
with the deal, contact and company) all send from the deal. So:

- The deal offers Email when at least one participant has a usable address (not opted out).
- One such participant is prefilled. Several: To starts empty and the user picks from the
  participants, with role labels. The primary contact is not silently prefilled.
- Opted-out participants are listed but cannot be picked, and the reason is shown.
- The send files the deal as `primary` and each chosen participant contact as `related`,
  through the existing `upsert_association`, with no new storage. The server checks each chosen
  contact is a participant in the tenant. A typed address that matches no participant files
  against the deal only.
- **Verify first:** that `_fetch_emails` in `record_activity.py` reads `related` associations,
  not only the primary. If it doesn't, extend the adapter so the email reaches the contact's
  Timeline.
- design.md §4.7 is rewritten in that run: the test becomes "the message is filed against every
  CRM record whose address it uses", replacing "does this record own the address". Quotes are
  unchanged. Offering an account's contacts as recipients from the Account page is a separate
  follow-up.

## Wave 3A — Contact run (2026-09-29)

The Activity projection (`record_activity.py`) and the record-send path
(`POST /mail/records/{module_key}/{entity_id}/send`, `mail_associations.py`) were already
module-generic. The gap was the page: the Contact header's Email was a bare `mailto:`. It now
passes `emailContext` (`sales_contacts`), so it opens the same `RecordEmailComposer`, the send
is filed against the contact by URL, and it lands on the contact's Timeline. An opted-out
contact still gets no email action. No backend or persistence change, and nothing
contact-specific in the mail domain.

Verification: `test_mail_contextual_send.py` 48 of 48. `ContactContextualSendTests` re-runs the
Lead contract with a contact fixture and adds four cases: filed against the contact, on the
contact's activity only, another tenant's contact refused, `{{contact.*}}` rendered. Lint and
build are clean. `contact-contextual-email.spec.ts` (new, 2), `lead-contextual-email.spec.ts`
and `contact-organization-rollout.spec.ts` pass 12 of 12.

## Wave 2E — closed (2026-09-29)

The rendered design guards (`design-rules.spec.ts` + `scroll-containers.spec.ts`,
`--workers=1`, frontend recreated first) pass 2 of 2 in 13.5 minutes, including the new
`/dashboard/settings/pipeline`. Wave 2E is done; its phase notes follow, newest first.

## Wave 2E — frontend Phase 4: a saved view remembers Table or Pipeline (2026-09-29)

- `SavedViewConfig.display` is optional (backend schema and `_normalize_saved_view_config`).
  It is an identifier (`[a-z][a-z_]{0,19}`) or nothing; anything else is dropped, never stored.
  The filters, columns and sort stay one definition shared by both displays.
- `ModuleViewDefinition.displayModes` declares a module's displays. Only Deals has them for
  now (`table`, `pipeline`, the `?display=` words). The first is the default and is stored as
  `null`.
- View manager (`/dashboard/views/[moduleKey]`): a **Display** tab ("Opens as") for modules
  with display modes. The draft carries `display` through edit, duplicate and discard, and it
  counts toward unsaved changes. `useSavedViews` seeds and compares `display` with the rest of
  the view.
- Deals list: selecting a view applies its display. A shared link's `?display=` outranks the
  first view it opens on, the same rule the view's filters follow, and never outranks a view
  chosen afterwards. The toggle itself still only changes the address; saving a display is
  done in the view manager, where the view's other settings are.

Verification: backend `test_saved_views.py` 16 of 16, including the new display
normalization; `verify_openapi` passes. Frontend lint and build are clean; `check-design.sh`
passes 21 of 21. `opportunities-board.spec.ts` (4, new: selecting a board view opens the board
and the default view brings the table back), `opportunities-revamp.spec.ts` (3) and
`view-manager-revamp.spec.ts` (8) pass 15 of 15.

## Wave 2E — frontend Phase 3: the Kanban, audited (2026-09-29)

The board predates this wave (rebuild 5.7: `OpportunitiesPipelineBoard` on the shared
`Board`). Checked against 04 §10 Phase 3:

| Requirement | State |
|---|---|
| Same saved-view filters as List | ✔ by construction: one `useOpportunities` query and one filter set; the board is a `?display=` of the same list |
| Columns from active pipeline stages | ✔ since frontend Phase 1. An inactive stage is a column only while occupied, and never a move target |
| Cards show key fields | Partly: name, account/client, owner, close date, value, overdue. Fixed, not configurable. Left as is |
| Drag/drop, optimistic | ✔ `stageMutation.onMutate` moves the card and its `pipeline_stage` |
| Backend validates, rejected move rolls back with a clear message | Rollback ✔. **Fixed:** the toast was generic; it now carries the server's reason ("Deal stage was not changed: Pipeline stage is inactive.") |
| Keyboard alternative | ✔ each card's "Change stage for …" select |
| **Fixed:** the stage was fetched only when the Stage column was visible | In board mode the list query always adds `sales_stage`, otherwise every card fell into Unstaged |

The board shows the loaded page of deals, not every deal ("Showing loaded records x–y of N").
Per-column totals are in the stat row above it. Not changed.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21. New
`opportunities-board.spec.ts` passes 3 of 3 (pipeline columns with an occupied inactive column
and no move into it, `fields` includes `sales_stage`, a keyboard move saves, a refused move
rolls back with its reason). `opportunities-revamp.spec.ts` passes 3 of 3.

## Wave 2E — Phase 4: the legacy constraint goes, tenants can add stages (2026-09-29)

- `20260819_drop_stage_check` drops `ck_sales_opportunities_sales_stage`. A stage is valid
  when the deal's own tenant's pipeline has it (`assign_opportunity_stage`). The downgrade
  refuses while any deal holds a non-legacy key, then restores the check. `sales_stage`
  stays as the mirrored stable key, because filters, search and export read it. The stage
  PATCH schema's fixed-list `pattern` is gone as well; an unknown key is a 400 from the service.
- `POST /sales/opportunities/pipeline/stages` (`configure`, audited): `label`, optional `key`,
  `semantic_type` (default `ongoing`), and optional `probability` (defaults by outcome: 10 / 50 /
  100 / 0). A derived key is slugged from the name and gets `_2`, `_3`… while taken; `unstaged`
  is reserved, and a key must start with a letter. An explicit key must be free and
  well-formed. A non-outcome stage is inserted before the first won/lost stage; an outcome goes
  last. A stage is never deleted, only deactivated.
- Settings page: `AddPipelineStage` has name, outcome and an explicit **Add stage** button. It
  is a create, so it does not autosave (R1). A refusal (duplicate name) shows under the form and
  keeps the typed name.

Verification: `test_pipeline_add_stage.py` 11 of 11. The full backend suite passes 1105 of 1105
with Redis up. `verify_migrations` passes at `20260819_drop_stage_check`, and `verify_openapi`
passes (362 paths). On a throwaway PostgreSQL database: a custom key is accepted at head, a
downgrade with it is refused, and after moving the deal back the downgrade restores the check
(a `CheckViolation` proves it), then re-upgrades. Frontend lint and build are clean;
`check-design.sh` passes 21 of 21; `pipeline-settings.spec.ts` passes 6 of 6.

## Wave 2E — frontend Phase 2: the pipeline settings screen (2026-09-29)

`/dashboard/settings/pipeline` ("Deal pipeline", Customization group; `SETTINGS_ROUTES.pipeline`).
It is archetype 4: one `FormSection` holding a `SortableList` of `PipelineStageRow`s.

- Each row is one stage: name (commits on blur or Enter), outcome (`Open` / `In progress` /
  `Won` / `Lost`), probability %, `Active`/`Inactive` (`SegmentedBoolean`), and move up/down.
  Each change autosaves (R1) through `useAutosave`, and the row's `SaveStateIndicator`
  reports it. A server refusal, such as a duplicate name or the last active open stage, shows
  its own reason under the row and marks the field invalid. The stable key and the live deal
  count are shown under the name.
- Deactivating a stage that holds deals asks first and names the count. The deals stay put.
- Reorder: the move buttons are the contract, and drag is an enhancement (the `SortableList`
  primitive). The order is applied optimistically and rolled back on failure, with its own
  indicator in the section header. The list is **not** disabled while saving: a disabled list
  drops its move buttons, and focus went with them. A move made during a save is ignored.
- A save writes the server's pipeline into the `sales-opportunity-pipeline` cache and
  invalidates usage, deal lists, totals and the deal summary, so labels change everywhere.
- The route was added to the design-rules and scroll-containers route lists and to the census.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21.
`pipeline-settings.spec.ts` passes 5 of 5: rename and Saved, a refused name in place, reorder
with focus kept, deactivate with the count and a working Cancel, and the permission wall. A
theme probe gave dark body `rgb(11, 13, 16)` and light `rgb(247, 248, 250)`; at 390px there is
no horizontal overflow and the row wraps. **Not run:** the full rendered design-guard walk,
which has no route filter. It is owed once at the end of Wave 2E.

## Wave 2E — pipeline settings API (2026-09-29)

The backend half of 04 frontend Phase 2, on a new `pipelines_routes.py` mounted before the
opportunities router. Every route needs Opportunities `configure` on top of module and
department access, so a salesperson can move deals but not redefine stages.

- `PATCH /sales/opportunities/pipeline/stages/{id}` changes `label`, `semantic_type`,
  `probability` or `is_active`. The stable `key` is not in the contract. Names are unique per
  pipeline, case-insensitively, and at most 80 characters. The pipeline must keep at least one
  active stage that is not won or lost, so a deactivation or reclassification that removes the
  last one is refused. Deactivation keeps its deals where they are and refuses only new
  assignments.
- `PUT /sales/opportunities/pipeline/stage-order` takes the full list of stage ids. An
  incomplete, duplicated or foreign list is a 409 ("reload and try again"), so a stale client
  cannot misplace a stage it never saw.
- `GET /sales/opportunities/pipeline/stage-usage` returns live deals per stage in the caller's
  tenant, for the UI's impact warnings.
- Every change writes one `ActivityLog` row (`entity_type=sales_pipeline`,
  `action=configure`) with the before and after pipeline. A stage from another tenant is a 404.
- Not built: adding a stage (blocked on the legacy check constraint) and deleting one (never,
  by design).

Verification: `test_pipeline_settings.py` 12 of 12. The full backend suite passes 1094 of 1094
with Redis up. `verify_openapi` passes (361 paths). No migration.

## Wave 2E — frontend Phase 1: configurable selectors (2026-09-29)

The client no longer lists stages. Options, order, labels and outcome come from
`GET /sales/opportunities/pipeline` (`hooks/sales/useOpportunityPipeline.ts`, with a 5-minute
stale time), and a deal's own stage from its `pipeline_stage`.

- `opportunityStages.ts` is now helpers only: `stageTone` (won → success, lost → critical,
  everything else neutral, per R5), `resolveStage`, `selectableStages` (active stages, plus
  the current one if it was deactivated), and `defaultStageKey` (the first active stage that
  is not an outcome). `OPPORTUNITY_STAGE_ORDER`/`LABELS`, the `statusStyles.ts` stage map and
  `scripts/check-opportunity-stages.py` are deleted.
- `OpportunityStageSelect` is the one picker. The full form, Quick Create and Lead conversion
  use it; conversion offers only stages past the entry stage and starts at the first `ongoing`
  one. An empty value displays the pipeline default, and `buildOpportunityPayload` submits that
  same default, so what is shown is what is saved. Conversion's dirty-check baseline moved from
  `"qualified"` to `""` with it; missing that made an untouched conversion prompt on Cancel.
- Deal record page: the spine track is the tenant's stages minus `lost` ones, the inline Stage
  options come from the pipeline, and the header status comes from `pipeline_stage`. A stage
  change writes the saved record back, so the label is never stale. An unstaged deal now shows
  "Unstaged" instead of pretending to be at Lead.
- Table status and overdue, the board's columns (inactive columns only while occupied, and they
  accept no cards), the list's loading stat tiles, the Stage saved-view filter options (by
  stable key, inactive stages marked), related-deal labels on Contact/Account, the linked-record
  picker, and the dashboard funnel (which drops `lost` by meaning; the backend dashboard rows now
  carry `semantic_type`).
- `opportunities-revamp.spec.ts` "pipeline totals … retry": the spec was at fault.
  `getByText("Lead")` also matched real deals in the table. It is now scoped to the stat tile.
- `lib/moduleViewConfigs.ts` keeps its static Stage options as the fallback for any caller that
  does not have the pipeline. The list page overrides them.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21. Backend
`test_pipeline_business_logic`, forecasting and API-route tests pass 80 of 80.
`opportunities-revamp.spec.ts` plus `opportunity-participants.spec.ts` pass 8 of 8, including
the retry test. `leads-revamp.spec.ts` plus `contact-organization-rollout.spec.ts` pass 22 of 22 (the first
run failed 1, the dirty-baseline bug above, now fixed). Not checked: the rendered design guards,
and a both-theme pass. No styling changed; only where the labels and options come from.

## Wave 2E — pipeline Phase 3: dependent business logic (2026-09-29)

Every backend `3` row of `04a-stage-inventory.md` is migrated. The file's closing section
records how.

- **Meaning comes from the stage row.** `OpportunityStageFacts` (key, label, semantic type,
  probability, position) per deal, plus null-safe SQL clauses for closed and won. The stale
  deal scan, the stage PATCH's `close` audit action, the forecast (won, lost, open counts,
  weights, bucket labels), the CRM dashboard (won/lost counts, open pipeline value, stage
  buckets) and the owner scorecard's won count all read `semantic_type`/`probability`.
  Seeded values equal the old hardcoded ones, so untouched tenants see the same numbers.
  Visible differences: bucket labels are now sentence case, and the dashboard's no-stage
  bucket is `unstaged` / "Unstaged" instead of `__empty__`.
- **Pipeline summary** (`GET /pipeline-summary`): columns come from the tenant's pipeline in
  position order. An inactive stage appears only while deals sit in it, then Unstaged. Rows
  are keyed by stage row and carry `stage_id`, `semantic_type`, `probability` and `is_active`.
- **Events.** `opportunity.stage_changed` now carries `sales_stage`, `stage_id`,
  `stage_label`, `stage_semantic_type`, their `previous_` pair, and a `field_changes`
  entry. **Bug fixed:** the automation *Stage* condition reads `payload.sales_stage`, which the
  event never carried, so stage conditions could not match. `opportunity.won` /
  `opportunity.lost` were registered triggers that nothing emitted. They now fire on entering
  a won/lost semantic type, and not on moving between two stages of the same outcome. There is
  a new `Stage outcome` automation condition (`stage_semantic_type`). Neither new event is a
  Slack alert.
- **Display.** Global search, the recycle bin and the `{{opportunity.stage}}` mail variable
  show the stage label instead of the raw key.
- Nothing else in `backend/app` compares a legacy key. What remains are stable-key uses the
  spec allows: filters, search document, export, and automation option values.

Verification: `test_pipeline_business_logic.py` 14 of 14. Each test changes a stage's
meaning or label on the row and checks the behaviour follows the meaning. The full backend
suite passes 1082 of 1082 with Redis up. `verify_openapi` passes. No migration and no frontend
change.

## Wave 2E — pipeline Phase 2: Opportunity references (2026-09-29)

- `sales_opportunities.pipeline_id` / `pipeline_stage_id` (`20260818_opp_stage_refs`), with a
  partial index `(tenant_id, pipeline_stage_id) WHERE deleted_at IS NULL` for board columns
  and "stage in use" counts. The backfill resolves by key within the deal's own tenant's
  default pipeline and covers soft-deleted deals. A NULL `sales_stage` stays unstaged, with
  the pipeline still set. The upgrade aborts if any deal is left unresolved.
- Both columns stay **nullable** during compatibility: NULL pipeline = tenant default, NULL
  stage = unstaged. Making `pipeline_id` required belongs with Phase 4.
- `pipelines_services.assign_opportunity_stage` is the only writer of `sales_stage`,
  `pipeline_id` and `pipeline_stage_id`. Create, update (and so CSV import), the stage PATCH
  and Lead conversion all go through it. A caller may send the legacy key, the stage id, or
  both, and both must agree. A stage from another tenant gets the same 400 as a missing one.
  An inactive stage or pipeline cannot be newly assigned, but a deal already in one may stay.
  An unknown key is now a 400 rather than a check-constraint error. Lead conversion resolves
  its stage before writing anything.
- API: `pipeline_stage_id` is accepted on create/update/stage PATCH. Responses add
  `pipeline_id`, `pipeline_stage_id` and `pipeline_stage` (`key`, `label`, `semantic_type`,
  `probability`, `is_active`). List items include them only when the Stage column is visible.
  A tenant that disabled Stage cannot write it through `pipeline_stage_id` either. Every
  existing field keeps its meaning, so current clients are unaffected.
- **The legacy check constraint still limits stage keys to the six seeded ones.** Adding a
  stage (the frontend Phase 2 settings UI) therefore needs Phase 4's constraint drop, or a
  bounded relaxation of it, first. Renaming, reordering, re-weighting and deactivating
  stages do not.

Verification: `test_opportunity_stage_refs.py` 24 of 24 (backfill for every legacy stage
across two tenants and a soft-deleted deal, idempotency, the unresolved block, key/id
agreement, cross-tenant rejection, inactive handling, clearing, conversion, serialization,
field-config mapping). The two old `update_opportunity_stage` tests moved there onto a real
session. The full backend suite passes 1068 of 1068 with Redis up. `verify_migrations` passes
at `20260818_opp_stage_refs`, and `verify_openapi` passes. On a throwaway PostgreSQL database,
a populated upgrade matched 14 of 14 deals and a real `alembic downgrade` to
`20260816_opp_participants` removed both tables and columns before re-upgrading cleanly.
No frontend change.

## Wave 2E — pipeline Phase 1: models and compatibility resolver (2026-09-29)

Backend Phase 1 of `04-pipelines-kanban.md`. `sales_opportunities.sales_stage` is untouched;
no Opportunity references a stage row yet.

- **Inventory first.** `04a-stage-inventory.md` lists every place that compares, validates,
  groups or displays a legacy stage key, backend and frontend, each tagged with the 04 phase
  that migrates it. Phase 4 may not drop `ck_sales_opportunities_sales_stage` while a row is
  unticked.
- `sales_pipelines` / `sales_pipeline_stages` (`20260817_sales_pipelines`). A stage has a
  stable `key`, an editable `label`, `position`, `semantic_type`
  (`open | ongoing | won | lost`; `open` = entry, `ongoing` = active pursuit, both not-closed),
  `probability`, `is_active`. There is one default pipeline per tenant and module, enforced
  by a partial unique index, and a default must be active (a check constraint). `module_key`
  is constrained to `sales_opportunities`: pipelines are sales-domain, not generic metadata.
- The migration seeds a default pipeline for **every** tenant from the legacy catalog, using
  the same keys, the report's forecast weights as probabilities, and sentence-case labels.
  It then asserts that no stored `sales_stage` is orphaned.
- `pipelines_services.ensure_default_opportunity_pipeline` seeds tenants created later on
  first use (it flushes and does not commit; a losing concurrent seed reads the winner).
  `resolve_legacy_opportunity_stage` maps a stored value to its row **by key**, never label.
  Inactive stages still resolve, so history stays readable. The bootstrap seed calls ensure.
- `GET /sales/opportunities/pipeline` (Opportunity `view`) returns the resolved default with
  every stage, including `semantic_type` and `is_closed`, so clients never infer from labels.
- The backend label catalog is now sentence case (`Closed won`), matching the frontend
  mirror; `scripts/check-opportunity-stages.py` passes again (it was failing at HEAD). The
  pipeline-summary endpoint's labels change case accordingly.
- Tenant backups now export `sales_pipelines.json` / `sales_pipeline_stages.json` with
  Opportunities. Restore does not read them yet, same as `sales_opportunity_contacts.json`.
- `FORECAST_STAGE_PROBABILITIES` now derives from the catalog; the values are unchanged
  (pinned by a test).

Verification: `test_sales_pipelines.py` 21 of 21, which covers the populated backfill with
every legacy stage, idempotency, the orphan block, default uniqueness, inactive-default
rejection, the concurrent-seed loss, key-not-label resolution, inactive-stage history,
tenant isolation, and the route's permission and ordering. The full backend suite passes,
1046 of 1046: 4 rate-limit tests need Redis and were re-run with it. `verify_migrations` passes at
`20260817_sales_pipelines`, and `verify_openapi` passes for 358 paths. A populated upgrade on a
throwaway PostgreSQL database seeded 6 stages for each of three tenants and rejected a second
default. Not run: the contract drift check (layout family untouched), frontend lint/build (no
frontend change), and a real `alembic downgrade`.

## Wave 2D — participant management (2026-09-29)

Frontend Phase 2 of `05-relationships-data-model.md`, on the Phase 2 APIs that were already
in place. Phase 1 (display) and Opportunity Quick Create had landed earlier.

- `components/opportunities/OpportunityParticipants.tsx` — the `Participants` panel on the
  deal's `Related records` tab: add (contact picker, role, primary), change role, make
  primary, remove with a confirmation and an Undo that calls the restore route. A contact
  not yet in the CRM is created in place through Contact Quick Create with the deal's
  account filled in, and the add panel reopens with that contact selected.
- Placement follows design.md §4.7: a participant is a row pointing at the deal, so it is
  managed in the content region, not the spine. The spine's `Participants` count is now
  drawn at zero too, because the tab it opens is where people are added.
- Permissions mirror the routes: add, change role and make primary need deal `edit`;
  removal needs `delete`; Undo needs `restore`. The whole panel needs Contacts `view`
  (`can_view_contacts`). The server enforces all of it independently.
- No backend change, no migration, no contract change.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21;
`opportunity-participants.spec.ts` passes 5 of 5; the panel was checked in both themes
(body `rgb(11, 13, 16)` / `rgb(247, 248, 250)`). `opportunities-revamp.spec.ts` fails 3 of 3
at the default 30s both with and without this change (a stashed-HEAD baseline). At 90s it
fails only `pipeline totals … retry` on the list page, which this change does not touch.

Left open: see *Deferred* below.

## Deferred — not built, and when to build it

Each row is deliberately unbuilt. The trigger column says when it is due. Check this table at
the start of every wave, and build a row in the wave its trigger names, not earlier.

| Item | Why it waits | Build it when |
|---|---|---|
| A view of removed participants (`/participants/recycle` has no UI) | Undo covers the immediate case | When an operator needs to restore a participant after the Undo toast is gone, or with a shared record-level recycle view |
| Catalog ↔ quote/order line items (`catalog_product_id` / `catalog_service_id`) | Filed by rebuild 5.3 as its own slice | A standalone slice; not tied to a wave |
| Custom-module EAV filtering over `custom_module_record_values` (rebuild Appendix B.2) | A backend query-parameter contract | A standalone slice; the toolbar already stopped claiming the filter works |
| `RequiredMark` not announced to screen readers (about 54 of 68 uses) | A primitive decision for the owner: a `Field` context, or the mark taking its control's id | When the owner picks the approach; then fix in the primitive, not at each call site |
| `opportunities-revamp.spec.ts` "pipeline totals … retry" fails (inherited, reproduces at HEAD) | Not caused by 2D; unread beyond attribution | 2E frontend Phase 1, the first 2E slice that touches the list page |
| Automation *Stage* condition options are the six seeded keys (`automation_registry.py`), so a tenant-added stage cannot be picked there | The registry is static per module; making one field's options tenant-dynamic is a registry contract change | When automation conditions gain tenant-resolved options; until then *Stage outcome* (semantic type) covers "a deal was won/lost" |
| Tenant restore of pipeline configuration and stage ids | Backups export pipelines, stages and each deal's stage ids; restore reads no sales files yet | When tenant restore gains sales-module restore: stage ids must be remapped, not copied |
| Partial quote/order update that sends only `contact_id` is not checked against the record's stored deal | Predates 05 Phase 3; `_ensure_linked_records` validates only submitted fields | When quote/order updates are next touched: validate against the effective (submitted or stored) deal |
| Quote/order Deal picker filters deals by *primary* contact only | `contact_id is` on the opportunity search means the primary; a participant filter is a search contract change | When the quote form is next touched, or the picker gains a participant filter (the rail did not touch the quote form) |
| `contacts-revamp.spec.ts` "shared workflow" fails: the Contact **edit** form's Email field is empty (inherited, reproduces with 05 frontend Phase 4 stashed) | Not caused by the rail; unread beyond attribution | The next slice that touches the Contact edit form |
| Offering an account's contacts as email recipients from the Account page | Owner decision 2026-09-29: a separate follow-up; the Account emails its own address only (design.md §4.7) | When the owner asks for it; reuse `recipientCandidates` and a server rule like the deal's |
| A typed address of an opted-out contact who is *not* a participant is not refused when mailing from a deal | The composer only knows participants, and the server links by id, never by address | If opt-out becomes a send-time rule across all mail (the inbox composer has the same gap) |
