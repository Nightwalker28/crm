import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const templateId = 7654321;

function templateFixture() {
  return {
    id: templateId,
    template_key: "quote_follow_up",
    name: "Quote follow-up",
    description: "Check in after sharing a quote.",
    channel: "mail",
    module_key: "sales_quotes",
    body: "Hi {{contact.first_name}}, quote {{quote.number}} is ready.",
    variables: ["contact.first_name", "quote.number"],
    is_system: false,
    is_active: true,
    created_at: "2099-07-20T08:00:00Z",
    updated_at: "2099-07-24T08:00:00Z",
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/message-templates?include_inactive=true", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [templateFixture()] }) }),
  );
});

test("Message template creation uses a responsive routed form and preserves dotted variables", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/message-templates", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...templateFixture(), ...submitted }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/message-templates/new");

  await page.getByLabel("Name").fill("Customer update");
  await page.getByRole("button", { name: "Back to templates" }).click();
  const discardDialog = page.getByRole("dialog", { name: "Discard template changes?" });
  // role="dialog" sits on the Headless UI root, whose children are all position: fixed, so it
  // has no box of its own. Assert on the titled panel inside it, which does.
  await expect(discardDialog.getByRole("heading", { name: "Discard template changes?" })).toBeVisible();
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings\/message-templates\/new$/);

  await page.getByLabel("Channel").click();
  await page.getByRole("option", { name: "Mail" }).click();
  await page.getByLabel("Module").click();
  await page.getByRole("option", { name: "Contacts" }).click();
  await page.getByLabel("Body").fill("Hi {{contact.first_name}}, your update is ready.");
  await page.getByRole("button", { name: "Create template" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/settings/message-templates\\?savedTemplateId=${templateId}$`));
  expect(submitted).toMatchObject({
    name: "Customer update",
    channel: "mail",
    module_key: "sales_contacts",
    variables: ["contact.first_name"],
  });
});

test("Message template editing hydrates the routed form and confirms deletion from the list", async ({ page }) => {
  await page.goto(`/dashboard/settings/message-templates/${templateId}/edit`);
  // Routed settings pages carry no heading of their own; the shell header names the section.
  await expect(page.locator("main > div > header").getByRole("heading", { name: "Templates" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Template details" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Quote follow-up");
  await expect(page.getByLabel("Body")).toHaveValue(/{{contact\.first_name}}/);

  await page.goto("/dashboard/settings/message-templates");
  await page.getByRole("button", { name: "Delete Quote follow-up" }).click();
  await expect(page.getByRole("heading", { name: "Delete message template?" })).toBeVisible();
  await expect(page.getByText(/Existing messages are unchanged/)).toBeVisible();
});

test("Message template failures are redacted and restricted actions stay hidden", async ({ page }) => {
  await page.route("**/api/v1/message-templates", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "SECRET database constraint output" }) }),
  );
  await page.goto("/dashboard/settings/message-templates/new");
  await page.getByLabel("Name").fill("Failure test");
  await page.getByLabel("Body").fill("Hello");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText("We could not save this template. Review the fields and try again.")).toBeVisible();
  await expect(page.getByText(/SECRET database constraint output/)).toHaveCount(0);

  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 13,
        name: "message_templates",
        base_route: "/dashboard/settings/message-templates",
        description: "Templates",
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: false,
          can_edit: false,
          can_delete: false,
          can_restore: false,
          can_export: false,
          can_configure: false,
        },
      }]),
    }),
  );
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto("/dashboard/settings/message-templates");

  await expect(page.getByRole("link", { name: "Create template" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit Quote follow-up" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disable Quote follow-up" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Quote follow-up" })).toHaveCount(0);
  await page.keyboard.press("Control+K");
  await expect(page.getByText("Create message template", { exact: true })).toBeHidden();
  await page.goto("/dashboard/settings/message-templates/new");
  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toBeVisible();
});
