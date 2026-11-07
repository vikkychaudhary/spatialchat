import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "CorrectHorse-Battery9";
const uid = () => Math.random().toString(36).slice(2, 10);

async function signUp(page: Page, username: string) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chats/);
}
const newUser = async (browser: Browser, name: string) => {
  const ctx = await browser.newContext(); // separate cookies = separate user
  const page = await ctx.newPage();
  const username = `${name}_${uid()}`;
  await signUp(page, username);
  return { page, username, ctx };
};

test("two users connect and exchange a real-time message", async ({ browser }) => {
  const alice = await newUser(browser, "alice");
  const bob = await newUser(browser, "bob");

  await alice.page.getByRole("link", { name: /contacts/i }).first().click();
  await alice.page.getByRole("tab", { name: /find people/i }).click();
  await alice.page.getByLabel(/search by username/i).fill(bob.username.slice(0, 8));
  await alice.page.getByRole("button", { name: new RegExp(`add ${bob.username}`, "i") }).click();

  await bob.page.getByRole("link", { name: /contacts/i }).first().click();
  await bob.page.getByRole("tab", { name: /requests/i }).click();
  await bob.page.getByRole("button", { name: new RegExp(`accept ${alice.username}`, "i") }).click();

  await bob.page.getByRole("link", { name: /chats/i }).first().click();
  await bob.page.getByRole("link", { name: new RegExp(alice.username, "i") }).first().click();
  await alice.page.getByRole("link", { name: /chats/i }).first().click();
  await alice.page.getByRole("link", { name: new RegExp(bob.username, "i") }).first().click();

  await alice.page.getByLabel("Message").fill("Hello Bob, this is live");
  await alice.page.getByRole("button", { name: /send/i }).click();
  await expect(bob.page.getByText("Hello Bob, this is live")).toBeVisible();

  await bob.page.getByLabel("Message").fill("Got it, Alice");
  await bob.page.keyboard.press("Enter");
  await expect(alice.page.getByText("Got it, Alice")).toBeVisible();
  await alice.ctx.close(); await bob.ctx.close();
});

test("auth pages never overflow horizontally", async ({ page }) => {
  for (const path of ["/login", "/register", "/forgot-password"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${path} overflows`).toBe(false);
  }
});

test("protected routes redirect anonymous visitors to login", async ({ page }) => {
  await page.goto("/chats");
  await expect(page).toHaveURL(/\/login/);
});
