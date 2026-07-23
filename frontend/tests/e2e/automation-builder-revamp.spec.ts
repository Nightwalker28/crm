import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

type AutomationRule = {
  id: number;
  name: string;
  description: string;
  module_key: string;
  enabled: boolean;
  trigger_event: string;
  condition_mode: "all" | "any";
  conditions_json: Record<string, unknown>[];
  actions_json: Record<string, unknown>[];
  updated_at: string;
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  let rule: AutomationRule = {
    id: 41,
    name: "High priority lead follow-up",
    description: "Create and document urgent follow-up work.",
    module_key: "sales_leads",
    enabled: true,
    trigger_event: "lead.created",
    condition_mode: "all",
    conditions_json: [{ field: "status", operator: "equals", value: "new", values: [] }],
    actions_json: [
      { type: "create_task", title: "Call {{payload.first_name}}", priority: "high", due_in_days: 1, assignee_user_id: "actor" },
      { type: "add_record_note", body: "Urgent lead follow-up created." },
    ],
    updated_at: "2099-07-23T10:00:00Z",
  };

  await page.route("**/admin/automation-rules/trigger-registry", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          module_key: "sales_leads",
          triggers: [
            { key: "lead.created", module_key: "sales_leads", label: "Lead created", description: "A sales lead is created." },
            { key: "lead.updated", module_key: "sales_leads", label: "Lead updated", description: "A sales lead is updated." },
          ],
        }],
      }),
    }),
  );
  await page.route("**/admin/automation-rules/condition-fields?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          key: "status",
          payload_key: "status",
          module_key: "sales_leads",
          label: "Status",
          field_type: "select",
          operators: ["equals", "not_equals"],
          options: [{ value: "new", label: "New" }, { value: "qualified", label: "Qualified" }],
        }],
      }),
    }),
  );
  await page.route("**/admin/automation-rules/action-registry?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            key: "create_task",
            category: "record",
            label: "Create task",
            description: "Create a follow-up task linked to the triggering record.",
            module_keys: ["sales_leads"],
            fields: [
              { key: "title", label: "Title", field_type: "text", required: true, placeholder: "Follow up", options: [] },
              { key: "priority", label: "Priority", field_type: "select", required: false, placeholder: null, options: [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }] },
              { key: "due_in_days", label: "Due in days", field_type: "number", required: false, placeholder: "1", options: [] },
              { key: "assignee_user_id", label: "Assignee", field_type: "actor_or_user_id", required: false, placeholder: "actor", options: [] },
            ],
          },
          {
            key: "add_record_note",
            category: "record",
            label: "Create note",
            description: "Add a note to the triggering record.",
            module_keys: ["sales_leads"],
            fields: [{ key: "body", label: "Note", field_type: "textarea", required: true, placeholder: "Note", options: [] }],
          },
        ],
      }),
    }),
  );
  await page.route("**/admin/automation-rules/runs?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 91,
          rule_id: 41,
          rule_name: "High priority lead follow-up",
          event_id: 501,
          trigger_event_key: "lead.created",
          source_module_key: "sales_leads",
          source_record_id: "88",
          source_label: "Ada Lovelace",
          status: "succeeded",
          input_json: { email: "ada@example.test", token: "[REDACTED]" },
          result_json: { task_id: 701 },
          step_results_json: [{ type: "create_task", status: "success" }],
          action_attempt_count: 1,
          action_success_count: 1,
          action_failed_count: 0,
          error_message: null,
          started_at: "2099-07-23T10:00:00Z",
          finished_at: "2099-07-23T10:00:01Z",
          completed_at: "2099-07-23T10:00:01Z",
        }],
      }),
    }),
  );
  await page.route(/\/admin\/automation-rules\/41$/, async (route) => {
    const payload = route.request().postDataJSON() as Partial<AutomationRule>;
    rule = { ...rule, ...payload };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rule) });
  });
  await page.route(/\/admin\/automation-rules$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [rule] }),
    }),
  );
});

test("edits flow steps, reorders actions, and saves from mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/automation");

  await expect(page.getByRole("heading", { name: "Automation Builder" })).toBeVisible();
  await page.getByRole("button", { name: /High priority lead follow-up/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Urgent lead workflow");

  await page.getByTestId("automation-condition-0").getByRole("button").first().click();
  await page.getByLabel("Condition value").click();
  await page.getByRole("option", { name: "Qualified" }).click();

  await page.getByTestId("automation-action-0").getByRole("button").first().click();
  await page.getByLabel("Title", { exact: true }).fill("Call qualified lead");
  await page.getByRole("button", { name: "Move action 2 up" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const updateRequest = page.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith("/admin/automation-rules/41"),
  );
  await page.getByRole("button", { name: "Save rule" }).click();
  const payload = (await updateRequest).postDataJSON() as {
    name: string;
    conditions_json: Array<{ value: string }>;
    actions_json: Array<{ type: string; title?: string }>;
  };

  expect(payload.name).toBe("Urgent lead workflow");
  expect(payload.conditions_json[0].value).toBe("qualified");
  expect(payload.actions_json.map((action) => action.type)).toEqual(["add_record_note", "create_task"]);
  expect(payload.actions_json[1].title).toBe("Call qualified lead");
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("keeps run history separate and reveals only sanitized debug data", async ({ page }) => {
  await page.goto("/dashboard/settings/automation");
  await page.getByRole("button", { name: /High priority lead follow-up/ }).click();
  await page.getByRole("button", { name: "Runs" }).click();

  await expect(page.getByRole("heading", { name: "Run history" })).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByRole("heading", { name: "Run #91" })).toBeVisible();
  await page.getByText("Sanitized input").click();
  await expect(page.getByText("[REDACTED]", { exact: false })).toBeVisible();
});
