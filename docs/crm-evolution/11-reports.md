# 11 — Reports

## 1. Objective

Rebuild Reports from one crowded page into a report library, a builder and a report viewer,
benchmarked against Salesforce, HubSpot, Zoho CRM, Dynamics 365 and Odoo. The owner asked for
the best of each, not a copy of any one of them (STATUS.md, 2026-10-01).

## 2. Where Reports stands (inspected 2026-10-01)

- **Backend:** `platform/services/module_reports.py`, routes under `/reports`. Each of 7
  built-in modules and every custom module has an adapter: base query, then a fixed field
  list. A report is **one grouping and one measure** (count, or sum of a numeric field),
  capped at 50 buckets.
- **Saved reports:** `user_module_reports`, one row per owner, `config` JSON
  (`dimension`, `metric`, `metric_field`, `filters`, `view_mode`). They are **private only**.
- **Frontend:** one 918-line page, `app/dashboard/reports/page.tsx`. Presets, the weighted
  forecast, a saved-report picker, a saved-report table, the builder fields, the filter card,
  the chart and the totals all share one scroll. The home dashboard draws a saved report as
  `report_chart` through `DashboardReportChartWidget`.

Defects found by reading it:

1. **Owner groups show user IDs.** `assigned_to` is cast to text, so "Owner performance"
   charts read `7`, `12`, `No value`.
2. **Deal value cannot be summed.** `total_cost_of_project` is text, so the only numeric deal
   field is Probability. The "deal pipeline" preset can only count deals.
3. **Date groups are single days.** Grouping deals by close date gives one bar per day. Every
   benchmark offers week, month, quarter and year.
4. **Stages sort by count, not by pipeline order**, and show stage keys, not labels.
5. **There is no way from a number to its records.** No drill-down.
6. **No relative dates.** "This quarter" has to be typed as two literal dates, and goes stale.
7. **Sharing does not exist.** A report cannot be given to the team.
8. The preset buttons and the saved-report picker load into the builder in place. There is no
   page for a report. A link cannot point at one, and closing the tab loses the work.

## 3. Benchmark

| | Salesforce | HubSpot | Zoho CRM | Dynamics 365 | Odoo |
|---|---|---|---|---|---|
| **Where reports live** | Reports tab: a library with folders, recent, created by me, shared with me | Reports list plus a template library | Reports module with folders | Charts on views; personal and system dashboards | Graph and Pivot views on every list; Favorites |
| **Formats** | Tabular, Summary (up to 3 row groups), Matrix (rows × columns), Joined | Single-object, cross-object, funnel, attribution | Tabular, Summary, Matrix, Joined | A chart is a view plus a grouping | Pivot (row and column headers), Graph, List |
| **Measures** | Record count, sum, avg, min, max, summary formulas | Count, sum, avg, min, max | Sum, avg, min, max | Count, sum, avg, min, max | Any numeric field, several at once |
| **Date grouping** | Day to fiscal year | Daily, weekly, monthly, quarterly | Day, week, month, quarter, year | Day to year | Day, week, month, quarter, year |
| **Date filter** | Standard date filter, relative ranges ("This quarter") | Date range on every report and dashboard | Relative ranges | Relative operators (Last X days) | Relative filters, period comparison |
| **Whose records** | "Show me: My / My team's / All" | Owner and team filters | My / All | My / All in the view | "My …" filters |
| **Drill-down** | Click a group or chart segment | "View data" opens the records | Click a cell | Click a chart segment and the grid filters | Click a pivot cell, get a list |
| **Charts** | Bar, column, line, donut, funnel, gauge, metric | Bar, column, line, area, pie, donut, KPI, table | Bar, line, pie, funnel, KPI, target meter | Bar, column, line, pie, funnel | Bar, line, pie, stacked, cumulative |
| **Sharing** | Folders with view/edit/manage | Private, everyone, or chosen people, view or edit | Folders shared to roles and users | Share a personal chart or view | Favorites shared with all users |
| **Data visibility** | Runs as the viewer (dashboards may run as a fixed user) | Runs as the viewer | Runs as the viewer | Runs as the viewer | Runs as the viewer |
| **Dashboards** | Components, dashboard filters | Report grid, dashboard filters, scheduled email | Charts, KPI, target meter, comparator | System and personal, interactive filters | Spreadsheet dashboards |
| **Scheduling** | Subscriptions | Email a report or dashboard on a schedule | Scheduled reports | Subscriptions via Power Automate | Scheduled actions |
| **Export** | Formatted XLSX, details CSV | XLS, XLSX, CSV | CSV, XLS, PDF | Export to Excel | XLSX from pivot |

What each does best:

- **Salesforce:** the library, and the three formats. Summary, Matrix and Tabular cover nearly
  every report people build. Also *Show me* and the standard date filter, which sit above the
  field filters because almost every report needs them.
- **HubSpot:** the template library. People start from a question ("Deals closed by owner
  this quarter") rather than a blank builder. The builder previews live.
- **Zoho:** KPI, target meter and comparator components. These are a later dashboard phase.
- **Dynamics:** a chart is a view, so it filters exactly like the list. Clicking a segment
  filters the records. Drill-down is the default, not a feature.
- **Odoo:** the pivot. Rows and columns both expand, several measures sit side by side, and
  every cell opens its records. Also date granularity in one click.

What Lynk takes:

1. **Library → viewer → builder**, three routes (Salesforce). A report has a URL.
2. **Three formats:** Summary (up to two row groupings, with subtotals), Matrix (rows ×
   columns), Tabular (a record list with chosen columns).
3. **Up to four measures:** count, sum, average, min and max of numeric fields (Odoo,
   Salesforce).
4. **Date granularity** on every date grouping: day, week, month, quarter, year.
5. **Above the field filters:** *Show me: All / Mine / My team*, then a date filter with
   relative ranges. Saved reports keep the range ("This quarter"), not the dates.
6. **Drill-down everywhere:** clicking a group, a matrix cell or a chart segment opens its
   records in a side panel, each linked to its record (Dynamics, Odoo).
7. **Templates first:** an empty library leads with a template gallery grouped by question
   (HubSpot). This matches the automation templates landed on 2026-10-01.
8. **Sharing:** *Only me* or *Everyone*, view only, with the owner kept as the only editor.
   HubSpot's chosen-people sharing comes later, once teams need it.
9. **Always run as the viewer.** A shared report shows each viewer only what they can see.
   Lynk deliberately does not copy Salesforce's "run as another user" dashboards, which show
   a viewer records their own role cannot open.
10. **Labels, not keys:** owners by name, stages by label in pipeline order, accounts by name.

## 4. Desired behaviour

### 4.1 Routes

```text
/dashboard/reports                 library: My reports, Shared, Templates; New report
/dashboard/reports/new             builder (?module=…, ?template=…)
/dashboard/reports/[reportId]      viewer: chart, table, drill-down, export, Edit
/dashboard/reports/[reportId]/edit builder for a saved report
/dashboard/reports/forecast        the weighted forecast, moved off the library page
```

The forecast moves to its own page. Salesforce and HubSpot both keep forecasting as a separate
tool from reports.

### 4.2 Report definition (config version 2)

```json
{
  "version": 2,
  "format": "summary",
  "groupings": [{ "field": "assigned_to" }, { "field": "expected_close_date", "granularity": "month" }],
  "measures": [{ "aggregate": "count" }, { "aggregate": "sum", "field": "amount" }],
  "scope": "all",
  "date_filter": { "field": "expected_close_date", "range": "this_quarter" },
  "filters": { "all_conditions": [], "any_conditions": [], "search": "" },
  "columns": ["opportunity_name", "assigned_to", "amount"],
  "chart": { "type": "column" },
  "sort": { "by": "value", "direction": "desc" },
  "limit": 25
}
```

- `format`: `summary` (0–2 groupings), `matrix` (exactly 2: rows, then columns), or `tabular`
  (no groupings).
- `scope`: `all`, `mine` (the module's owner field is the viewer), `my_team` (the owner is on
  the viewer's team). Only offered where the module has an owner field.
- `date_filter.range`: `all_time`, `today`, `yesterday`, `this_week`, `last_week`,
  `this_month`, `last_month`, `this_quarter`, `last_quarter`, `next_quarter`, `this_year`,
  `last_year`, `last_7_days`, `last_30_days`, `last_90_days`, `next_30_days`, `next_90_days`,
  `custom` (`start`, `end`). It is resolved in the viewer's time zone at run time.
- `chart.type`: `column`, `bar`, `line`, `donut`, `funnel`, `metric`, `none`. A second
  grouping stacks columns and bars and splits lines. Donut and funnel use the first grouping
  only. `metric` shows the first measure's total.
- Version 1 configs (`dimension`, `metric`, `metric_field`, `view_mode`) are read as version 2
  on load. Nothing is rewritten in the database, and the old endpoints keep answering.

### 4.3 Field catalogue

`GET /reports/modules` returns each reportable module's fields with `field_type` (`text`,
`select`, `number`, `date`, `datetime`, `boolean`, `user`, `reference`), and whether each can
be grouped, measured, filtered or shown as a column. Owner and other user fields are labelled
by name. Deal stage is labelled and ordered by the tenant's pipelines. The deal amount is
numeric through the same parse the pipeline board uses. Custom fields and custom modules keep
working as they do now.

### 4.4 API

| Method | Path | Does |
|---|---|---|
| GET | `/reports/modules` | Field catalogue, extended (old keys kept) |
| POST | `/reports/run` | Run a definition: grouped rows, subtotals, totals |
| POST | `/reports/run/records` | The records behind the report or behind one group or cell, paged |
| POST | `/reports/run/export.csv` | The grouped result, or a tabular report's records (first 5,000; Phase 3 moves larger exports to export jobs) |
| GET | `/reports/templates` | Templates whose module the viewer can see |
| GET | `/reports/saved` | Mine plus shared, `?scope=mine\|shared`, `?search=`, `?module_key=` |
| GET | `/reports/saved/{id}` | One report the viewer owns or that is shared with them |
| POST, PUT, DELETE | `/reports/saved…` | As now, plus `description` and `visibility`. Owner only |

`run` endpoints are POST because a definition does not fit a query string. They read and
change nothing. The old `GET /reports/modules/{key}` and its CSV keep working on the new
engine.

### 4.5 Permissions and tenancy

- Every route needs the `reports` module and an action: `view` to run, `create`, `edit` and
  `delete` for saved reports, `export` for CSV. Running a report also needs `view` on its
  source module, as now. The finance scope and task visibility in each adapter's base query
  still apply.
- A shared report is found by `tenant_id` and `visibility = 'everyone'`. Its definition is
  re-validated against the viewer's fields, so a field the viewer's tenant has turned off
  drops out instead of failing.
- Only the owner edits, renames, re-shares or deletes. Creating, sharing and deleting are
  written to the activity log.

### 4.6 UX

- **Library** (archetype 1, list): `RecordTable` with Name, Module, Owner, Visibility and
  Updated, then search, a module filter and tabs for My reports, Shared with me and
  Templates. An empty library opens on Templates.
- **Viewer** (archetype 5, dashboard): header with the name, description and Edit, Export and
  Delete. A line saying what the report covers ("Deals · Mine · Close date this quarter ·
  2 filters"). Then the totals as a `StatGroup`, the chart, and the table: one `RecordTable`
  with group bands carrying each subtotal for Summary, columns from the column grouping for
  Matrix (the first 12, with every record still counted in the row and grand totals), and
  records for Tabular. A chart past 8 series folds the smallest into *Other*, never a ninth
  hue. Clicking a row, cell or chart segment opens the records in a panel.
- **Builder** (archetype 3, form, with a live preview): a left column of sections (Source,
  Format and grouping, Measures, Filters, Chart, Columns), a preview on the right that reruns
  as the definition changes, *Save* or *Save as* with name, description and visibility, and
  the unsaved-changes guard. Below `lg` the preview follows the form.

## 5. Phases

### Phase 1 — engine, library, viewer, builder (this slice)

Everything in §4, plus the home dashboard's `report_chart` widget moved to the new run
endpoint so a saved version 2 report draws there too. Migration: `description` and
`visibility` on `user_module_reports`.

Acceptance:

- A deal report grouped by Owner shows names. Grouped by Stage, it follows pipeline order.
  Summed by Amount, it shows money.
- Grouping by a date with month granularity gives one group per month, in date order.
- *This quarter* on a saved report gives this quarter's records next quarter too.
- *Mine* shows only the viewer's records. A shared report shows another viewer only what
  they can open. Another tenant's report is a 404.
- Clicking a group or cell lists exactly that group's records, and each opens its record.
- A version 1 saved report still opens, runs and draws on the home dashboard.

### Phase 2 — dashboards

Shared dashboards made of saved reports, with dashboard-level filters (HubSpot, Salesforce)
and a key figure with a target (Zoho).

**Owner ruling (2026-10-01): the home dashboard stays personal.** Shared dashboards live
under Reports → Dashboards, the way Salesforce keeps Home apart from Dashboards. Home can
already show any saved report it can see as a chart widget, so nothing about home changes.

- `report_dashboards`: owner, name, description, `private` or `everyone`, `widgets` (JSON),
  `filters` (JSON). Same sharing as saved reports: the owner is the only editor, and
  creating, sharing and deleting are logged.
- A widget is `{id, type: chart | table | kpi, size, report_id, title, chart_type, target}`,
  at most 24. It holds a report ID, never a definition. Saving needs every widget's report
  to be visible to the owner.
- `GET /reports/dashboards/{id}` resolves each widget for the viewer: the report, or
  `missing`, `not_shared` or `no_access`. A private report on a shared dashboard shows its
  owner the widget and everyone else "This report is not shared with you" (Salesforce).
- Filters: a relative date range (or each report's own) moves every report's date filter to
  that range on the report's date field, or the module's default date when the report has
  none. "Show me" replaces each report's own where the module has owners. They live in the
  address (`?range=`, `?scope=`), and the owner saves defaults in edit mode.
- Edit mode is the home dashboard's: `DashboardWidgetShell`, the size grid and
  `SortableList` are now exported from `DashboardLayoutEditor` and shared.

Not in Phase 2: an owner or team picker as a dashboard filter (only "Show me"), a custom
date range on a dashboard, and dashboard templates.

### Phase 3 — subscriptions and richer export

Scheduled email of a report or dashboard through Celery and the tenant's mail settings. XLSX
export. **Sender ruling (2026-10-01):** scheduled CRM and automation mail uses a tenant-wide
general sender, independent of any employee's personal mailbox. The first use is report
subscriptions; personal inbox mail still uses each person's connection.

The shipped slice gives each viewer one schedule per report or dashboard, sent to their own
account email and evaluated under their permissions at send time. The tenant sender is
configured by an administrator under Settings → Integrations. A report email attaches XLSX;
a dashboard email lists the visible widget totals. Daily, weekly and monthly times are kept
in the subscriber's time zone. Each due send has a delivery row, is claimed once, and shows
failure on the schedule if the sender or access is unavailable. CSV and XLSX are also direct
downloads for the first 5,000 tabular rows; a full XLSX runs as a persisted export job,
up to 100,000 records, and checks access again when generated and downloaded.

### Phase 4 — related-record fields and comparisons

Fields from a parent record (a deal's account industry, a contact's account owner), as in
Salesforce report types. Period comparison (Odoo), bucket fields and conditional highlighting
(Salesforce).

## 6. Out of scope

- Support and contracts modules (owner ruling, see memory and STATUS.md).
- Joined reports, formula fields and arbitrary SQL. Lynk runs no tenant-supplied expressions.
- "Run as another user" dashboards (§3, point 9).
