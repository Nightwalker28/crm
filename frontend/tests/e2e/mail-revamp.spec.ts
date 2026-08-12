import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const healthyContext = {
  connections: [{
    provider: "google",
    status: "connected",
    account_email: "admin@example.com",
    provider_mailbox_id: "primary",
    provider_mailbox_name: "Primary inbox",
    can_send: true,
    can_sync: true,
    last_synced_at: null,
    last_error: null,
    health_status: "healthy",
    credential_state: "active",
    scopes: ["gmail.send"],
    last_successful_sync_at: null,
    last_failure_reason: null,
    reconnect_required: false,
    reconnect_label: "Manage",
    sync_unavailable_reason: null,
  }],
  sync_available: true,
  sync_note: "Mailbox sync is ready.",
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Mail composer is responsive, validates recipients, and sends through the selected mailbox", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/mail/context", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(healthyContext) }),
  );
  await page.route("**/mail/send", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({
      provider: "google",
      to: ["client@example.com"],
      subject: "Renewal review",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 9001,
        direction: "outbound",
        folder: "sent",
        to_recipients: [{ email: "client@example.com" }],
        subject: "Renewal review",
        body_text: "Hello {{contact.first_name}}",
        created_at: "2099-07-24T08:00:00Z",
        updated_at: "2099-07-24T08:00:00Z",
      }),
    });
  });
  await page.route("**/mail/messages?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.route("**/mail/messages/9001", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 9001,
        direction: "outbound",
        folder: "sent",
        to_recipients: [{ email: "client@example.com" }],
        subject: "Renewal review",
        body_text: "Hello Ada",
        created_at: "2099-07-24T08:00:00Z",
        updated_at: "2099-07-24T08:00:00Z",
      }),
    }),
  );

  await page.goto("/dashboard/mail/compose");
  await expect(page.getByRole("heading", { name: "Compose email" })).toBeVisible();

  await page.getByRole("textbox", { name: "To" }).fill("not-an-email");
  await page.getByRole("button", { name: "Send email" }).click();
  await expect(page.getByText("Enter a valid email address for not-an-email.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "To" })).toBeFocused();

  await page.getByRole("textbox", { name: "To" }).fill("client@example.com");
  await page.getByLabel("Subject").fill("Renewal review");
  await page.getByLabel("Message").fill("Hello");
  await page.getByRole("button", { name: "{{contact.first_name}}" }).click();
  await page.getByRole("button", { name: "Send email" }).click();

  await expect(page).toHaveURL(/\/dashboard\/mail\?messageId=9001$/);
});

test("Mail hides technical provider and request failures", async ({ page }) => {
  const unsafeContext = {
    ...healthyContext,
    connections: [{
      ...healthyContext.connections[0],
      status: "error",
      health_status: "reconnect_required",
      last_failure_reason: "oauth_token=private-secret",
      reconnect_required: true,
      reconnect_label: "Reconnect Google",
    }],
  };
  await page.route("**/mail/context", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unsafeContext) }),
  );
  await page.route("**/mail/messages?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "provider_stack_trace=private-secret" }),
    }),
  );

  await page.goto("/dashboard/mail");

  await expect(page.getByText("The provider needs attention. Reconnect it, then try syncing again.")).toBeVisible();
  await expect(page.getByText("We could not load mail messages.")).toBeVisible();
  await expect(page.getByText("oauth_token=private-secret")).toBeHidden();
  await expect(page.getByText("provider_stack_trace=private-secret")).toBeHidden();
});

test("IMAP settings use labeled controls and confirm mailbox disconnection", async ({ page }) => {
  const imapContext = {
    ...healthyContext,
    connections: [{
      ...healthyContext.connections[0],
      provider: "imap_smtp",
      account_email: "ops@example.com",
      provider_mailbox_name: "Operations inbox",
      scopes: [],
      reconnect_label: "Reconfigure",
    }],
  };
  let disconnectRequests = 0;
  await page.route("**/mail/context", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(imapContext) }),
  );
  await page.route("**/mail/messages?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.route("**/mail/connect/imap_smtp", async (route) => {
    if (route.request().method() === "DELETE") {
      disconnectRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "imap_smtp", status: "disconnected" }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/dashboard/mail");
  await page.getByRole("button", { name: "Reconfigure IMAP" }).click();

  await expect(page.getByLabel("Mailbox email")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "IMAP security" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "SMTP security" })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect IMAP" }).click();
  const disconnectConfirmation = page.getByRole("dialog", { name: "Disconnect IMAP/SMTP?" });
  await expect(disconnectConfirmation.getByRole("heading", { name: "Disconnect IMAP/SMTP?" })).toBeVisible();
  // The page behind the dialog has its own Cancel; scope to the confirmation.
  await disconnectConfirmation.getByRole("button", { name: "Cancel" }).click();
  expect(disconnectRequests).toBe(0);

  await page.getByRole("button", { name: "Disconnect IMAP" }).click();
  await page.getByRole("button", { name: "Disconnect mailbox" }).click();
  await expect.poll(() => disconnectRequests).toBe(1);
});
