# 13d — Step 7, F5: commercial documents

This is the plan for **F5** of `13-final-fixes.md`, the second phase of §7 Step 7 (F4 → F5 → F6).
It was written on 2026-10-08. **The owner accepted all twelve §5 decisions (2026-10-08)**; any
changes come after client UAT.

**Test cadence (owner, 2026-10-08):** F4, F5 and F6 share **one** test pass after F6 is built
(13 §6). Nothing in F5 is run on its own. Each slice records its migrations and touched files
in STATUS.md, so a failure in the shared pass can be traced to its phase by diff.

## 1. Where things stand (inspected 2026-10-08)

**Tax.** Tax is an amount typed on each line of quotes, orders, invoices, credit notes, bills and
vendor credits. PO lines have no tax (13c decision 1 left it to F5). Invoices also carry a
header `tax_rate` from POS, which `pos_invoice_services._apply_totals` applies on top of the
line tax. Products and services have a `tax_category` picklist that nothing reads. Website and
portal orders get no tax. `document_amounts.line_amounts` is the shared line function
(quantity × price − discount + tax, half-up per line), but quotes and orders still compute
their own lines with no rounding per line.

**Totals disagree (H16).** Quotes and orders show the subtotal before discounts. Invoices show it
after line discounts, with the header discount at 0. The same lines therefore show 999.99 / 10
on the quote and 989.99 / 0.00 on the invoice.

**Printing.** There are three browser print pages: invoice, PO and delivery note. The invoice
page says "POS Invoice", leaves out the line discount and bills the contact's email instead of
the account's address. Quotes, orders, credit notes, receipts and bills cannot be printed.
No document is a PDF. The backend has no PDF library and no template engine.
`FinancePosInvoice.template_id` (`modern`, `classic`, `compact`) is the only template setting.
`CompanyProfile` has `logo_url`, `billing_address`, and `default_payment_terms_days`.

**Quote proposals (H7).** `generate_quote_proposal` stores a plain-text `content_text`.
`send_quote_proposal` creates a signed link (`SalesQuoteDocument.public_token_hash`) and a
`sent` event, but **emails nobody** and leaves the quote in *Draft*. The public page
`/public/quotes/proposal/[token]` shows that text: the internal status, the discount folded
into the line maths, Lynk branding, and a `.txt` download. It has no Accept or Decline. A
portal client can approve or reject a quote (`respond_to_client_quote`).

**Quote form (H14), still open:** *Customer name* comes from the deal's account or contact
name, so it can be a person. The issue and expiry dates have no defaults, and an expiry before
the issue date is accepted. "10%" in Discount becomes 10.00. Nothing expires a quote: the
`quote.expired` trigger exists but fires only on a manual status change (A7). An expired quote
can be accepted, and a converted quote can be edited. Converting does not open the new order.

**Email.** `POST /mail/records/{module}/{id}/send` sends from the user's own mailbox, and the
composer can attach files from the documents module. The link targets come from the
record-comment config, which F4 extended to every document, so a document can already be
the record an email is filed against. Template tokens are resolved only for contacts,
accounts, deals, quotes and leads. `tenant_mail.py` is a workspace SMTP sender for system mail.
Report subscriptions use it, and the plan reuses it for invites, reminders and statements.

**Line editor (D10, A6).** `TransactionLineItemsEditor` is shared by quotes, orders and invoices.
Discount is an amount only. There are no section, note or optional lines, no reorder or
duplicate, and no unit column, although products and services have `unit`. Totals on screen
use JavaScript floats.

**Receivables (D11).** `overdue_scans.scan_overdue_documents` emits overdue events. There are no
recurring invoices, payment reminders, statements or write-offs.

**Client portal (I9), all still open.** The client gets no invite email and has no forgot
password. *Orders* lists only the account's portal requests (`client_account_id`), not its
sales orders. There is no invoices section. A request shows no confirmation and gets a reference
like `portal-20-sl5x8x52p-4`. The top bar has no client name or account menu, and some copy is
jargon ("Pricing is resolved from your account context").

## 2. Benchmark

| | Odoo 18 | Business Central | NetSuite | Zoho Books | ERPNext | Xero / QuickBooks |
|---|---|---|---|---|---|---|
| **Tax setup** | Taxes with *price included* per tax; tax groups; fiscal positions map taxes per customer | VAT business × product posting groups give the rate; *Prices including VAT* per document | Tax codes and groups (SuiteTax engine) | Taxes, tax groups; *tax inclusive / exclusive* per document; customer *tax exempt* with a reason | Item tax templates, sales/purchase tax templates, inclusive flag per tax row | Tax rates (Xero components), *amounts are tax inclusive/exclusive/no tax* per document |
| **Tax rounding** | Per line or globally (company setting) | Per line, document rounding | Per line | Per line | Per line or on totals | Per line (Xero), configurable (QB) |
| **Line types** | Product, section, note; optional products on quotes | Item, G/L, comment (text) lines | Item, subtotal, description lines | Item lines; headers via *Add header* (Zoho Invoice) | Items only; no section rows | Items only |
| **Discount** | % per line (amount via settings) | % or amount per line; invoice discount | Discount items, % or amount | % or amount per line, or at document level | % or amount per line, plus additional discount | % per line (Xero), % or amount (QB) |
| **PDF and send** | QWeb → wkhtmltopdf; *Send by email* attaches PDF; layout and colours in settings | Report layouts (Word/RDLC); *Send* by email | Advanced PDF templates (BFO); email from the record | Template gallery + editor; email from the record, PDF attached, history logged | Print formats (Jinja, HTML → PDF); email from the document | Branding themes; email from the invoice |
| **Quote acceptance** | Customer portal: sign (drawn or typed) and/or pay to confirm; auto-confirms the SO | Not native | Not native (partners) | *Accept* / *Decline* via the customer portal or the email link | Supplier/customer portal, no signature | Xero: online quote accept/decline with name; QB: accept online |
| **Quote expiry and revisions** | *Expiration* date with a company default validity; expired quotes can't be confirmed | *Quote valid until* | Expiry date | Expiry date; *Expired* status | *Valid till*; amended copies `-1`, `-2` | Expiry date |
| **Recurring invoices** | Subscriptions app | Recurring sales lines | Memorized transactions | Recurring profile: frequency, start/end, draft or send | Auto repeat on any document | Repeating invoice: schedule, draft / approve / send |
| **Reminders** | Follow-up levels (days after due, email/letter) | Reminder terms and levels | Collections (SuiteApp) | Reminders before and after due, per template; per-customer stop | Payment reminders via notifications | Xero: up to 5 reminders; QB: 3 |
| **Statements** | Partner ledger / follow-up report | Customer statement report | Customer statement | Statement by period, emailable PDF | Process statement of accounts (PDF, email) | Activity and outstanding statements |
| **Write-off** | Reconcile with a write-off account | Payment tolerance and write-off | Write-off on payment | *Write off* invoice balance | Write-off amount on the payment entry | Write-off through a credit note or adjustment |
| **Customer portal** | Quotes, orders, invoices with PDF and pay, sign up by invite | — | Customer Center | Portal: quotes, invoices, statements, pay; invite email; reset password | Portal: quotes, orders, invoices | Online invoice link only |

**What Lynk takes:**
- Zoho's and Xero's tax model: rates and groups, *tax inclusive / exclusive* per document with a
  company default, and an exempt flag on the account. It is simpler than Odoo's fiscal positions
  and covers the cases we have.
- Odoo's line types (section, note, optional) and its validity-period default on quotes.
- ERPNext's print formats: Jinja templates over HTML, rendered to PDF server-side. The same HTML
  serves as the preview, so there is one template system.
- Zoho's *Send* (PDF attached, the default template per document type, logged on the record)
  and its receivables set: a recurring profile, reminders before and after due, statements, and
  write-off.
- Xero's quote page: accept with a name, decline with a reason, no account needed.
- Odoo's portal content (quotes, orders, invoices with PDF), plus Zoho's invite and reset flows.

## 3. Design

### 3.1 Tax rates (F5.1)

**Settings → Taxes**, a settings page in the existing list style:
- `finance_tax_rates`: name, rate (0–100, 4 places), kind (`rate` or `group`), active,
  `is_default_sales`, `is_default_purchases`.
- `finance_tax_group_members`: a group's component rates. Group rates add up, with no
  compounding. Compound tax is out of scope (§6).

A rate in use cannot be deleted, only deactivated.

**Defaults:**
- `catalog_products.tax_rate_id` and `catalog_services.tax_rate_id` hold the sales rate.
  `purchase_tax_rate_id` holds the purchase rate.
- The company has a default sales rate and a default purchase rate (the `is_default_*` flags).
- `sales_organizations.tax_exempt` and `tax_exempt_reason` make the account's sales lines
  default to no rate.

The `tax_category` picklist stays as a label for reports and is not used for the rate
(decision 3).

**A line's rate**, in order:
1. the line's own choice;
2. no rate when the account is exempt (sales documents only);
3. the item's rate;
4. the company default.

**Documents:** `tax_mode` (`exclusive` or `inclusive`) on quotes, orders, invoices, credit
notes, POs, bills and vendor credits, with a company default (decision 2).

**Lines:** each line gets `tax_rate_id` (nullable) and `tax_manual` (boolean, Python default
`False` per the SQLite memory rule). PO lines also get `tax_amount`. `tax_amount` stays the
stored result.

**One computation.** `document_amounts.line_amounts` gains `rate` and `inclusive`:
- exclusive: net = gross − discount, tax = round(net × rate);
- inclusive: total = gross − discount, net = round(total ÷ (1 + rate)), tax = total − net;
- `tax_manual`: the typed tax is kept and nothing is computed.

Every line is rounded half up to the cent (decision 4). Quotes and orders move onto
`line_amounts`, so all seven documents compute lines in one place.

**Totals, one definition everywhere (fixes H16):**
- subtotal = Σ gross;
- discount = Σ line discount;
- tax = Σ line tax;
- total = subtotal − discount + tax + shipping.

The invoice header discount stays for POS invoices only.

**Tax flows through:**
- quote → order;
- order → invoice, pro rata as today;
- invoice → credit note;
- PO → bill;
- bill → vendor credit.

Each copies the line's rate, mode and manual flag. A downstream line is not recomputed from
the item's current rate.

**Tax summary:** `tax_summary(lines)` groups by rate, giving name, rate, taxable amount and tax.
A group is split into its components for display. It appears on every document page and PDF.

**Website and portal orders** compute tax from the item's rate, with the company's default
mode. A website order that sends its own line tax keeps it as manual.

**Migration `20261016_tax_rates`:**
- creates the tables and columns;
- every existing line gets `tax_manual = true` with its typed amount, so no issued total
  changes;
- every invoice with a header `tax_rate > 0` gets its rate as a line rate:
  - a tax rate row named "Tax n%" is created per tenant and rate, then deactivated;
  - the lines get it with `tax_manual = true` and their amounts spread pro rata, so totals
    are unchanged;
  - the header rate goes to 0.
- Afterwards the header `tax_rate` is read by POS only, which keeps its own quick path.

Downgrade refuses while any non-manual line exists.

**Tax report source** (report engine): *Tax by rate*, over issued invoices and credit notes
(output) and posted bills and vendor credits (input). It is grouped by rate and period and
shows taxable amount and tax, with credits negative.

### 3.2 Line editor (F5.2)

These apply to quotes, orders, invoices and credit notes. PO and bill lines get the tax column
and unit only (decision 9).

- **`line_type`:** `item`, `section` or `note`. A section or note line carries only the name
  or text and is excluded from amounts, quantities, fulfilment, invoicing and stock. It is
  copied quote → order → invoice in position.
- **Discount as % or amount:** `discount_percent` (nullable, 0–100). When it is set, the amount
  is computed by `line_amounts`, and the stored amount stays the source of truth for totals.
  The editor's Discount field takes "10%" or "10" and shows which it is, so a typed % is never
  read as an amount (H14).
- **Optional lines (quotes only):** `is_optional`. These lines are listed under *Optional* and
  excluded from the quote total. On the proposal page or in the portal the customer ticks the
  ones they want before accepting. Accepted optional lines become ordinary lines. Converting
  copies only non-optional lines.
- **Reorder and duplicate:** drag handle plus *Move up/down* in the row menu for keyboard
  users, and *Duplicate*. `sort_order` already exists.
- **Unit column:** `unit` on every sales line and on PO and bill lines. It defaults from the
  item's `unit` and is free text until F6.2 manages the list. The column shows only when a line
  has a unit other than "unit" or the admin turns it on in the column picker.
- **Decimal preview (A6):** the editor computes with a small decimal helper
  (`lib/money.ts`, integer cents with half-up rounding per line) that mirrors `line_amounts`,
  inclusive mode included. The server's figures still win after a save.

Migration `20261017_line_editor`: `line_type` (default `item`), `discount_percent`,
`is_optional` (quote items), `unit`. Downgrade refuses while section, note or optional lines
exist.

### 3.3 PDF documents (F5.3)

**Renderer:** WeasyPrint with Jinja2 templates (decision 1).
- The backend image gains `libpango-1.0-0`, `libpangoft2-1.0-0` and fonts (`fonts-dejavu`,
  `fonts-noto-core`).
- `requirements.in` gains `weasyprint` and `jinja2`, and the lock is recompiled.
- New `app/core/document_pdf.py`:
  - `render_html(kind, context)`;
  - `render_pdf(kind, context) -> bytes`;
  - a sandboxed Jinja environment with autoescape and no filesystem includes outside the
    template folder;
  - images only from the tenant's own uploads, resolved server-side. No remote fetches: the
    URL fetcher refuses anything else (SSRF).
- Templates live in `app/templates/documents/`: one base layout and a partial per section
  (header, parties, lines, tax summary, totals, terms, payment details). Each kind is a thin
  template: quote, sales order, invoice, credit note, PO, delivery note, receipt, bill,
  statement (3.6) and vendor credit.

**Layouts and branding:**
- The three existing `template_id` styles (`modern`, `classic`, `compact`) become document-wide
  layouts: a company setting, overridable per invoice as today.
- `company_profiles` gains `brand_color`, `document_footer`, `bank_details` (the payment
  details on invoices). `quote_validity_days` comes with 3.5.
- Per document type, `document_settings` (`tenant_id`, `kind`, `title`, `default_terms`,
  `default_notes`, `email_template_id`) gives the printed title ("Tax invoice" where a
  country requires it), the default terms and notes copied onto new documents, and the
  default email template.

**Content:**
- company logo and address;
- the counterparty's billing and shipping addresses from the account's structured addresses
  (C2), with the contact named as the person;
- number, dates, reference;
- lines with unit, discount and tax rate;
- sections and notes;
- tax summary and totals;
- terms;
- payment details on invoices.

No internal status appears on a PDF.

**Snapshots:** `document_pdf_snapshots` (`tenant_id`, `module_key`, `entity_id`, `version`,
`document_id` → documents module storage, `created_at`, `reason`). A snapshot is taken when a
document is issued:
- quote sent;
- order confirmed;
- invoice issued;
- credit note issued;
- PO ordered or RFQ sent;
- bill posted;
- delivery shipped;
- receipt posted;
- vendor credit issued.

*Download PDF* serves the latest snapshot for an issued document and a live render for a
draft. A later edit that changes an issued document (where edits are allowed) takes a new
version. The snapshot is the document's record and is kept in backups.

**Routes:**
- `GET /{doc}/{id}/pdf`, view permission;
- `GET /{doc}/{id}/preview`, the HTML.

The three print pages are replaced by a shared `DocumentPreviewPage` that shows the HTML
preview with *Download PDF*. The PO and delivery routes keep their URLs, and the invoice
route keeps its URL. The old print components are deleted.

### 3.4 Send by email (F5.4)

*Send* on quotes, orders, invoices, credit notes, POs (and RFQs), bills (to the vendor, for
disputes) and vendor credits opens `RecordEmailComposer` with:
- **recipients:**
  - sales documents: the document's contact first, then the account's contacts, then the
    account's email;
  - POs and bills: the vendor's contacts, then the vendor's email.
- **the PDF attached:** the composer gains `generated_attachments`
  (`{module_key, entity_id}`). The server renders or reads the snapshot at send time and
  attaches it through the existing attachment path, with the same `view` check on the
  source module.
- **the document type's default template** (3.3 `email_template_id`), seeded per type. Template
  tokens gain the document: `document.number`, `document.total`, `document.due_date`,
  `document.balance_due`, `document.public_link` (quotes), and the account and contact.

**After sending:**
- the send is logged on the document's history (F4) as `document.sent`, with recipients;
- the email is filed against the document (`mail_associations`), and against the account
  when there is one.

Effects by type:
- **Quote:** creates the proposal link (`send_quote_proposal`), puts it in the email, sets
  the quote to *Sent* and emits `quote.sent`.
- **Invoice:** records `sent_at` and the "Sent" badge.
- **PO in draft (RFQ):** `mark_sent` (13c §3.8).

Sending needs the user's connected mailbox, as record email does today. Without one, the
composer says so and offers *Download PDF* (decision 6).

### 3.5 Quote lifecycle and the proposal page (F5.5, H7, H14, A7)

**Form:**
- *Customer name* is the account's name when there is an account, else the contact's.
- The account and contact pickers show the records the deal filled in. The bug is that the
  pickers are given ids without labels, so the fix sends the labels.
- The issue date defaults to the user's today. The expiry defaults to issue +
  `quote_validity_days` (company, default 30).
- Expiry before issue is refused in the service, with the same copy in the form.

**Lifecycle:**
- `draft → sent → accepted / declined / expired`, plus `superseded` (new) and `converted`
  (new).
- A daily beat task `scan_expired_quotes` moves *sent* or *draft* quotes past
  `expiry_date` to *expired* and emits `quote.expired` once.
- An expired quote cannot be accepted, in the portal, on the proposal page or by status
  change, until it is revised.
- *Convert to order* sets *converted*, locks the quote (edits refused, *Revise* still
  allowed) and opens the new order.

**Revisions** (decision 7):
- *Revise* on a sent, expired or declined quote copies it to a new draft with
  `revision = n + 1` and the same number plus `-R2`, `-R3`.
- It links `revised_from_id` and sets the old one to *superseded*.
- The proposal links of a superseded quote show "This quote has been replaced" with no
  actions.

**Public proposal page** (`/public/quotes/proposal/[token]`, rebuilt):
- the HTML preview of 3.3 in the company's branding;
- *Download PDF* (the snapshot);
- optional lines with tick boxes that update the total live;
- **Accept:** the signer's name (required), an optional drawn signature (canvas → PNG, stored
  with the snapshot), and agreement to the terms;
- **Decline:** a reason from the `lost_reason` picklist plus an optional note.

Both are new public routes under the existing token, rate-limited like the events route. They
record the signer, time, a hashed IP and the chosen optional lines. They set the status, log
`quote.accepted` / `quote.rejected` on the timeline (actor: the signer's name) and notify the
quote owner. Accepting does not create the order (decision 8).

The portal's quote page uses the same accept and decline components and service function.
`respond_to_client_quote` folds into it.

Migration `20261019_quote_lifecycle`:
- quote statuses `superseded` and `converted`;
- `revision`, `revised_from_id`, `accepted_by_name`, `accepted_at`, `signature_document_id`,
  `decline_reason`;
- `company_profiles.quote_validity_days`.

### 3.6 Receivables (F5.6, D11)

**Recurring invoices** (decision 10):
- `finance_recurring_invoices`:
  - account, contact, currency, lines (the same line shape);
  - frequency (weekly, monthly, quarterly, yearly, every n);
  - start, end or count, next run;
  - `action` (`draft` or `issue_and_send`);
  - payment terms, active.
- An hourly beat task issues the due ones through the normal invoice service with numbering,
  then sends with the invoice template through workspace SMTP when the action is
  `issue_and_send`.
- *Make recurring* on an invoice copies it into a profile. The list and form live under
  Finance → Recurring invoices, with the shared list page.

**Payment reminders:**
- `finance_reminder_rules`: days relative to the due date (−3, +1, +7 …), a message template,
  active.
- The daily scan sends one reminder per rule per invoice with a balance, through workspace
  SMTP, logged in the invoice's history (`document.reminder_sent`).
- `sales_organizations.no_reminders` stops reminders for an account.
- The reminders are off until an admin adds a rule. Seeded rules start inactive.

**Customer statements:**
- `GET /finance/statements/{org_id}?from&to&kind=activity|open` returns:
  - the opening balance;
  - invoices, payments and credit notes in the period;
  - the closing balance and ageing (current, 1–30, 31–60, 61–90, 90+).
- The statement is a PDF kind of 3.3, with *Send statement* from the account page through
  the composer.

**Write-off:**
- *Write off balance* on an issued invoice whose balance is at most the company's
  `write_off_limit` (default 0 = off), or any balance for users with `finance` *configure*.
- It records a `finance_write_offs` row (invoice, amount, reason, user), counted in
  `refresh_invoice_balance` like a credit, so the invoice reads *Paid*.
- F7 posts it to a write-off account. Until then it is a tracked adjustment (decision 11).

Migration `20261020_receivables`: the three tables,
`sales_organizations.no_reminders`, and `company_profiles.write_off_limit`.

### 3.7 Client portal (F5.7, I9)

- **Invite email:** creating or re-inviting a client account sends the setup link through
  workspace SMTP, with a fixed template that admins can edit later. The admin still sees and
  can copy the link when workspace mail is not configured.
- **Forgot password:**
  - `POST /client/auth/forgot` always answers the same;
  - it emails a single-use reset token (hashed, one-hour expiry) when the account exists;
  - `POST /client/auth/reset` takes the token and the new password;
  - both are rate-limited like login.
- **Plain copy:**
  - setup: "Set your password to sign in to {company}";
  - "Pricing is resolved…" goes;
  - the rest of the jargon goes too (a copy pass over `app/client/`).
- ***Orders*** lists the account's sales orders: every order whose `organization_id` is the
  client account's account and whose status is not draft, plus the client's own requests. It
  shows status, delivery status, total and *Download PDF*.
- ***Invoices*** lists issued invoices with balance and due date, plus *Download PDF*. *Pay*
  waits for payment links, which stay deferred.
- ***Quotes*** gains PDF and the shared accept and decline flow (3.5).
- **Request confirmation:** after submitting, a confirmation panel shows the reference. Portal
  requests get a readable number from `allocate_business_number` (scope
  `client_portal_requests`, prefix `REQ`) in place of the random external reference.
- **Top bar:** the client's name and an account menu (change password, sign out).

The portal keeps its own auth boundary. Every new route is client-auth only and scoped to the
client account's tenant and account.

Migration `20261021_client_portal`: `client_password_resets`. The request number reuses
`external_reference`, so it needs no column.

### 3.8 Permissions, events, backup

- Taxes, document settings, reminder rules and recurring invoices are gated by `finance`
  *configure*, or the recurring-invoice module's own actions. A new seed module
  `finance_recurring_invoices` is added, and the frontend registries get it.
- Events:
  - `quote.expired` (scan);
  - `document.sent`, generic, carrying `module_key`;
  - `invoice.reminder_sent`;
  - `invoice.written_off`.

  Each goes into `webhook_events` where 08a lists the family. Automation triggers come with
  F12.
- Backup and restore cover:
  - tax rates and groups;
  - document settings;
  - PDF snapshots (rows and files);
  - recurring profiles, reminder rules and write-offs;
  - password resets are excluded.
- The recycle bin covers recurring profiles.

### 3.9 Migrations (chain after `20261015_vendor_documents`)

| Revision | Content |
|---|---|
| `20261016_tax_rates` | rates, groups, item and account defaults, `tax_mode`, line `tax_rate_id` / `tax_manual`, PO line tax, the header-rate backfill |
| `20261017_line_editor` | `line_type`, `discount_percent`, `is_optional`, `unit` |
| `20261018_document_pdfs` | `document_pdf_snapshots`, `document_settings`, company branding columns |
| `20261019_quote_lifecycle` | quote statuses and revision / acceptance columns, `quote_validity_days` |
| `20261020_receivables` | recurring profiles, reminder rules, write-offs, account and company flags |
| `20261021_client_portal` | `client_password_resets` |

All IDs are ≤ 32 characters. New Boolean columns get a Python `default=` as well.

## 4. Slices (built in order; no test runs until after F6)

1. **5.1 Tax rates:** settings page, defaults, `line_amounts`, every document's lines and
   totals, the tax summary, the migration, the tax report source.
2. **5.2 Line editor:** line types, discount %, optional lines, reorder and duplicate, unit,
   `lib/money.ts`.
3. **5.3 PDFs:** renderer, templates, snapshots, document settings, preview pages that replace
   the print pages.
4. **5.4 Send:** composer attachments, recipients, templates, history, per-type effects.
5. **5.5 Quotes:** form fixes, expiry scan, lock and convert, revisions, the public page with
   accept and decline.
6. **5.6 Receivables:** recurring invoices, reminders, statements, write-off.
7. **5.7 Client portal.**

Tests written per slice and run in the shared pass:
- `test_tax_rates.py`: precedence, inclusive and exclusive, groups, rounding, flow-through,
  the migration backfill keeping totals;
- `test_line_editor.py`;
- `test_document_pdf.py`: renders each kind; no remote fetch; snapshot on issue;
- `test_document_send.py`;
- `test_quote_lifecycle.py`: expiry scan, accept refused when expired, revise, public accept
  and decline, optional lines;
- `test_receivables.py`;
- `test_client_portal_f5.py`: forgot and reset, orders scope, invoices scope, cross-account
  and cross-tenant refusals.

E2e:
- `commercial-documents.spec.ts`: tax on a quote → order → invoice, PDF download, send dialog;
- `quote-proposal.spec.ts`: public accept and decline;
- the portal spec updated.

New pages go into both guards' route lists.

## 5. Decisions (owner accepted all, 2026-10-08)

1. **PDF engine: WeasyPrint + Jinja2.** It adds about 60 MB of system libraries to the backend
   image. The alternatives are a headless Chromium (heavier, and one more process to keep
   alive) and ReportLab (no HTML, so the preview and the PDF would be two template systems).
2. **Inclusive or exclusive is set per document, with a company default** (Zoho, Xero, QB, BC),
   not per rate as 13 F5.1 says (Odoo). Mixing inclusive and exclusive rates on one document
   confuses customers, and the per-document switch covers retail (inclusive) and B2B
   (exclusive).
3. **The rate lives on the item (`tax_rate_id`).** The `tax_category` picklist stays a label.
   Mapping categories to rates per country is Odoo's fiscal positions or BC's posting groups,
   which is more than we need before UAT.
4. **Tax is rounded per line**, matching the existing per-line money rounding. There is no
   "round on totals" option.
5. **Existing typed tax stays as manual overrides.** Every current line is marked `tax_manual`,
   and the invoice header rate becomes a deactivated line rate. No issued total changes.
6. ***Send* uses the user's own mailbox.** Automatic mail (reminders, recurring invoices, portal
   invites and resets) uses workspace SMTP. With no mailbox, *Send* is disabled with the
   reason and *Download PDF* is offered.
7. **Quote revisions keep the number with an `-R2` suffix** and supersede the old quote,
   which stays readable. The alternative, a new number with a link, loses the thread for the
   customer.
8. **Accepting a quote does not create the order.** It notifies the owner, who converts it
   (Xero, Zoho). Odoo's auto-confirm can be a company setting later.
9. **Section, note and optional lines are on sales documents only.** POs and bills get tax and
   unit, not line types.
10. **Recurring invoices are a separate profile** (Zoho, Xero), not a flag on an invoice. A
    profile has its own schedule and history, and issued invoices stay ordinary.
11. **Write-off is built now as a tracked adjustment**, capped by a company limit, and F7
    posts it. Waiting for F7 would leave small balances showing as unpaid until then.
12. **Reminders are opt-in.** No rule is active until an admin turns one on, so no customer is
    emailed by surprise after the upgrade.

## 6. Out of scope

- Compound taxes, withholding tax, and tax engines (Avalara and the like): after go-live.
- Fiscal positions or tax mapping by country: after go-live (decision 3).
- E-invoicing formats (Peppol, ZATCA, GST e-invoice): an owner decision per market.
- A template editor (drag and drop): the three layouts, branding and per-type text cover it.
- Online payment and *Pay* in the portal: payment links stay deferred.
- Units as a managed list (F6.2), named payment terms (F6), numbering per type (F6).
- Automation triggers on the new events (F12) and posting to the ledger (F7).

## 7. Build notes

**5.1 (2026-10-09).** Where the build differs from §3.1:
- **Purchase documents are tax exclusive only.** Stock is costed and bills are matched on the
  price before tax, so `tax_mode` is on quotes, orders, invoices and credit notes; POs, bills and
  vendor credits always add tax. The Taxes settings page says so.
- **The invoice header discount is gone too**, not only the header rate: the migration spreads
  both over the lines. Invoices then have one mechanism, like quotes and orders.
- **The tax mode is a switch above the line editor**, not a layout field, because changing it
  recomputes every line.
- **"No tax" is a manual tax of zero.** A line that names no rate and types no tax takes the
  default, so older clients and website orders keep working.
- **The tax report is two sources**, *Tax on sales* (issued invoice lines) and *Tax on
  purchases* (posted bill lines). Credit notes and vendor credits reach the tax return through
  F7's ledger, as cost of goods did in F4.
- **Backups match rates by id.** A same-tenant restore keeps every line's rate; a rate renamed
  since the backup is overwritten by the backup's name when the backup wins.

**5.2 (2026-10-09).** Where the build differs from §3.2:
- **Reorder is a row menu** (*Move up*, *Move down*, *Duplicate*), not a drag handle: it works
  from the keyboard, and the line grid has no drag primitive yet.
- **Choosing optional lines** on the proposal page and in the portal comes with 5.5; until then
  an optional line is shown, marked *Optional*, and left out of the total and the order.
- **The unit column appears once a line has a unit** other than "unit"; there is no column
  picker on the line grid.

**5.3 (2026-10-09).** Where the build differs from §3.3:
- **Snapshots are taken on first download or send**, and again when an issued document has
  changed since its latest snapshot, not inside the issuing request. Issuing stays fast and
  needs no background job; an issued document's content is what it was issued as either way.
- **Snapshot files live under `uploads/document-pdfs/`**, not in the documents module, so they
  do not appear in the Documents list. Backups carry the document settings, not the snapshot
  files: an issued document renders the same snapshot again from its unchanged data.
- **Settings → Documents** holds the layout, brand colour, payment details and footer, and the
  per-type title, default terms, notes and email template.

**5.4 (2026-10-09).** Where the build differs from §3.4:
- **No "Sent" badge column on invoices.** The send is on the invoice's history (`document.sent`
  with the recipients), which is where Zoho shows it too; a column can follow if lists need it.
- **Drafts are sent only for quotes and POs** (a quote's first send and an RFQ); every other
  document is sent once issued or posted, and *Send* says why it is unavailable before then.

**5.5 (2026-10-09).** Where the build differs from §3.5:
- **The signature is stored on the quote** (`signature_data`, a PNG `data:` URI of at most
  300k characters), not as a document beside the snapshot. It is small, shown on the quote
  page, and needs no file in backups.
- **No *Revise* on a converted quote.** Decision 7 lists sent, expired and declined; the order
  is where a converted quote changes.
- **Accept and decline are rate-limited per link and address** with the client page limits
  (`PUBLIC_CLIENT_PAGE_ACTION_LIMIT` per window); the events route stays unlimited, as before.
- **The expiry scan runs daily at 00:20 UTC** against each quote's own expiry date, not the
  company's timezone; F6's company timezone (A8) moves it.

**5.6 (2026-10-09).** Where the build differs from §3.6:
- **A fourth table, `finance_reminder_sends`**, records each reminder per rule and invoice. It is
  what makes "one per rule per invoice" hold and lets the invoice page list the reminders; an
  invoice whose customer has no address is recorded as skipped, so it is not retried daily.
- **Recurring lines are stored as JSON** in the invoice payload's shape, not a lines table;
  they are checked through the invoice line function on save and again when each invoice is
  made, so a rate removed since shows on the profile as an error to fix.
- **A past start date begins at the next scheduled date**, not with a backlog of invoices; a
  scan that missed days catches up one period per hourly run.
- **The write-off is the whole open balance**, and can be reversed by a finance administrator
  (an invoice with a write-off cannot be voided until it is). Partial write-offs are a later
  addition if UAT asks.
- **The statement ageing is of today's open balances**, also on an activity statement for a
  past period; ageing as at a past date needs the ledger (F7).
- **No `quote.expired`-style events for reminders and write-offs yet**: 08a has no finance
  family, so they are history rows (`invoice.reminder_sent`, `invoice.written_off`) until F10.
- **The account's *No payment reminders* flag is a layout field**, beside *Tax exempt*.

**5.7 (2026-10-09).** Where the build differs from §3.7:
- **No `REQ` numbering.** Since Step 5 a portal request is a draft sales order with its own
  `SO-…` number, so that number is the reference the confirmation shows; a second sequence
  would give one thing two names.
- **Invoices list issued and void ones**, so a customer can still see an invoice that was
  replaced. Drafts never show.
- **Draft quotes are hidden from the portal**, which they were not before; a quote shows once
  it is sent.
- **Invite and reset emails use `send_transactional_message`** (workspace sender, or the
  platform sender in cloud mode), the same path as CRM invites (B3/B4), rather than the
  workspace sender alone.
- **The templates are fixed text** in `client_access_services.py`; making them editable is F12's
  template work.
- **A password reset does not end sessions already signed in**; client tokens are short-lived
  (`CLIENT_ACCESS_TOKEN_EXPIRE_MINUTES`). Revoking them goes with F13.
- **`/client-auth/setup-info`** is new: the setup page needs the company's name for "Set your
  password to sign in to {company}".

