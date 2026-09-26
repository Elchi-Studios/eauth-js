import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright-core";
import { CLIENT_ID, ISSUER } from "../packages/eauth/test/browser.ts";
import { eauth, launch, open } from "../packages/eauth/test/chromium.ts";

// The example in examples/vanilla.html, served as a developer would serve
// it, with the CDN answered by the core built here.

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = 3998;
const PAGE = `http://localhost:${PORT}/vanilla.html`;
const CDN = "https://cdn.jsdelivr.net/npm/@elchi-studios/eauth@1/dist/index.js";

let http: HttpServer | undefined;
let browser: Browser | undefined;

before(async () => {
  const html = readFileSync(join(root, "examples", "vanilla.html"), "utf8");
  assert.ok(html.includes(CDN), "the example loads the core from the CDN address this test answers");
  assert.ok(html.includes("eauth_pub_REPLACE_ME"));
  http = createServer((req, res) => {
    if (new URL(req.url ?? "/", PAGE).pathname !== "/vanilla.html") {
      res.writeHead(404).end();
      return;
    }
    // The client ID a developer would paste, and the stand-in as the issuer.
    const served = html
      .replace("eauth_pub_REPLACE_ME", CLIENT_ID)
      .replace("  redirectUri:", `  issuer: "${ISSUER}",\n  redirectUri:`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(served);
  });
  await new Promise<void>((resolve) => http!.listen(PORT, "127.0.0.1", resolve));
  browser = await launch();
});

after(async () => {
  await browser?.close();
  http?.close();
});

test("the plain example signs in, keeps names as text, restores and signs out", async () => {
  const context = await browser!.newContext();
  const stand = await eauth(context);
  const core = readFileSync(join(root, "packages", "eauth", "dist", "index.js"), "utf8");
  await context.route(CDN, (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" }, body: core }),
  );
  // A name with markup in it, as anybody can choose.
  stand.claims = { name: '<img src=x onerror="document.title=1">Anna' };
  const { page, problems } = await open(context);

  await page.goto(PAGE);
  await page.getByText("Nobody is signed in.").waitFor();

  await page.getByRole("button", { name: "Sign in with EAuth" }).click();
  await page.getByText("Signed in as").waitFor();
  assert.equal(await page.textContent("strong"), '<img src=x onerror="document.title=1">Anna');
  assert.equal(await page.locator("main img").count(), 0, "the name is shown as text, not markup");
  assert.equal(page.url(), PAGE, "the answer is gone from the address");
  assert.equal(stand.authorizations[0]!.searchParams.get("redirect_uri"), PAGE);

  // A reload forgets the tokens and continues the session silently.
  await page.reload();
  await page.getByText("Signed in as").waitFor();
  assert.equal(stand.authorizations.length, 2);
  assert.equal(stand.authorizations[1]!.searchParams.get("prompt"), "none");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByText("Nobody is signed in.").waitFor();
  assert.equal(stand.server.count("/revoke"), 1);
  assert.notEqual(await page.title(), "1");
  assert.deepEqual(problems, []);
  assert.deepEqual(stand.unexpected, []);
  await context.close();
});
