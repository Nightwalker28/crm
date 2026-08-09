import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

type AutomationRule = {
  id: number; name: string; description: string; module_key: string; enabled: boolean; trigger_event: string;
  condition_mode: "all" | "any"; conditions_json: Record<string, unknown>[]; actions_json: Record<string, unknown>[]; updated_at: string;
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  let canEnable = false;
  let nextId = 50;
  let rules: AutomationRule[] = [
    { id: 41, name: "High priority lead follow-up", description: "Create urgent follow-up work.", module_key: "sales_leads", enabled: true, trigger_event: "lead.created", condition_mode: "all", conditions_json: [{ field: "status", operator: "equals", value: "new", values: [] }], actions_json: [{ type: "create_task", title: "Call lead", priority: "high", due_in_days: 1, assignee_user_id: "actor" }, { type: "add_record_note", body: "Urgent follow-up created." }], updated_at: "2099-07-23T10:00:00Z" },
    { id: 42, name: "Dormant lead reminder", description: "Remind the owner.", module_key: "sales_leads", enabled: false, trigger_event: "lead.updated", condition_mode: "all", conditions_json: [], actions_json: [{ type: "create_task", title: "Review dormant lead", priority: "medium", due_in_days: 3, assignee_user_id: "actor" }], updated_at: "2099-07-23T11:00:00Z" },
  ];

  await page.route("**/admin/automation-rules/trigger-registry", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ module_key: "sales_leads", triggers: [{ key: "lead.created", module_key: "sales_leads", label: "Lead created", description: "A sales lead is created." }, { key: "lead.updated", module_key: "sales_leads", label: "Lead updated", description: "A sales lead is updated." }] }] }) }));
  await page.route("**/admin/automation-rules/condition-fields?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ key: "status", payload_key: "status", module_key: "sales_leads", label: "Status", field_type: "select", operators: ["equals", "not_equals"], options: [{ value: "new", label: "New" }, { value: "qualified", label: "Qualified" }] }] }) }));
  await page.route("**/admin/automation-rules/action-registry?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ key: "create_task", category: "record", label: "Create task", description: "Create a follow-up task.", module_keys: ["sales_leads"], fields: [{ key: "title", label: "Title", field_type: "text", required: true, placeholder: "Follow up", options: [] }, { key: "priority", label: "Priority", field_type: "select", required: false, placeholder: null, options: [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }] }, { key: "due_in_days", label: "Due in days", field_type: "number", required: false, placeholder: "1", options: [] }, { key: "assignee_user_id", label: "Assignee", field_type: "actor_or_user_id", required: false, placeholder: "actor", options: [] }] }, { key: "add_record_note", category: "record", label: "Create note", description: "Add a note.", module_keys: ["sales_leads"], fields: [{ key: "body", label: "Note", field_type: "textarea", required: true, placeholder: "Note", options: [] }] }] }) }));
  await page.route("**/admin/automation-rules/preview", async (route) => {
    const payload = route.request().postDataJSON() as { name: string; actions_json: unknown[] };
    canEnable = canEnable || payload.name.includes("Valid");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: canEnable, can_enable: canEnable, module_key: "sales_leads", trigger_event: "lead.created", condition_mode: "all", condition_count: 1, action_count: payload.actions_json.length, warnings: canEnable ? [] : ["Rule is not ready."], actions: [] }) });
  });
  await page.route("**/admin/automation-rules/runs?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ id: 91, rule_id: 41, rule_name: "High priority lead follow-up", event_id: 501, trigger_event_key: "lead.created", source_module_key: "sales_leads", source_record_id: "88", source_label: "Ada Lovelace", status: "succeeded", input_json: { email: "ada@example.test", token: "[REDACTED]" }, result_json: { task_id: 701 }, step_results_json: [{ type: "create_task", status: "success" }], action_attempt_count: 1, action_success_count: 1, action_failed_count: 0, error_message: null, started_at: "2099-07-23T10:00:00Z", finished_at: "2099-07-23T10:00:01Z", completed_at: "2099-07-23T10:00:01Z" }] }) }));
  await page.route(/\/admin\/automation-rules\/\d+$/, async (route) => {
    const id = Number(route.request().url().split("/").pop());
    if (route.request().method() === "DELETE") { rules = rules.filter((rule) => rule.id !== id); await route.fulfill({ status: 204 }); return; }
    const payload = route.request().postDataJSON() as Partial<AutomationRule>;
    const current = rules.find((rule) => rule.id === id)!;
    const updated = { ...current, ...payload, updated_at: "2099-07-23T12:00:00Z" };
    rules = rules.map((rule) => rule.id === id ? updated : rule);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updated) });
  });
  await page.route(/\/admin\/automation-rules(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Omit<AutomationRule, "id" | "updated_at" | "module_key">;
      const created = { ...payload, id: nextId++, module_key: "sales_leads", updated_at: "2099-07-23T12:00:00Z" } as AutomationRule;
      rules.push(created); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created) }); return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: rules }) });
  });
});

test("shows a dense rules workspace with search and status filtering", async ({ page }) => {
  await page.goto("/dashboard/settings/automation");
  await expect(page.getByRole("columnheader", { name: "Rule" })).toBeVisible();
  await expect(page.getByText("High priority lead follow-up", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search rules").fill("Dormant");
  await expect(page.getByText("Dormant lead reminder", { exact: true })).toBeVisible();
  await expect(page.getByText("High priority lead follow-up", { exact: true })).toBeHidden();
  await page.getByLabel("Status filter").click();
  await page.getByRole("option", { name: "Enabled" }).click();
  await expect(page.getByText("No rules match these filters")).toBeVisible();
});

test("shows distinct loading, error, and empty rule-list states", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/admin\/automation-rules(?:\?.*)?$/, async (route) => { await pending; await route.fulfill({ status: 500, contentType: "application/json", body: "{}" }); });
  await page.goto("/dashboard/settings/automation");
  await expect(page.getByLabel("Loading automation rules")).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText("Automation rules could not be loaded");

  await page.unroute(/\/admin\/automation-rules(?:\?.*)?$/);
  await page.route(/\/admin\/automation-rules(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }));
  await page.reload();
  await expect(page.getByText("No automation rules yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create rule" })).toBeVisible();
});

test("creates a rule with multiple actions through the existing API", async ({ page }) => {
  await page.goto("/dashboard/settings/automation");
  await page.getByRole("button", { name: "Create rule" }).click();
  await page.getByRole("button", { name: /Untitled automation/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Valid new lead workflow");
  await page.getByRole("button", { name: "Done editing" }).click();
  await page.getByRole("button", { name: "Action", exact: true }).click();
  await page.getByRole("button", { name: "Done editing" }).click();
  await page.getByRole("button", { name: "Action", exact: true }).click();
  await page.getByRole("button", { name: "Done editing" }).click();
  const create = page.waitForRequest((request) => request.method() === "POST" && /\/admin\/automation-rules$/.test(request.url()));
  await page.getByRole("button", { name: "Save rule" }).click();
  const payload = (await create).postDataJSON() as { name: string; actions_json: unknown[] };
  expect(payload.name).toBe("Valid new lead workflow");
  expect(payload.actions_json).toHaveLength(2);
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("edits multiple steps, reorders actions, guards unsaved exit, and saves", async ({ page }) => {
  await page.goto("/dashboard/settings/automation");
  await page.getByText("High priority lead follow-up", { exact: true }).click();
  await page.getByText("High priority lead follow-up", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rule settings" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Valid urgent lead workflow");
  await page.getByRole("button", { name: "Done editing" }).click();
  await page.getByTestId("automation-condition-0").getByRole("button").first().click();
  await page.getByLabel("Condition value").click(); await page.getByRole("option", { name: "Qualified" }).click();
  await page.getByRole("button", { name: "Done editing" }).click();
  await page.getByRole("button", { name: "Move action 2 up" }).click();
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard automation changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  const update = page.waitForRequest((request) => request.method() === "PUT" && request.url().endsWith("/admin/automation-rules/41"));
  await page.getByRole("button", { name: "Save rule" }).click();
  const payload = (await update).postDataJSON() as { name: string; conditions_json: Array<{ value: string }>; actions_json: Array<{ type: string }> };
  expect(payload.name).toBe("Valid urgent lead workflow"); expect(payload.conditions_json[0].value).toBe("qualified"); expect(payload.actions_json.map((action) => action.type)).toEqual(["add_record_note", "create_task"]);
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("duplicates rules and preview-gates invalid enablement", async ({ page }) => {
  await page.goto("/dashboard/settings/automation");
  await page.getByLabel("More actions for Dormant lead reminder").click();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByText("This rule cannot be enabled until preview validation passes.")).toBeVisible();
  await page.getByLabel("More actions for Dormant lead reminder").click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await page.getByText("Dormant lead reminder copy", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rule settings" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dormant lead reminder copy");
});

test("keeps run history separate and opens sanitized details in a sheet", async ({ page }) => {
  await page.goto("/dashboard/settings/automation");
  await page.getByRole("button", { name: "Runs" }).click();
  await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByRole("dialog", { name: "Run #91" })).toBeVisible();
  await page.getByText("Sanitized input").click();
  await expect(page.getByText("[REDACTED]", { exact: false })).toBeVisible();
});

test("preserves module scope and supports the mobile keyboard create flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/automation?module_key=sales_leads");
  await expect(page.getByText("Sales Leads automation")).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Untitled automation/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Rule settings" })).toBeVisible();
});
