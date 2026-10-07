# 13b — Step 6: picklists, standard records and one field system

This is the plan for §7 Step 6 of `13-final-fixes.md`: **F2** (picklists and standard records)
and then **F3** (one field system and customization everywhere). Both phases are marked
*research first*, so this file holds the benchmark and the design. It was written on
2026-10-05. **The owner accepted every §5 decision (2026-10-05)** and chose to build Step 6 on top
of Step 5 before Step 5's test pass, so the first test pass (after Phase 3) covers both.

Step 6 comes before F5–F8 because tax categories, units, payment terms, accounting lists,
custom modules and price lists all need picklists and the shared field types.

## 1. Where things stand (inspected 2026-10-05)

**Fixed values are free text or hardcoded:**

| Field | Today | Dev database |
|---|---|---|
| Lead status | `ck_sales_leads_status`: `new`, `contacted`, `qualified`, `unqualified`, `converted`. `LEAD_STATUSES` in `leads_services.py` and `automation_registry.py`; the frontend hardcodes the set in 4 files | all 5 in use |
| Lead source | free text | 5 leads, all empty |
| Account industry | free text | 11 spellings, including `Load Test`, `kaas`, `dev` |
| Account type | none; only the `is_vendor` switch | 10 vendors, 19 others |
| Contact region | free text | `Western Province` ×20, `Asia`, `APAC`, `''` |
| Country (contact, account billing) | free text | `Sri Lanka`, `US`, `''` |
| Deal campaign type | free text | `Inbound`, `Outbound`, `Referral`, `Website` |
| Payment method | free text | `bank_transfer` ×6 **and** `Bank transfer` ×3, `cash`, `card` |
| Product unit | free text | `unit` on all 54 |

**The deal is text where it should be numbers** (A4, C1). `total_cost_of_project` is text (all
dev values parse as integers), `annual_revenue` is text (`LKR 75M`, `1`, `2`), and the agency
fields (`total_leads`, `cpl`, `domain_cap`, `tactics`, `target_audience`,
`target_geography`, `delivery_format`, `campaign_type`, `attachments`) are text columns on
every tenant's deal. `client` is required free text beside the Account link. There is no lost
reason, type, source or next step.

**Addresses and phones are thin** (C2). Accounts have one billing address (five text
columns); contacts have one phone and a free-text country and region; orders have one
free-text `delivery_address`; invoices have `customer_address`; quotes have none. Leads and
contacts need an email (`primary_email NOT NULL`, A9).

**There are two field systems** (F3.1):

| | Custom fields on built-in modules | Custom module fields |
|---|---|---|
| Definitions | `custom_field_definitions` | `custom_module_field_definitions` |
| Values | `custom_field_values` (`value_number` is **JSON**, `value_date` is a **string**) | `custom_module_record_values` (typed: `Numeric`, `DateTime`, `JSON`) |
| Types | `text`, `long_text`, `number`, `date`, `boolean` | `text`, `textarea`, `email`, `phone`, `url`, `single_select`, `multi_select`, `number`, `currency`, `date`, `datetime`, `boolean` |
| Options | none | a list in `validation_json`, no keys, no deactivation |
| Modules | leads, contacts, accounts, deals, quotes, orders | its own module |
| In use (dev) | 5 definitions | 8 fields |

**Customization stops at the Lead quick create.** `ADMIN_LAYOUT_MODULES = {"sales_leads"}`
and `ADMIN_LAYOUT_SURFACES = {"quick_create"}`; the resolver supports `quick_create` and
`detail` on 9 modules, and `full_form` exists only in the check constraint.
`module_field_configs` can hide a field (`is_enabled`) and nothing else. Every create and edit
form is hand-written (`LeadFormFields`, `ContactForm…`). `RuntimeFieldDefinition` already
carries `required` and `readonly`, so the resolver has the shape F3.4 needs.

**Reusable patterns found:**
- Deal stages already separate label from meaning: `sales_pipeline_stages.semantic_type`
  (2E). Lead status follows the same pattern.
- `statusStyles.ts` (rebuild R5) rules that **colour marks exception, not state**: a value
  carries a *tone* (`neutral`, `success`, `attention`, `critical`, or none for categories), and
  `StatusValue` decides how a tone looks. A picklist value's "colour" has to be a tone, or it
  would undo R5.
- Admin customization routes use `require_admin` (`routes/custom_fields.py`).
- `CrmNumberCounter` already issues per-tenant sequences, which an auto-number type can reuse.

## 2. Benchmark

Checked 2026-10-05:

- Salesforce: [global value sets](https://trailhead.salesforce.com/content/learn/modules/picklist_admin/picklist_admin_global), [deactivate or replace a value](https://help.salesforce.com/s/articleView?id=sf.fields_deactivate_reactivate_values.htm&type=5), [picklist limitations](https://help.salesforce.com/s/articleView?id=platform.picklist_limitations.htm&type=5), [lead status *Converted* flag and stage types](https://help.salesforce.com/s/articleView?id=000230496&type=1), [forecast category mapping](https://help.salesforce.com/s/articleView?id=sales.faq_forecasts_category_mapping.htm&type=5), [Dynamic Forms](https://help.salesforce.com/s/articleView?id=platform.dynamic_forms_considerations.htm&type=5), [field-level security vs page layouts](https://cloudcoach.com/blog/manage-project-security-with-page-layouts-and-field-level-security/).
- Dynamics 365 / Dataverse: [choices (option sets)](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/org-service/metadata-option-sets), [create and update choices](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-optionsets), [form order](https://learn.microsoft.com/en-us/dynamics365/customerengagement/on-premises/customize/assign-form-order?view=op-9-1), [forms by security role](https://learn.microsoft.com/en-us/dynamics365/customerengagement/on-premises/customize/control-access-forms?view=op-9-1), [business rules](https://learn.microsoft.com/en-us/dynamics365/customerengagement/on-premises/customize/create-business-rules-recommendations-apply-logic-form?view=op-9-1).
- HubSpot: [property field types](https://knowledge.hubspot.com/properties/property-field-types-in-hubspot), [manage dropdown options](https://knowledge.hubspot.com/properties/manage-enumeration-property-options).
- Zoho CRM: [replace a global picklist value](https://www.zoho.com/crm/developer/docs/api/v8/replace-global-picklist-options.html), [map dependency](https://www.zoho.com/crm/developer/docs/api/v8/map-dependency.html), [custom fields](https://help.zoho.com/portal/en/kb/crm/customize-crm-account/customizing-fields/articles/use-custom-fields).
- Odoo: [Studio fields and widgets](https://www.odoo.com/documentation/18.0/applications/studio/fields.html), [country and state models](https://github.com/odoo/odoo/blob/2ad2f3d6567b6266fc42c6d2999d11f3066b282c/odoo/addons/base/models/res_country.py).

### 2.1 Picklists

| | Salesforce | Dynamics | HubSpot | Zoho | Odoo |
|---|---|---|---|---|---|
| **Shared lists** | Global value sets, always restricted | Global choices (the default) or local | Per property only | Global picklists | Selection (fixed in code) or a many2one to a model, which is a shared list |
| **Stored value** | API name, separate from the label | Integer value, label per language | Internal value, fixed once set; label editable | Actual value, display value editable | Key (selection) or record id |
| **Retire a value** | Deactivate: old records keep it, new ones cannot pick it | Delete only (records keep the integer) | Archive: hidden from pickers, still shown in reports | Move to *Unused values* | Archive the record |
| **Merge** | *Replace*: rewrites every record from one value to another | No | No | *Replace*: rewrites records, criteria, workflow actions and dependencies | No |
| **Meaning behind a label** | Lead status has a *Converted* flag; stages have a type (open, closed won, closed lost), probability and forecast category | Status reason maps onto a fixed state | Deal stages have a probability and open/closed | Stages map to a forecast type | Stage *folded*, *won* flags |
| **Colour** | Chart colours per value | Colour per option | No | Colour per option | Kanban colour per stage |
| **Country** | State and country picklists: ISO codes, admin chooses visible countries | Text by default | Text | Text | `res.country` with ISO codes, `res.country.state` filtered by country |

What each does best:

- **Salesforce:** the cleanest model. A value has an API name that never changes and a label
  that can. Deactivation keeps history readable. Lead status is a tenant list, but one flag
  (*Converted*) carries the logic, so conversion never reads a label.
- **Zoho:** *Replace* also rewrites the places that **refer** to the value (criteria, workflow
  actions, dependencies), not only the records. Without that, merging a value silently breaks
  saved views and automations.
- **Dynamics:** global is the default; local is the exception. Choosing global by default
  stops the "Industry on accounts and Industry on leads drifted apart" problem.
- **HubSpot:** the internal value is fixed once set, and archived values still show in reports,
  which is right for history.
- **Odoo:** country is a reference table with ISO codes, and the state list is filtered by the
  chosen country. The server checks that the state belongs to the country.

### 2.2 Field types, layouts and rules

| | Salesforce | Dynamics | HubSpot | Zoho | Odoo Studio |
|---|---|---|---|---|---|
| **Field system** | One: standard and custom fields share the type set | One (Dataverse columns) | One (properties) | One | One (model fields) |
| **Types** | Text, text area, number, currency, percent, checkbox, date, date/time, email, phone, URL, picklist, multi-select picklist, lookup, auto number, formula, geolocation | Same family plus file, image, customer, owner | Text, number, date, dropdown, multi-checkbox, radio, user, file, calculation | Same family plus lookup, user, auto-number, file, image | 20 in Studio: char, text, integer, decimal, monetary, boolean, date, datetime, selection, many2one, many2many tags, one2many, binary, image, … |
| **Layouts** | Page layouts per object, assigned by profile and record type | Several forms per table, assigned by security role, with a fallback form and a form order | One record layout, conditional property logic | Several layouts per module, assigned by profile | Views per model, by group |
| **Required / read-only** | Field-level (universal: UI, API, import) **or** layout-level (UI only). The stricter wins | *Business required* on the column (UI); business rules set required, read-only, visible | Required on forms | Mandatory on the field (everywhere) or the layout | `required`, `readonly` on the field or the view |
| **Dependent lists** | Controlling and dependent picklists | Filtered choice (with code or a plugin) | Conditional options on forms | Map dependency, per layout | Domain on a many2one |
| **Inline create** | *New* from a lookup | *+ New* from a lookup (quick create form) | *Create* from association panel | *Create* from lookup | *Create and edit…* in every many2one |
| **Clone** | *Clone* opens an unsaved copy; *Clone with related* | *Copy* (some tables) | *Clone* | *Clone* opens a copy | *Duplicate* saves a copy at once, `(copy)` suffix |

What Lynk takes:

1. **One picklist primitive with stable keys and editable labels** (Salesforce, HubSpot).
   Records store the key. Values are deactivated, never deleted.
2. **Global by default, local when one field needs its own list** (Dynamics).
3. **Merge rewrites records and the places that refer to the value**: saved views, automation
   conditions and actions, dependencies, layouts' defaults (Zoho *Replace*).
4. **Logic-bearing lists carry a fixed meaning per value** (Salesforce's *Converted* flag, stage
   types), the same pattern as Lynk's deal stages. Labels are free; logic reads the meaning.
5. **A tone, not a colour** per value. Lynk's R5 rule wins over the colour pickers of Dynamics
   and Zoho: tone is the only colour vocabulary Lynk has.
6. **Country as a system list of ISO codes, states filtered by country** (Odoo, Salesforce state
   and country picklists), and the server checks the pair.
7. **One field system** shared by standard fields, custom fields on every module, and custom
   modules (all five).
8. **Layouts per module and surface, with role and team overrides and a fallback** (Dynamics'
   form order and fallback form; Salesforce's assignment by profile).
9. **Field rules on the field, enforced by the server** (Salesforce's universally required), with
   the stricter rule winning when a layout also sets one.
10. **Create from inside a picker** (all five) and **Clone that opens an unsaved copy**
    (Salesforce, Zoho), not Odoo's save-at-once duplicate, which leaves junk records behind.

## 3. Design

### 3.1 Picklists (F2.1, F2.2)

```text
picklists          id, tenant_id, key, label, scope ('global' | 'local'),
                   meaning_set (NULL | 'lead_status'), is_system (seeded list; cannot be deleted),
                   created_at, updated_at
                   unique (tenant_id, key)

picklist_values    id, tenant_id, picklist_id, key, label, position, is_active, is_default,
                   tone (NULL | 'neutral' | 'success' | 'attention' | 'critical'),
                   meaning (NULL, or one of the list's meaning_set),
                   created_at, updated_at
                   unique (tenant_id, picklist_id, key)
                   unique (picklist_id) where is_default
```

- **The key is fixed once created** (slug of the first label, de-duplicated). Renaming changes
  the label only, so it never touches records.
- **Records store the key** in their existing text column. Validation in the service: the key
  must be an active value of the field's list, or the value the record already holds (an
  inactive value stays on old records until someone changes it).
- **Merge A into B:** rewrites every field that uses the list (records, custom field values),
  saved-view filters, automation conditions and actions, dependency maps and layout defaults,
  then deactivates A. Over 5,000 records it runs as a `data_transfer_jobs` job on Celery, under
  one unit of work per chunk. The activity log records the merge with counts.
- **Every value change** (add, rename, reorder, deactivate, default, tone, merge) writes an
  activity log entry on the list.
- **Lists the platform defines** are seeded per tenant with `is_system`: their values are
  editable, the list cannot be deleted, and its key is what code refers to.
- **Admin:** Settings → **Picklists**, behind `require_admin` like custom fields today. A list
  page (name, scope, used by, value count) and a list editor: values in order (drag), add,
  rename, deactivate, default, tone, meaning (logic-bearing lists only), *Merge into…*, and a
  **Values not in the list** panel (distinct stored values that match no key, with counts and
  *Add to list* or *Merge into…*). That panel is how free-text leftovers and unmatched
  countries reach the admin.

**Logic-bearing statuses (F2.2).** Lead status becomes the `lead_status` list with
`meaning_set = 'lead_status'`: `open`, `working`, `qualified`, `unqualified`, `converted`.
- The existing keys stay, so no lead is rewritten: `new` → *open*, `contacted` → *working*,
  `qualified`, `unqualified`, `converted`.
- Each meaning except `working` must keep at least one active value. Conversion writes the
  list's default `converted` value; scoring, conversion guards, automation, reports and the
  frontend read the meaning.
- `ck_sales_leads_status` and `LEAD_STATUSES` are dropped; the frontend's 4 hardcoded copies
  are replaced by the list.
- Document lifecycles (quote, order, invoice, PO, bill, delivery, return, payment) stay fixed,
  as in every major ERP. Deal stages stay pipelines (2E).

### 3.2 Standard fields that become picklists (F2.3)

| Field | List (scope) | Migration |
|---|---|---|
| Lead source; deal source (new) | `lead_source` (global) | Distinct values become values |
| Lead status | `lead_status` (local, meanings) | Keys kept (§3.1) |
| Account industry | `industry` (global) | 11 spellings become values; case-insensitive duplicates merged |
| Account type (new) | `account_type` (local): prospect, customer, partner, competitor, other | Accounts with orders or invoices → customer, the rest empty (§5 decision 4) |
| Contact region | `region` (local) | Distinct values become values; `''` → empty |
| Contact salutation (new) | `salutation` (local): Mr., Ms., Mrs., Mx., Dr., Prof. | — |
| Deal type (new) | `deal_type` (local): new business, existing business | — |
| Deal lost reason (new); quote declined reason (new); order cancellation reason (new) | `lost_reason` (global): price, competitor, no budget, no decision, timing, other | — |
| Payment method | `payment_method` (global): cash, bank transfer, card, cheque, online | `Bank transfer` merged into `bank_transfer` |
| Product unit | `unit` (global): unit | F6.2 adds conversions |
| Shipping method (new, quotes and orders) | `shipping_method` (local) | — |
| Product tax category (new) | `tax_category` (local): standard, reduced, zero, exempt | F5 attaches rates |

Deal campaign type moves to a custom picklist field with the other agency fields (§3.5).

**Country (F2.4)** is a system list, not a picklist row: ISO 3166-1 alpha-2 codes stored,
names shown, from a bundled data file (§5 decision 6). A tenant setting limits which countries
appear in pickers. Migration matches names and codes case-insensitively (`Sri Lanka` → `LK`,
`US` → `US`); `''` becomes empty. Anything else stays where it was and shows in the *Values not
in the list* panel. States and provinces follow in Phase 4 (§3.6).

### 3.3 Picklists across the platform (F2.5)

One `field_types` registry (§3.4) gives the picklist type its behaviour everywhere:
- **Filters, saved views, inline filters:** *is any of*, *is none of*, *is empty*, *is not
  empty*, with a value picker (inactive values shown as such).
- **Reports:** group-by shows labels in list order; filters as above.
- **Import:** accepts the key or the label, case-insensitively. An unknown value is refused,
  unless the admin ticks *Add unknown values to the list* on the import (`configure` only).
- **Export:** labels (what the user sees); the import accepts them back.
- **List cells and record headers:** `StatusValue` with the value's tone; no tone, plain ink.
- **Automation:** conditions and *set field* actions take a value picker; logic-bearing lists
  also offer the meaning (*Lead status meaning is qualified*).
- **Webhook payloads:** the key (08a's rule: payloads carry stable identifiers).
- **Frontend:** `usePicklist(listKey)` (cached, invalidated on admin change), `PicklistSelect`,
  `PicklistMultiSelect`, built on the existing `SearchableSelect`.

### 3.4 One field system (F3.1, F3.2)

```text
field_definitions   id, tenant_id, module_key, field_key, label, field_type, source ('custom'),
                    picklist_id, lookup_module_key, is_required, is_unique,
                    default_value JSON, config JSON (min, max, precision, max_length,
                    auto-number prefix), help_text, placeholder, sort_order, is_active,
                    created_at, updated_at
                    unique (tenant_id, module_key, field_key)

field_values        id, tenant_id, module_key, record_id, field_definition_id,
                    value_text, value_number NUMERIC(28,8), value_date DATE,
                    value_datetime TIMESTAMPTZ, value_boolean, value_json (multi-select keys,
                    file ids), value_record_id BIGINT (lookup, user),
                    created_at, updated_at
                    unique (tenant_id, module_key, record_id, field_definition_id)
                    index (field_definition_id, value_text), (field_definition_id, value_number),
                          (field_definition_id, value_date), (field_definition_id, value_record_id)
```

- **The types:** text, long text, number, decimal, currency, percent, yes/no, date, date-time,
  email, phone, URL, picklist, multi-select picklist, user, record lookup, file, auto-number.
- **One registry per side:** `app/core/field_types.py` (validate and normalize, storage
  column, filter operators, sort expression, CSV parse and format, report kind, webhook form)
  and `frontend/lib/fieldTypes.tsx` (form control, list cell, filter input, read-only display).
  The layout resolver, custom fields, custom modules, filters, reports, imports and exports all
  read the registry instead of their own type checks.
- **Custom modules move onto it.** Their fields become `field_definitions` with the custom
  module's module key, and their values move to `field_values`. `custom_field_definitions`,
  `custom_field_values`, `custom_module_field_definitions` and `custom_module_record_values`
  are dropped in the same migration (owner decision 11). `textarea` → long text,
  `single_select` → picklist (its option list becomes a local picklist), `multi_select` →
  multi-select picklist.
- **EAV stays** rather than a JSON column per table: 18 tables would each need the column, and
  every existing consumer (the `custom:` filters, reports, exports, layouts) already reads
  values by definition. The typed columns and indexes fix today's `value_number` JSON and
  string dates, which cannot sort or range-filter.
- **Custom fields on every module (F3.2):** products, services, invoices, credit notes,
  payments, POs, receipts, bills, deliveries, returns, adjustments and transfers join the six
  CRM modules. Each gets: values on create and update, the document header form, the detail
  page, export, reports and the API. **List columns and filters on the ERP document lists come
  with F4**, which gives those lists saved views; until then the values are on the record.
- **Record lookup** stores the target id in `value_record_id` and resolves through
  `linked_record_options` with the same tenant and permission checks as standard links.

### 3.5 Standard records (F2.6)

**Deals (A4, C1).**
- `amount NUMERIC(18,2)` and `currency` (renamed from `currency_type`), backfilled by parsing
  `total_cost_of_project` (digits, separators, `K`/`M` suffixes). Values that do not parse stay
  empty and the migration prints them per tenant (no users exist, so no admin queue is needed;
  §5 decision 7).
- `lost_reason` (picklist), `next_step` (text), `deal_type` (picklist), `source` (the
  `lead_source` list; filled from the lead on conversion).
- `client` is dropped. A deal whose `client` matches no linked account gets the account matched
  by name in the tenant, or a new account named after it; then *Account or Contact* is required.
- **The agency fields become custom fields**, with their data, in tenants where any deal has a
  value: `total_leads` (number), `cpl` (currency), `domain_cap` (text), `tactics`,
  `target_audience` (long text), `target_geography`, `delivery_format` (text),
  `campaign_type` (picklist, its values from the data), `attachments` (long text). The columns
  are dropped. Tenants without data never see them.

**Accounts.** Billing **and** shipping addresses, structured (§3.6). `annual_revenue` becomes
`NUMERIC(18,2)` in the base currency (parsing `LKR 75M` → 75,000,000), plus `employee_count`
(integer). `account_type` (§3.2). The *Vendor* switch stays a separate yes/no (§5 decision 4).

**Contacts.** `contact_telephone` → `work_phone`, plus `mobile_phone`, `salutation`, and a
structured mailing address replacing `region`/`country` (region stays as its own picklist).
Leads get `mobile_phone` too, so conversion can carry it.

**Leads and contacts: email optional (A9).** `primary_email` becomes nullable, with a check
that a lead or contact has an email or a phone (any of phone, mobile, work). Every place that
assumes an email is reviewed: duplicate matching, conversion's contact match, the mail
composer's recipients, client portal invites, website order matching, mail association.

**Deal page and form (H13).**
- *Create quote* and *Create order* in the header and *New* on the Quotes card, prefilled
  from the deal.
- *Mark won* and *Mark lost* are the stage, not two more buttons: design.md §4.7 already rules
  a `Won`/`Lost` header pair a second control for the value the rail edits. Moving a deal into
  a lost stage — from the rail, the board or the form — asks for the reason first, and the
  server refuses a move into a lost stage without one; reopening a deal drops it. This is
  how Salesforce's Path behaves (choosing *Closed Lost* prompts for the reason). Built
  2026-10-06; the separate `/won` and `/lost` routes were removed in the same slice.
- One label, *Amount*, on the list, record, form and board, formatted with its currency.
- Currency defaults to the base currency; probability defaults to the stage's and follows a
  stage change until the user edits it.
- *Contact* optional; *Account or Contact* required.

**Lead quick create (H25):** *Source* in the default layout.

**Quotes and orders (C3).**
- `billing_*` and `shipping_*` address snapshots, copied from the account when it is picked,
  editable on the document; the order's free-text `delivery_address` migrates into the
  shipping street; quote → order and order → invoice copy them.
- `customer_po_reference`, `terms_and_conditions` (empty until F6 adds a tenant default),
  `shipping_method` (picklist) and `shipping_charge` (§5 decision 8).

**Products (C4).**
- `list_price`, separate from `public_unit_price` (the website price), backfilled from it. Line
  editors default to the list price.
- Several images: `catalog_item_images` (ordered; the first is the main image) on the existing
  uploads primitive; the current image becomes the first.
- `weight` and `weight_unit`, `length`, `width`, `height` and `dimension_unit` (small system
  lists: kg, g, lb, oz; cm, m, in).
- `tax_category` (picklist; F5 attaches rates).
- **Vendor prices and codes for several vendors stay in F6** with price lists, where the plan's
  own label puts them.

### 3.6 Addresses, layouts and rules (F3.3–F3.6)

**Address** is a compound field in the registry: `street`, `street2`, `city`, `state_code`,
`postal_code`, `country_code`, stored as prefixed columns (`billing_street`, …), the way
Salesforce stores compound addresses. One `AddressFields` control and one formatter.

**Layout admin for every module and surface (F3.3).**
- `ADMIN_LAYOUT_MODULES` and `ADMIN_LAYOUT_SURFACES` go; every module in
  `SUPPORTED_LAYOUT_SURFACES_BY_MODULE` is editable on every surface it has.
- `full_form` is added for leads, contacts, accounts, deals, quotes, orders, products and
  services, and the ERP documents get `detail` and `full_form` **header** layouts. Line editors
  stay fixed.
- The hand-written forms are replaced by one layout-driven `RecordForm` (the quick-create
  renderer grown up); the four `*QuickCreateLayoutFields` copies collapse into it (E7).
- Settings → **Layouts** generalizes today's Lead quick-create editor: module and surface
  picker, sections, field order, widths, visibility, and a preview.

**Field rules (F3.4).** `module_field_configs` gains `is_required` and `is_readonly`
(`is_enabled` stays as visibility). The resolver puts them on each field; the stricter of
field and layout wins. `enforce_field_rules(db, tenant_id, module_key, payload, existing)`
runs in every service's create and update (§5 decision 9 for which writes). Fields the business
logic needs stay required and cannot be relaxed (`MODULE_PROTECTED_FIELD_KEYS` grows into
this).

**Role and team overrides (F3.5, 09 Phase 3).** `record_layout_definitions` gains `role_id` and
`team_id` (at most one). An override is a **complete layout** derived from a base version, not
a diff (09 asks for one model with no ambiguous merge). Resolution: the user's team override,
then role override, then the tenant default, then the product default. Deleting an override
falls back cleanly. The editor shows *Preview as role / team*.

**Dependent picklists (F3.6).** `picklist_dependencies`: `tenant_id`, `module_key`,
`controlling_field_key`, `dependent_field_key`, and a map of controlling key → allowed
dependent keys. The form filters; the server refuses a pair outside the map. **Country →
state/province is built in**: a bundled ISO 3166-2 list, filtered by country, checked by the
server.

### 3.7 Quick create and clone (F3.7, F3.8)

- **Products and services** get `quick_create` layouts and `QuickCreateSurface`.
- **Create "…" inside pickers** (`LinkedRecordPicker` and the line editor's item picker): a
  product in the line editor, a vendor account in the PO and bill vendor picker (created with
  *Vendor* on), a contact in the quote and order picker. Each opens the target's quick create,
  prefilled with the typed text, and selects the new record.
- **Clone** on leads, contacts, accounts, deals, quotes, orders, products, services, POs and
  custom-module records: `?clone=<id>` on the module's `new` page loads the source through a
  shared `GET …/{id}/clone-draft` that returns the copyable fields, custom fields and lines,
  never numbers, statuses, totals, links to generated documents or history. The user saves it
  as an ordinary create.

### 3.8 Permissions, events, backup

- Picklist, field, layout and dependency admin: `require_admin`, as custom fields today.
  Reading a list's active values: any authenticated user of the tenant.
- New tables join the tenant backup and restore (with a round-trip test, as G1 requires) and
  the recycle bin where they hold records (`catalog_item_images` with its product).
- Webhooks: no new event types; payloads carry picklist keys and custom fields by
  `field_key`, as 08a already says.

### 3.9 Migrations

Revision IDs stay under 32 characters and sit after `20261007_retire_modules`:

| Revision | Phase | What |
|---|---|---|
| `20261008_picklists` | 1 | Lists, values, seeds per tenant, lead status meanings, data rewritten to keys, `ck_sales_leads_status` dropped, payment method and industry duplicates merged, countries matched |
| `20261009_field_system` | 2 | `field_definitions`, `field_values`; both old field systems migrated and dropped |
| `20261010_standard_records` | 3 | Deal amount and new fields, agency fields to custom fields, `client` dropped, addresses, phones, optional email, quote and order fields, product fields and images |
| `20261011_layout_rules` | 4 | Field rule columns, layout role/team columns, `picklist_dependencies` |

Every downgrade refuses, as `20261007_retire_modules` does: data moves in one direction.

## 4. Phases

Built in this order, which is F2 and F3 reordered so data migrates once (§5 decision 1):

**Phase 1 — Picklists.** §3.1–3.3: the primitive, Settings → Picklists, lead status meanings,
country, the standard fields of §3.2 that already exist, and picklists across filters, reports,
import, export, automation and webhooks.

**Phase 2 — One field system.** §3.4: the registry on both sides, the two old systems migrated
and dropped, the 18 types plus the compound address, custom fields on every module.

**Phase 3 — Standard records.** §3.5 on top of Phases 1–2: the agency fields land as real
custom fields, the new picklist fields get their lists, the deal page and form (H13), lead
quick create *Source*, addresses (using the address type), quotes, orders and products.

**Phase 4 — Layouts and rules.** §3.6: layout admin everywhere, `RecordForm`, field rules,
role and team overrides, dependent picklists, country → state.

Phase 4 is built in five slices, so a session can stop between any two (split 2026-10-06):

| Slice | What | State |
|---|---|---|
| 4a | Field rules (F3.4): `is_required` / `is_readonly` on `module_field_configs`, `enforce_field_rules` in the CRM routes, the resolver, Settings → Fields | **Built 2026-10-06, tested and committed 2026-10-08** (see STATUS) |
| 4b | Dependent picklists and country → state (F3.6): `picklist_dependencies`, ISO 3166-2 filter, server check, form filtering | **Built 2026-10-06, tested and committed 2026-10-08** (see STATUS) |
| 4c | Role and team layout overrides (F3.5): `role_id` / `team_id` on `record_layout_definitions`, resolution team → role → tenant → product, *Preview as*. Also: field rules and dependencies enforced on sales orders, products, services and every ERP document | **Built 2026-10-06, tested and committed 2026-10-08** (see STATUS) |
| 4d | Layout admin everywhere (F3.3): drop `ADMIN_LAYOUT_MODULES` / `ADMIN_LAYOUT_SURFACES`, `full_form` seeds, ERP header layouts, Settings → Layouts module and surface picker | **Built 2026-10-06, tested and committed 2026-10-08** (see STATUS). Pages consume the new layouts in 4e |
| 4e | `RecordForm` (F3.3, E7): one layout-driven form replacing the hand-written forms and the four `*QuickCreateLayoutFields` | **Built 2026-10-06/07, tested and committed 2026-10-08** (see STATUS): `RecordForm` on every quick create and full form (CRM, quotes, orders, invoices, catalog, nine ERP documents), ERP detail headers on the `detail` layouts, live full-form preview, imports apply field rules |

Migrations: 4a is `20261011_field_rules` (the §3.9 `20261011_layout_rules` split per slice),
4b is `20261012_picklist_deps`, 4c is `20261013_layout_overrides`.

**Deviation from §3.6 (4b):** an address's state column keeps the subdivision's **name**
(`California`), not its code (`US-CA`). Codes and any spelling are accepted on input and
stored as the bundled name, so every list, export, report and print reads correctly without
a label lookup per surface; the country stays a code because its picklist labels were already
everywhere. Countries the ISO list does not divide keep a free-text state.

**Deviation from §3.6 (4e):** a document's source references (a receipt's purchase order, a
return's delivery, a credit note's invoice and return, a bill's order and receipt) are shown,
not picked: the action that starts the document sets them, and no update endpoint changes
them.

**Phase 5 — Quick create and clone.** §3.7. **Built 2026-10-07, tested and committed 2026-10-08** (see STATUS).
The clone draft endpoint is `GET /records/{module}/{id}/clone-draft`, one platform route for
every module rather than one per module router. Beyond §3.7: the purchase order line editor
also offers *Create product* (tracked, the PO's vendor as preferred vendor), and invoices get
the line editor's *Create product* with quotes and orders, since they share it.

**Tests written with each phase, run in the step's test pass** (§5 decision 2):
- backend: `test_picklists` (keys fixed, deactivate, merge rewrites records, views and
  automation, meanings guard, tenant isolation), `test_field_system` (each type's validation,
  storage, filter, sort, CSV round trip; old systems migrated), `test_standard_records`
  (amount parse, agency migration, optional email check, account-or-contact, address copy),
  `test_field_rules` (required and read-only enforced; protected fields cannot relax),
  `test_layout_overrides` (precedence, fallback), `test_clone_drafts`; the backup round trip
  extended to the new tables;
- e2e: `picklists.spec.ts`, `field-system.spec.ts`, `deal-record.spec.ts` (H13),
  `layout-admin.spec.ts`, `clone-and-inline-create.spec.ts`; the new Settings pages added to
  both guards' route lists;
- `verify_migrations` replays all four revisions; `codex-check.sh`; the touched existing
  specs (leads, deals, contacts, accounts, quotes, orders, catalog, purchasing, module builder,
  custom modules, reports, automation, imports).

## 5. Decisions (owner accepted all, 2026-10-05)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Order inside Step 6 | **Picklists → one field system → standard records → layouts and rules → quick create and clone.** F3.1 moves ahead of F2.6 so the agency fields and the new typed fields migrate once, into the final field system, instead of into today's custom fields and then again |
| 2 | Test passes | **Two:** after Phase 3 (F2 complete and the field system; commit), and after Phase 5 (commit). One pass for all five phases would put four migrations and most forms in one untested diff. One pass at the end is the alternative if you prefer the strict "one per step" |
| 3 | Picklist value colour | **A tone** (`neutral`, `success`, `attention`, `critical`, none), not a free colour. Keeps rebuild R5 ("colour marks exception, not state") and the token rules; Dynamics and Zoho offer free colours, but Lynk has no colour vocabulary beyond tones |
| 4 | Account type and the *Vendor* switch | **Type is a single picklist (prospect, customer, partner, competitor, other) and *Vendor* stays its own yes/no.** The plan said the switch maps onto the type, but an account is often a customer and a vendor at once; Odoo (customer and supplier ranks) and Business Central (separate customer and vendor cards) keep the roles independent, and the PO and bill pickers keep working unchanged |
| 5 | One `lost_reason` list for deals, quotes and orders | **Yes, one global list**; an admin can give any of them a local list later |
| 6 | Country and state data | **Bundle ISO 3166-1 and 3166-2 as a JSON file generated once from the Debian `iso-codes` data** (what `pycountry` ships), no runtime dependency. The alternative is adding `pycountry` (LGPL) to the lock |
| 7 | Deal amounts and revenue that do not parse | **Left empty, listed by the migration's output.** No users exist (owner decision 11), and every dev value parses, including the test values `1` and `2` |
| 8 | Shipping charge on quotes and orders | **A header amount (Zoho), carried to the order's first invoice as a line**, so F5 can tax it like any line. Odoo's alternative, a delivery product line, needs a delivery product per tenant |
| 9 | Which writes enforce admin-required and read-only | **User writes: the app, the API with user auth, and imports.** System writes (public website orders, the client portal, lead conversion, automation) keep only the domain's required fields, so a tenant making *Customer PO reference* required does not start refusing website orders. Salesforce enforces universally; Dynamics only in the UI; this sits between |
| 10 | Layout overrides | **Complete layouts per role or team, team before role**, as 09 Phase 3 asks (one model, no merge). Dynamics assigns forms by role with a fallback; Salesforce by profile |
| 11 | Clone of documents with lines | **Opens an unsaved full form with the lines** (Salesforce, Zoho). Odoo's save-at-once duplicate is not used |
| 12 | Multiple ship-to addresses per account (C2's "multiple delivery addresses") | **After go-live.** One billing and one shipping address on the account, editable on each document, covers UAT; a ship-to list (Business Central, Odoo child addresses) is additive later |

## 6. Out of scope

- Vendor price lists and codes for several vendors (F6), unit conversions (F6.2), the default
  terms and conditions (F6), tax rates on the tax category (F5).
- List columns and filters on ERP document lists (F4, with their saved views).
- Formula and roll-up field types; translations of picklist labels; record types.
- Custom-module relationships, related lists and automation (F8, built on Phase 2).
- C6 naming across tables, beyond the columns this step touches anyway.
