import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright-core";
import { CLIENT_ID } from "../../eauth/test/browser.ts";
import { eauth, launch, open } from "../../eauth/test/chromium.ts";

// Builds a real Nuxt application with the module, serves it, and drives it
// in Chromium against a stand-in for EAuth. Slow, and the only test that
// shows the runtime resolves #imports, registers the composable and the
// middleware, renders on the server without a browser API, and hydrates
// without a mismatch.

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixture");
const APP = "http://localhost:3999";
/** The same build under app.baseURL /app/, set at runtime, with the default redirect URI. */
const BASED = "http://localhost:3997";

const servers: ChildProcess[] = [];

/** Waits until the condition holds, or fails after a few seconds. */
async function until(condition: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("gave up waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
let browser: Browser | undefined;

async function serve(port: number, env: Record<string, string>): Promise<void> {
  const server = spawn("node", [join(fixture, ".output", "server", "index.mjs")], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NUXT_HOST: "127.0.0.1", NUXT_PUBLIC_EAUTH_CLIENT_ID: CLIENT_ID, ...env },
    stdio: "pipe",
  });
  servers.push(server);
  for (let i = 0; ; i++) {
    try {
      await fetch(`http://localhost:${port}/`);
      return;
    } catch (err) {
      if (i > 100) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

before(async () => {
  execFileSync("npx", ["nuxi", "build", fixture], {
    stdio: "pipe",
    env: { ...process.env, NUXT_TELEMETRY_DISABLED: "1" },
  });
  await serve(3999, { NUXT_PUBLIC_EAUTH_REDIRECT_URI: `${APP}/` });
  await serve(3997, { NUXT_APP_BASE_URL: "/app/" });
  browser = await launch();
});

after(async () => {
  await browser?.close();
  for (const server of servers) server.kill();
});

test("the client bundle carries the core and the options come from runtime config", async () => {
  const assets = join(fixture, ".output", "public", "_nuxt");
  const client = readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assets, f), "utf8"))
    .join("\n");
  assert.match(client, /eauth:signed-in/);

  const html = await (await fetch(`${APP}/`)).text();
  assert.match(html, /<p id="state">loading<\/p>/, "the server renders the loading state");
  assert.match(html, /<span id="who">loading<\/span>/);
  // Nuxt serialises the public runtime config into the page; the
  // environment overrides what nuxt.config.ts set at build time.
  assert.ok(html.includes(CLIENT_ID), "runtime config comes from the environment");
  assert.doesNotMatch(html, /eauth_pub_fixturefixturefixture1/);

  const page = await (await fetch(`${APP}/private`)).text();
  assert.match(page, /<p id="private">private<\/p>/, "on the server the middleware leaves the decision to the browser");
});

test("nobody signed in: the page hydrates and then says so", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { server, authorizations } = stand;
  const { page, problems } = await open(context);

  await page.goto(`${APP}/`);
  await page.locator("#who", { hasText: "nobody" }).waitFor();
  assert.equal(await page.textContent("#state"), "nobody");
  assert.equal(authorizations.length, 0, "a first visit sends nobody to EAuth");
  assert.equal(server.count("/token"), 0);
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("the middleware signs in, returns to the page, and a reload restores silently", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { server, authorizations } = stand;
  const { page, problems } = await open(context);

  await page.goto(`${APP}/`);
  await page.locator("#who", { hasText: "nobody" }).waitFor();

  // A client-side navigation to a page that needs somebody signed in.
  await page.click("#to-private");
  await page.waitForURL(`${APP}/private`);
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  assert.equal(await page.textContent("#private"), "private");
  assert.equal(authorizations.length, 1);
  const first = authorizations[0]!;
  assert.equal(first.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(first.searchParams.get("redirect_uri"), `${APP}/`);
  assert.equal(first.searchParams.get("code_challenge_method"), "S256");
  assert.equal(first.searchParams.get("prompt"), null);
  assert.equal(new URL(page.url()).search, "", "the answer is gone from the address");
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.doesNotMatch(stored, /access-|refresh-|code-/, "no token or code is left in storage");

  // A reload forgets the tokens and asks EAuth again without showing anything.
  await page.reload();
  await page.waitForURL(`${APP}/private`);
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  assert.equal(authorizations.length, 2);
  assert.equal(authorizations[1]!.searchParams.get("prompt"), "none");
  assert.equal(server.count("/token"), 2);

  // Signing out revokes the refresh token and shows the change at once.
  await page.click("#sign-out");
  await page.locator("#who", { hasText: "nobody" }).waitFor();
  assert.equal(server.count("/revoke"), 1);

  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("a silent restore that finds nobody at EAuth ends signed out, not in a loop", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { authorizations } = stand;
  const { page, problems } = await open(context);

  await page.goto(`${APP}/private`);
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  assert.equal(authorizations.length, 1);

  // The session ended at EAuth, for instance from another device.
  stand.forget();
  await page.goto(`${APP}/`);
  await page.locator("#who", { hasText: "nobody" }).waitFor();
  assert.equal(authorizations.length, 2);
  assert.equal(authorizations[1]!.searchParams.get("prompt"), "none");
  assert.equal(await page.textContent("#error"), "", "finding nobody is not an error");

  // And the next load does not try again.
  await page.reload();
  await page.locator("#who", { hasText: "nobody" }).waitFor();
  assert.equal(authorizations.length, 2);
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("a sign-in without returnTo leaves the address without the answer", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { page, problems } = await open(context);

  await page.goto(`${APP}/`);
  await page.locator("#who", { hasText: "nobody" }).waitFor();
  await page.click("#sign-in");
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  // The router held the address from before the answer was removed and
  // would write it back; give it the time to.
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${APP}/`);

  // So a reload continues the session instead of meeting a spent answer.
  await page.reload();
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  assert.equal(await page.textContent("#error"), "");
  assert.equal(stand.authorizations.length, 2);
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("a guarded page whose sign-in fails shows why, and does not redirect again", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  // Every ID token has long expired, as on a device whose clock is wrong.
  stand.claims = { exp: 1 };
  const { page } = await open(context);

  await page.goto(`${APP}/private`);
  await page.locator("#failure").waitFor();
  assert.match((await page.textContent("#failure"))!, /^401 .*expired/);
  await page.waitForTimeout(1500);
  assert.equal(stand.authorizations.length, 1, "one attempt, not a loop");
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("Back after a silent restore leaves the page instead of restoring again", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { page, problems } = await open(context);

  await page.goto(`${APP}/`);
  await page.click("#sign-in");
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();

  // A new page load restores silently; that trip replaces its entry. The
  // server renders the page before the trip starts, so wait for the trip.
  await page.goto(`${APP}/private`);
  await until(() => stand.authorizations.length === 2);
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  await page.waitForURL(`${APP}/private`);
  assert.equal(stand.authorizations[1]!.searchParams.get("prompt"), "none");

  await page.goBack();
  await page.locator("#state", { hasText: "anna@example.test" }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${APP}/`, "Back reached the page before, and stayed there");
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("under app.baseURL the default redirect URI and the way back are right", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { page, problems } = await open(context);

  await page.goto(`${BASED}/app/private`);
  await page.waitForURL(`${BASED}/app/private`, { waitUntil: "commit" });
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  await page.waitForURL(`${BASED}/app/private`);
  assert.equal(await page.textContent("#private"), "private");
  assert.equal(stand.authorizations[0]!.searchParams.get("redirect_uri"), `${BASED}/app/`);

  // And a silent restore comes back to the same place.
  await page.reload();
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();
  await page.waitForURL(`${BASED}/app/private`);
  assert.equal(await page.textContent("#private"), "private");
  assert.equal(stand.authorizations.length, 2);
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("declining at EAuth on the way to a guarded page leads back to where the person was", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  stand.decline = true;
  const { page, problems } = await open(context);

  await page.goto(`${APP}/`);
  await page.locator("#who", { hasText: "nobody" }).waitFor();
  await page.click("#to-private");
  await page.locator("#error", { hasText: "access_denied" }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${APP}/`);
  assert.equal(await page.locator("#failure").count(), 0, "no error page");
  assert.equal(stand.authorizations.length, 1);
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});

test("a silent answer redirected away from the redirect URI stops instead of looping", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const { page } = await open(context);

  await page.goto(`${APP}/`);
  await page.click("#sign-in");
  await page.locator("#who", { hasText: "anna@example.test" }).waitFor();

  // From now on something in front of the application moves every answer.
  stand.misroute = "/private";
  await page.reload();
  // Back on the page the attempt left, signed out, with the reason.
  await page.locator("#error", { hasText: "redirect_mismatch" }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(page.url(), `${APP}/`);
  assert.equal(await page.textContent("#who"), "nobody");
  assert.equal(stand.authorizations.length, 2, "one silent attempt, not a loop");
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});
