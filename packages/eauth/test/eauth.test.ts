import { test } from "node:test";
import assert from "node:assert/strict";
import { EAuth, EAuthError, decodeClaims, type EAuthConfig, type EAuthUser } from "../src/index.ts";
import { APP, CLIENT_ID, ISSUER, browser, issueCode, jwt, type Browser } from "./browser.ts";

const config = { clientId: CLIENT_ID, redirectUri: `${APP}/callback`, issuer: ISSUER };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function signedIn(options: Partial<EAuthConfig> = {}, b: Browser = browser()) {
  const auth = new EAuth({ ...config, ...options });
  await auth.signIn();
  b.answer({ code: issueCode(b) });
  const result = await auth.handleRedirect();
  return { b, auth, user: result?.user ?? null };
}

async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (err: unknown) => err instanceof EAuthError && err.code === code);
}

/** The refresh token stored with storage "local". */
function stored(b: Browser): string | undefined {
  const raw = b.local.getItem("eauth:refresh");
  return raw ? (JSON.parse(raw) as { token: string }).token : undefined;
}

/** Makes the current access token due for renewal. */
function due(auth: EAuth): void {
  (auth as unknown as { renewAt: number }).renewAt = 0;
}

function grants(b: Browser, type: string) {
  return b.server.requests.filter((r) => r.body.get("grant_type") === type);
}

// --- configuration and sign-in ---------------------------------------------

test("configuration is checked", () => {
  const invalid = (c: Partial<EAuthConfig>) =>
    assert.throws(() => new EAuth(c as EAuthConfig), (e: unknown) => e instanceof EAuthError && e.code === "invalid_config");
  invalid({ clientId: "", redirectUri: `${APP}/` });
  invalid({ clientId: "x", redirectUri: "" });
  invalid({ clientId: "x", redirectUri: "/callback" });
  invalid({ clientId: "x", redirectUri: "javascript:alert(1)" });
  invalid({ clientId: "x", redirectUri: `${APP}/`, storage: "cookie" as "local" });
});

test("signIn sends PKCE with S256, state, nonce and the options", async () => {
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn({ prompt: "login", loginHint: "anna@example.test", maxAge: 300 });
  const url = b.navigations.at(-1)!;
  assert.equal(url.origin + url.pathname, `${ISSUER}/authorize`);
  const q = url.searchParams;
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("client_id"), CLIENT_ID);
  assert.equal(q.get("redirect_uri"), `${APP}/callback`);
  assert.equal(q.get("scope"), "openid profile email offline_access");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("prompt"), "login");
  assert.equal(q.get("login_hint"), "anna@example.test");
  assert.equal(q.get("max_age"), "300");
  assert.ok((q.get("state") ?? "").length >= 20);
  assert.ok((q.get("nonce") ?? "").length >= 20);

  const pending = JSON.parse(b.session.getItem("eauth:pending")!);
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.verifier))).toString("base64url");
  assert.equal(q.get("code_challenge"), digest, "the challenge is the verifier's SHA-256");
  assert.equal(pending.state, q.get("state"));
  assert.equal(b.replacements.length, 0, "a sign-in the person started keeps the page in the history");
});

test("a silent sign-in, and one with replace, take the page's place in the history", async () => {
  const b = browser();
  await new EAuth(config).signIn({ prompt: "none" });
  await new EAuth(config).signIn({ replace: true });
  assert.equal(b.replacements.length, 2);
});

test("a sign-in completes, and the address is cleaned up", async () => {
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn({ returnTo: "/orders?id=7" });
  b.answer({ code: issueCode(b) });
  const result = await auth.handleRedirect();
  assert.equal(result?.user?.sub, "user-1");
  assert.equal(result?.user?.email, "anna@example.test");
  assert.equal(result?.returnTo, "/orders?id=7");
  assert.equal(auth.isAuthenticated(), true);
  assert.equal(location.search, "", "code, state and iss are gone from the address");
  assert.equal(b.session.getItem("eauth:pending"), null);
  assert.equal(await auth.getAccessToken(), "access-1");
  // Memory storage keeps tokens out of storage entirely.
  assert.deepEqual(b.local.keys(), ["eauth:signed-in"]);
});

test("without returnTo, the answer's page comes back without the answer", async () => {
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn();
  b.answer({ code: issueCode(b) });
  assert.equal((await auth.handleRedirect())?.returnTo, "/callback");
});

test("returnTo only keeps a path on this origin", async () => {
  const hostile = [
    "https://evil.test/steal",
    "//evil.test",
    "/\\evil.test",
    "/.//evil.test",
    "/%2e//evil.test",
    `${APP}//evil.test`,
    `${APP}/\\evil.test`,
    "/./\\evil.test",
    "javascript:alert(1)",
    " //evil.test",
  ];
  for (const returnTo of hostile) {
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn({ returnTo });
    b.answer({ code: issueCode(b) });
    const result = await auth.handleRedirect();
    assert.equal(result?.returnTo, "/callback", `${returnTo} is dropped`);
  }
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn({ returnTo: `${APP}/orders/7?tab=items#top` });
  b.answer({ code: issueCode(b) });
  assert.equal((await auth.handleRedirect())?.returnTo, "/orders/7?tab=items#top");
});

test("handleRedirect is harmless without an answer, and elsewhere than the redirect URI", async () => {
  const b = browser();
  assert.equal(await new EAuth(config).handleRedirect(), null);
  // An application's own "code" parameter on another page is left alone.
  b.open(`${APP}/invite?code=WELCOME10&state=x`);
  const auth = new EAuth(config);
  assert.equal(await auth.handleRedirect(), null);
  assert.equal(location.search, "?code=WELCOME10&state=x");
  // And a "code" without state on the redirect URI is not an answer either.
  b.open(`${APP}/callback?code=WELCOME10`);
  assert.equal(await auth.handleRedirect(), null);
  assert.equal(location.search, "?code=WELCOME10");
});

test("an answer that was not started in this tab is removed and ignored", async () => {
  {
    // A reload of an answer already spent, or a link opened in another tab.
    // (With silentRestore, the default for memory storage, a silent sign-in
    // follows; see the next test.)
    const b = browser();
    b.open(`${APP}/callback?code=abc&state=xyz&iss=${encodeURIComponent(ISSUER)}`);
    const auth = new EAuth({ ...config, silentRestore: false });
    const result = await auth.ready();
    assert.deepEqual(result, { user: null, returnTo: "/callback" });
    assert.equal(location.search, "");
    assert.equal(grants(b, "authorization_code").length, 0);
  }
  {
    // A forged state: nothing is exchanged, and the sign-in in progress stays.
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn();
    const pending = b.session.getItem("eauth:pending");
    b.answer({ code: issueCode(b), state: "forged" });
    assert.equal(await auth.handleRedirect(), null);
    assert.equal(grants(b, "authorization_code").length, 0);
    assert.equal(b.session.getItem("eauth:pending"), pending);
  }
  {
    // An error with a forged state does not get to put its text on the page.
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn();
    b.answer({ error: "access_denied", state: "forged" });
    b.open(`${location.href}&error_description=${encodeURIComponent("Account locked. Call +1 555 0100.")}`);
    assert.equal(await auth.handleRedirect(), null);
  }
});

test("an answer for another tab's sign-in is followed by one silent sign-in", async () => {
  // Somebody registers in one tab and confirms their address from the mail
  // in a new one. EAuth signs them in there and sends the code to this
  // page, which did not start the sign-in. EAuth holds a session now, so a
  // silent sign-in completes it here.
  const b = browser();
  b.open(`${APP}/callback?code=abc&state=xyz&iss=${encodeURIComponent(ISSUER)}`);
  const auth = new EAuth(config);
  let settled = false;
  void auth.ready().then(() => (settled = true));
  await tick(20);
  assert.equal(settled, false, "ready waits for the navigation");
  const url = b.navigations.at(-1)!;
  assert.equal(url.searchParams.get("prompt"), "none");
  assert.equal(grants(b, "authorization_code").length, 0);

  b.answer({ code: issueCode(b) });
  const back = new EAuth(config);
  const result = await back.ready();
  assert.equal(result.user?.sub !== undefined, true);

  // Only for a code from this issuer: an error, or another server's answer,
  // starts nothing.
  for (const answer of [`error=access_denied&state=xyz&iss=${encodeURIComponent(ISSUER)}`,
    `code=abc&state=xyz&iss=${encodeURIComponent("https://elsewhere.example")}`]) {
    const c = browser();
    c.open(`${APP}/callback?${answer}`);
    const before = c.navigations.length;
    assert.deepEqual(await new EAuth(config).ready(), { user: null, returnTo: "/callback" });
    assert.equal(c.navigations.length, before);
  }
});

test("after signOut, an answer for another tab's sign-in starts nothing until a sign-in starts", async () => {
  // EAuth still holds the session after a sign-out here. An old code, from
  // a mail link clicked again or the history, must not sign the person
  // back in through a silent sign-in.
  const { b, auth } = await signedIn();
  await auth.signOut();
  const stale = `${APP}/callback?code=abc&state=xyz&iss=${encodeURIComponent(ISSUER)}`;
  b.open(stale);
  const before = b.navigations.length;
  let result: unknown;
  void new EAuth(config).ready().then((r) => (result = r));
  await tick(20);
  assert.equal(b.navigations.length, before, "no silent sign-in");
  assert.deepEqual(result, { user: null, returnTo: "/callback" });

  // Once the person starts a sign-in again, in any tab, such a code is
  // followed again: the registration that ends in a new tab.
  await new EAuth(config).signIn();
  b.open(stale);
  void new EAuth(config).ready();
  await tick(20);
  assert.equal(b.navigations.at(-1)!.searchParams.get("prompt"), "none");
});

test("the issuer, nonce, audience, subject and expiry of the answer are checked", async () => {
  const refused = async (answer: (b: Browser) => void, code: string) => {
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn();
    answer(b);
    await rejects(auth.handleRedirect(), code);
    assert.equal(auth.isAuthenticated(), false);
  };
  await refused((b) => b.answer({ code: issueCode(b), iss: "https://other.test" }), "issuer_mismatch");
  await refused((b) => b.answer({ error: "access_denied", iss: "https://other.test" }), "issuer_mismatch");
  // EAuth always names itself (RFC 9207), so an answer without iss is not from it.
  await refused((b) => b.answer({ code: issueCode(b), iss: null }), "issuer_mismatch");
  await refused((b) => b.answer({ code: issueCode(b, { nonce: "someone else's" }) }), "nonce_mismatch");
  await refused((b) => b.answer({ code: issueCode(b, { aud: "eauth_pub_another" }) }), "audience_mismatch");
  await refused((b) => b.answer({ code: issueCode(b, { aud: [CLIENT_ID, "eauth_pub_another"] }) }), "audience_mismatch");
  await refused((b) => b.answer({ code: issueCode(b, { azp: "eauth_pub_another" }) }), "audience_mismatch");
  await refused((b) => b.answer({ code: issueCode(b, { iss: "https://other.test" }) }), "issuer_mismatch");
  await refused((b) => b.answer({ code: issueCode(b, { sub: undefined }) }), "invalid_token");
  await refused((b) => b.answer({ code: issueCode(b, { exp: undefined }) }), "invalid_token");
  await refused((b) => b.answer({ code: issueCode(b, { exp: Math.floor(Date.now() / 1000) - 3600 }) }), "token_expired");

  // Several audiences are fine when the token was issued to this client.
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn();
  b.answer({ code: issueCode(b, { aud: [CLIENT_ID, "api"], azp: CLIENT_ID }) });
  assert.equal((await auth.handleRedirect())?.user?.sub, "user-1");
});

test("maxAge and prompt login are held to auth_time", async () => {
  const now = Math.floor(Date.now() / 1000);
  {
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn({ maxAge: 60 });
    b.answer({ code: issueCode(b, { auth_time: now - 3600 }) });
    await rejects(auth.handleRedirect(), "stale_authentication");
  }
  {
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn({ prompt: "login" });
    b.answer({ code: issueCode(b, { auth_time: now - 3600 }) });
    await rejects(auth.handleRedirect(), "stale_authentication");
  }
  {
    const b = browser();
    const auth = new EAuth(config);
    await auth.signIn({ prompt: "login", maxAge: 60 });
    b.answer({ code: issueCode(b, { auth_time: now }) });
    assert.equal((await auth.handleRedirect())?.user?.sub, "user-1");
  }
});

test("a refusal from EAuth is thrown with its code, and where to go", async () => {
  {
    // Declined: back to where the person was, not to the page that needed it.
    const b = browser();
    b.open(`${APP}/shop`);
    const auth = new EAuth(config);
    await auth.signIn({ returnTo: "/orders" });
    b.answer({ error: "access_denied" });
    await assert.rejects(auth.handleRedirect(), (err: unknown) =>
      err instanceof EAuthError && err.code === "access_denied" && err.returnTo === "/shop");
    assert.equal(location.search, "");
  }
  {
    // Failed: on to the page, whose guard shows why.
    const b = browser();
    b.open(`${APP}/shop`);
    const auth = new EAuth(config);
    await auth.signIn({ returnTo: "/orders" });
    b.answer({ error: "server_error" });
    await assert.rejects(auth.handleRedirect(), (err: unknown) =>
      err instanceof EAuthError && err.code === "server_error" && err.returnTo === "/orders");
  }
});

test("discovery must name the issuer asked for and offer S256", async () => {
  {
    const b = browser();
    b.server.discovery.issuer = "https://impostor.test";
    await rejects(new EAuth(config).signIn(), "issuer_mismatch");
  }
  {
    const b = browser();
    b.server.discovery.code_challenge_methods_supported = ["plain"];
    await rejects(new EAuth(config).signIn(), "pkce_unsupported");
  }
});

test("a failed discovery is tried again", async () => {
  const b = browser();
  const auth = new EAuth(config);
  const good = b.server.discovery;
  b.server.discovery = { issuer: "https://impostor.test" };
  await rejects(auth.signIn(), "issuer_mismatch");
  b.server.discovery = good;
  await auth.signIn();
  assert.equal(b.server.count("/.well-known/openid-configuration"), 2);
});

test("after three failed sign-ins in a row, a fourth is refused", async () => {
  const b = browser();
  // A guard that starts a sign-in again whenever one fails.
  for (let i = 0; i < 3; i++) {
    const auth = new EAuth(config);
    await auth.signIn();
    b.answer({ code: issueCode(b, { exp: 1 }) });
    await rejects(auth.handleRedirect(), "token_expired");
  }
  await rejects(new EAuth(config).signIn(), "sign_in_loop");
  assert.equal(b.navigations.filter((n) => n.pathname === "/authorize").length, 3);

  // A sign-in that completes starts the count again.
  const c = browser();
  for (let i = 0; i < 5; i++) await signedIn({}, c);
});

test("a person who clicks again after going back from EAuth is never refused", async () => {
  const b = browser();
  // Sign in, Back from EAuth, sign in again: no answer ever came.
  for (let i = 0; i < 5; i++) await new EAuth(config).signIn();
  assert.equal(b.navigations.length, 5);
});

test("refusals count, since EAuth can refuse without showing a page", async () => {
  const b = browser();
  for (let i = 0; i < 3; i++) {
    const auth = new EAuth(config);
    await auth.signIn();
    b.answer({ error: "access_denied" });
    await rejects(auth.handleRedirect(), "access_denied");
  }
  await rejects(new EAuth(config).signIn(), "sign_in_loop");
});

test("an answer redirected away from the redirect URI stops instead of looping", async () => {
  {
    // A path or host redirect in front of the application keeps the query.
    const { b } = await signedIn();
    b.open(`${APP}/orders`);
    void new EAuth(config).restore();
    await tick();
    b.answer({ code: issueCode(b) });
    b.open(location.href.replace("/callback?", "/?"));
    await assert.rejects(new EAuth(config).ready(), (err: unknown) =>
      err instanceof EAuthError && err.code === "redirect_mismatch" && err.returnTo === "/orders");
    assert.equal(location.search, "", "the answer left the address");
    const before = b.navigations.length;
    assert.deepEqual(await new EAuth(config).ready(), { user: null });
    assert.equal(b.navigations.length, before, "no further silent attempt");
  }
  {
    // Or drops it: the silent attempt never comes back with an answer. One
    // more try, as after a reload, and then no more.
    const { b } = await signedIn();
    b.open(`${APP}/orders`);
    void new EAuth(config).restore();
    await tick();
    b.open(`${APP}/`);
    void new EAuth(config).ready();
    await tick();
    assert.equal(b.navigations.filter((n) => n.searchParams.get("prompt") === "none").length, 2);
    b.open(`${APP}/`);
    await rejects(new EAuth(config).ready(), "redirect_mismatch");
    const before = b.navigations.length;
    assert.deepEqual(await new EAuth(config).ready(), { user: null });
    assert.equal(b.navigations.length, before, "no further silent attempt");
  }
});

test("a reload during the silent trip tries once more", async () => {
  const { b } = await signedIn();
  b.open(`${APP}/orders`);
  void new EAuth(config).restore();
  await tick();
  // The person reloads before EAuth answered.
  b.open(`${APP}/orders`);
  void new EAuth(config).ready();
  await tick();
  b.answer({ code: issueCode(b) });
  const result = await new EAuth(config).ready();
  assert.equal(result.user?.sub, "user-1");
  assert.equal(result.returnTo, "/orders");
});

test("a browser that blocks session storage is told so instead of sent round in circles", async () => {
  const b = browser();
  b.session.refuse.add("eauth:pending");
  await rejects(new EAuth(config).signIn(), "storage_unavailable");
  assert.equal(b.navigations.length, 0);
});

test("an answer is found whether or not the server added a trailing slash", async () => {
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn();
  const code = issueCode(b);
  b.answer({ code });
  b.open(location.href.replace("/callback?", "/callback/?"));
  assert.equal((await auth.handleRedirect())?.user?.sub, "user-1");
});

// --- restoring after a reload ------------------------------------------------

test("memory storage restores with a silent sign-in, once", async () => {
  const { b } = await signedIn();
  b.open(`${APP}/orders`);
  const again = new EAuth(config);
  const restoring = again.restore();
  await tick(20);
  const url = b.navigations.at(-1)!;
  assert.equal(url.searchParams.get("prompt"), "none");
  let settled = false;
  restoring.then(() => (settled = true));
  await tick(20);
  assert.equal(settled, false, "restore waits for the navigation");

  // EAuth answers that nobody is signed in: signed out, back on the page
  // the attempt left, and no second attempt.
  b.answer({ error: "login_required" });
  const third = new EAuth(config);
  assert.deepEqual(await third.handleRedirect(), { user: null, returnTo: "/orders" });
  const before = b.navigations.length;
  assert.equal(await third.restore(), null);
  assert.equal(b.navigations.length, before, "no second silent attempt");
});

test("every way EAuth says it does not know the person ends the silent attempt quietly", async () => {
  for (const error of ["login_required", "consent_required", "interaction_required", "account_selection_required"]) {
    const { b } = await signedIn();
    b.open(`${APP}/orders`);
    void new EAuth(config).restore();
    await tick();
    b.answer({ error });
    assert.deepEqual(await new EAuth(config).ready(), { user: null, returnTo: "/orders" }, error);
    assert.equal(b.local.getItem("eauth:signed-in"), null);
  }
});

test("a silent attempt that fails in any other way is not repeated on the next load", async () => {
  {
    const { b } = await signedIn();
    void new EAuth(config).restore();
    await tick();
    b.answer({ error: "server_error" });
    await rejects(new EAuth(config).ready(), "server_error");
    const before = b.navigations.length;
    assert.equal(await new EAuth(config).restore(), null);
    assert.equal(b.navigations.length, before);
  }
  {
    // The exchange itself fails, for instance on a device whose clock is wrong.
    const { b } = await signedIn();
    void new EAuth(config).restore();
    await tick();
    b.answer({ code: issueCode(b, { exp: 1 }) });
    await rejects(new EAuth(config).ready(), "token_expired");
    const before = b.navigations.length;
    assert.equal(await new EAuth(config).restore(), null);
    assert.equal(b.navigations.length, before);
  }
});

test("a path kept to return to carries no spent answer, and the application's own query stays", async () => {
  {
    // A router wrote the redirect URI's address back, answer and all.
    const { b } = await signedIn();
    b.open(`${APP}/callback?id=7&state=old&code=spent&iss=${encodeURIComponent(ISSUER)}`);
    void new EAuth(config).restore();
    await tick();
    const pending = JSON.parse(b.session.getItem("eauth:pending")!);
    assert.equal(pending.returnTo, "/callback?id=7");
    assert.equal(pending.from, "/callback?id=7");
  }
  {
    // Another service's answer on the application's own page is not EAuth's.
    const { b } = await signedIn();
    b.open(`${APP}/integrations/github/callback?code=GH&state=gh`);
    void new EAuth(config).restore();
    await tick();
    const pending = JSON.parse(b.session.getItem("eauth:pending")!);
    assert.equal(pending.returnTo, "/integrations/github/callback?code=GH&state=gh");
  }
});

test("a silent sign-in that succeeds returns to where the page was", async () => {
  const { b } = await signedIn();
  b.open(`${APP}/orders?id=7#top`);
  void new EAuth(config).restore();
  await tick(20);
  b.answer({ code: issueCode(b) });
  // A new instance, as after the page loaded again: it reads the tab's pending sign-in.
  const result = await new EAuth(config).ready();
  assert.equal(result.user?.sub, "user-1");
  assert.equal(result.returnTo, "/orders?id=7#top");
});

test("local storage restores the session from the refresh token", async () => {
  const { b } = await signedIn({ storage: "local" });
  assert.equal(stored(b), "refresh-1");
  assert.equal(JSON.parse(b.local.getItem("eauth:refresh")!).sub, "user-1", "stored with whose it is");
  const again = new EAuth({ ...config, storage: "local" });
  const user = await again.restore();
  assert.equal(user?.sub, "user-1");
  assert.equal(stored(b), "refresh-2");
});

test("local storage: an early getAccessToken shares the restore's refresh", async () => {
  const { b } = await signedIn({ storage: "local" });
  const again = new EAuth({ ...config, storage: "local" });
  const ready = again.ready();
  // A component asking for a token while the page is still starting.
  const token = await again.getAccessToken();
  await ready;
  assert.equal(token, "access-2");
  assert.equal(grants(b, "refresh_token").length, 1);
  assert.equal(again.isAuthenticated(), true);
});

test("local storage: two tabs take turns and neither presents a rotated token", async () => {
  const { b, auth: tabA } = await signedIn({ storage: "local" });
  const tabB = new EAuth({ ...config, storage: "local" });
  await tabB.ready();
  assert.equal(stored(b), "refresh-2", "tab B rotated the token");

  due(tabA);
  due(tabB);
  const [a, c] = await Promise.all([tabA.getAccessToken(), tabB.getAccessToken()]);
  assert.ok(a && c, "both tabs got a token");
  assert.equal(tabA.isAuthenticated(), true);
  assert.equal(tabB.isAuthenticated(), true);
  const presented = grants(b, "refresh_token").map((r) => r.body.get("refresh_token"));
  assert.deepEqual(presented, ["refresh-1", "refresh-2", "refresh-3"], "each refresh used the newest token");
  assert.equal(b.server.refreshTokens.size, 1, "the session is intact at EAuth");
});

test("local storage: signing out in one tab ends the other at its next refresh", async () => {
  const { b, auth: tabA } = await signedIn({ storage: "local" });
  const tabB = new EAuth({ ...config, storage: "local" });
  await tabB.ready();
  await tabA.signOut();
  assert.deepEqual(new Set(b.server.revoked), new Set(["refresh-1", "refresh-2"]));
  due(tabB);
  assert.equal(await tabB.getAccessToken(), null);
  assert.equal(tabB.isAuthenticated(), false);
});

test("getAccessToken before anything called ready starts it", async () => {
  // React runs a child's effect before the provider's.
  const { b } = await signedIn({ storage: "local" });
  const again = new EAuth({ ...config, storage: "local" });
  assert.equal(await again.getAccessToken(), "access-2");
  await again.ready();
  assert.equal(grants(b, "refresh_token").length, 1);
});

test("local storage: a sign-out in another tab during a refresh stays a sign-out", async () => {
  const { b, auth: tabA } = await signedIn({ storage: "local" });
  const tabB = new EAuth({ ...config, storage: "local" });
  await tabB.ready();
  due(tabB);
  let release!: () => void;
  b.server.hold = new Promise((r) => (release = r));
  const refreshing = tabB.getAccessToken();
  await tick();
  // Tab A signs out while EAuth is answering tab B, without the revocation
  // reaching EAuth first.
  await tabA.signOut({ local: true });
  release();
  b.server.hold = undefined;
  assert.equal(await refreshing, null);
  assert.equal(tabB.isAuthenticated(), false);
  assert.equal(stored(b), undefined, "nothing was stored again");
  assert.ok(b.server.revoked.includes("refresh-3"), "tab B handed its new token back");
  assert.equal((await new EAuth({ ...config, storage: "local" }).ready()).user, null, "the next page load is signed out");
});

test("local storage: a tab never presents the token of another account", async () => {
  const { b, auth: tabB } = await signedIn({ storage: "local" });
  // Tab A signs in as somebody else.
  const tabA = new EAuth({ ...config, storage: "local" });
  await tabA.signIn({ prompt: "login" });
  b.answer({ code: issueCode(b, { sub: "user-2", email: "ben@example.test" }) });
  await tabA.handleRedirect();
  assert.equal(JSON.parse(b.local.getItem("eauth:refresh")!).sub, "user-2");

  due(tabB);
  assert.equal(await tabB.getAccessToken(), null);
  assert.equal(tabB.isAuthenticated(), false);
  assert.equal(grants(b, "refresh_token").length, 0, "tab B presented nothing");
  assert.equal(stored(b), "refresh-2", "tab A's token is untouched");
  assert.equal(tabA.getUser()?.sub, "user-2");
});

test("a token request that never answers is given up", async () => {
  const { b, auth } = await signedIn({ storage: "local" });
  (auth as unknown as { requestTimeout: number }).requestTimeout = 50;
  b.server.hold = new Promise(() => {});
  due(auth);
  // Node does not wait for the timer of AbortSignal.timeout; a browser does.
  const alive = setTimeout(() => {}, 5_000);
  const started = Date.now();
  assert.equal(await auth.getAccessToken(), "access-1", "the current token is still good");
  clearTimeout(alive);
  assert.ok(Date.now() - started < 2_000);
  assert.equal(auth.isAuthenticated(), true);
});

test("local storage that refuses the token keeps the session in memory", async () => {
  const b = browser();
  b.local.refuse.add("eauth:refresh");
  const { auth } = await signedIn({ storage: "local" }, b);
  due(auth);
  assert.equal(await auth.getAccessToken(), "access-2");
  assert.equal(auth.isAuthenticated(), true);
});

// --- refreshing ----------------------------------------------------------------

test("concurrent callers share one refresh, and the rotated token is kept", async () => {
  const { b, auth } = await signedIn();
  due(auth);
  let release!: () => void;
  b.server.hold = new Promise((r) => (release = r));
  const calls = Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
  await tick();
  release();
  b.server.hold = undefined;
  assert.deepEqual(await calls, ["access-2", "access-2", "access-2"]);
  assert.equal(grants(b, "refresh_token").length, 1);

  // The next refresh presents the new token, not the rotated one.
  due(auth);
  assert.equal(await auth.getAccessToken(), "access-3");
  assert.equal(grants(b, "refresh_token")[1].body.get("refresh_token"), "refresh-2");
});

test("a refresh EAuth refuses signs out and reports null", async () => {
  const changes: unknown[] = [];
  const { b, auth } = await signedIn({ onChange: (u) => changes.push(u) });
  b.server.refreshTokens.clear();
  due(auth);
  assert.equal(await auth.getAccessToken(), null);
  assert.equal(auth.getUser(), null);
  assert.equal(changes.at(-1), null);
});

test("a refresh that fails for a passing reason keeps the session", async () => {
  for (const fail of ["network", { status: 503 }, { status: 500, body: { error: "server_error" } }] as const) {
    const { b, auth } = await signedIn({ storage: "local" });
    b.server.fail = fail;
    due(auth);
    assert.equal(await auth.getAccessToken(), "access-1", "the current token is still good");
    assert.equal(auth.isAuthenticated(), true);
    assert.equal(stored(b), "refresh-1", "the stored token stays");
    assert.equal(await auth.getAccessToken(), "access-2", "the next call refreshes");
  }
  {
    // Offline when the page loads: signed out for now, but the token stays for later.
    const { b } = await signedIn({ storage: "local" });
    b.server.fail = "network";
    const again = new EAuth({ ...config, storage: "local" });
    assert.equal((await again.ready()).user, null);
    assert.equal(stored(b), "refresh-1");
    assert.equal(await again.getAccessToken(), "access-2");
    assert.equal(again.getUser()?.sub, "user-1");
  }
});

test("signing out during a refresh does not bring the session back", async () => {
  const changes: (EAuthUser | null)[] = [];
  const { b, auth } = await signedIn({ storage: "local", onChange: (u) => changes.push(u) });
  due(auth);
  let release!: () => void;
  b.server.hold = new Promise((r) => (release = r));
  const refreshing = auth.getAccessToken();
  await tick();
  // EAuth has already answered the refresh when the sign-out happens.
  await auth.signOut({ local: true });
  release();
  b.server.hold = undefined;
  assert.equal(await refreshing, null);
  assert.equal(auth.getUser(), null);
  assert.deepEqual(changes.map((u) => u?.sub ?? null), ["user-1", null]);
  assert.equal(stored(b), undefined);
  assert.equal(b.local.getItem("eauth:signed-in"), null);
  assert.ok(b.server.revoked.includes("refresh-2"), "the token the late refresh brought is revoked");
});

test("a refreshed ID token must name the same person", async () => {
  const { b, auth } = await signedIn();
  b.server.refreshClaims = { sub: "user-2" };
  due(auth);
  assert.equal(await auth.getAccessToken(), null);
  assert.equal(auth.getUser(), null);
  assert.ok(b.server.revoked.includes("refresh-2"));
});

// --- organisations ---------------------------------------------------------------

const ACME_ID = "0199b2c4-5e6f-7a80-9b1c-2d3e4f506172";
const acme = {
  org_id: ACME_ID, org_slug: "acme", org_name: "Acme AG",
  org_role: "admin", org_permissions: ["invoices:read", 7, "invoices:pay"],
};

test("an organisation is asked for by id or slug, checked, and on the user", async () => {
  const b = browser();
  // Every form EAuth reads an ID in, and a slug in capitals.
  const hex = ACME_ID.replace(/-/g, "");
  for (const ref of ["acme", "ACME", ACME_ID, ACME_ID.toUpperCase(), `{${ACME_ID}}`, `urn:uuid:${ACME_ID}`, hex, ` acme `]) {
    const auth = new EAuth(config);
    await auth.signIn({ organization: ref });
    assert.equal(b.navigations.at(-1)!.searchParams.get("organization"), ref.trim());
    b.answer({ code: issueCode(b, acme) });
    const result = await auth.handleRedirect();
    assert.deepEqual(result?.user?.organization, {
      id: ACME_ID, slug: "acme", name: "Acme AG", role: "admin",
      permissions: ["invoices:read", "invoices:pay"],
    }, ref);
  }

  // An empty one asks for none, and checks nothing.
  for (const ref of ["", "  "]) {
    const auth = new EAuth(config);
    await auth.signIn({ organization: ref });
    assert.equal(b.navigations.at(-1)!.searchParams.get("organization"), null);
    b.answer({ code: issueCode(b, acme) });
    assert.equal((await auth.handleRedirect())?.user?.organization?.id, ACME_ID);
  }

  // A slug that reads like another organisation's ID is not taken for it.
  const lookalike = new EAuth(config);
  await lookalike.signIn({ organization: ACME_ID.replace(/.$/, "0") });
  b.answer({ code: issueCode(b, acme) });
  await rejects(lookalike.handleRedirect(), "organization_mismatch");

  // An answer for another organisation than the one asked for is refused.
  const other = new EAuth(config);
  await other.signIn({ organization: "globex" });
  b.answer({ code: issueCode(b, acme) });
  await rejects(other.handleRedirect(), "organization_mismatch");
  assert.equal(other.getUser(), null);

  // Without organisations there is none, and nothing is asked for.
  const { b: plain, user } = await signedIn();
  assert.equal(user?.organization, undefined);
  assert.equal(plain.navigations.at(-1)!.searchParams.get("organization"), null);
});

test("a refresh continues in the organisation, and one for another ends the session", async () => {
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn();
  b.answer({ code: issueCode(b, acme) });
  await auth.handleRedirect();

  // The role as it is now.
  b.server.refreshClaims = { ...acme, org_role: "member", org_permissions: [] };
  due(auth);
  assert.equal(await auth.getAccessToken(), "access-2");
  assert.deepEqual(auth.getUser()?.organization?.role, "member");

  // Another organisation, or none, is not this session.
  for (const claims of [{ ...acme, org_id: "0199b2c4-5e6f-7a80-9b1c-2d3e4f506173" }, {}]) {
    const again = new EAuth(config);
    await again.signIn();
    b.answer({ code: issueCode(b, acme) });
    await again.handleRedirect();
    b.server.refreshClaims = claims;
    due(again);
    assert.equal(await again.getAccessToken(), null);
    assert.equal(again.getUser(), null);
  }
});

test("a reload continues in the organisation this tab was in", async () => {
  const b = browser();
  const auth = new EAuth(config);
  await auth.signIn({ organization: "acme" });
  b.answer({ code: issueCode(b, acme) });
  await auth.handleRedirect();

  // Not the one EAuth would take, used last perhaps in another tab.
  b.open(`${APP}/invoices`);
  void new EAuth(config).restore();
  await tick();
  assert.equal(b.navigations.at(-1)!.searchParams.get("organization"), ACME_ID);
  b.answer({ code: issueCode(b, acme) });
  assert.equal((await new EAuth(config).ready()).user?.organization?.id, ACME_ID);

  // No longer allowed in: signed out quietly, and the next sign-in chooses.
  b.open(`${APP}/invoices`);
  void new EAuth(config).restore();
  await tick();
  b.answer({ error: "access_denied" });
  assert.deepEqual(await new EAuth(config).ready(), { user: null, returnTo: "/invoices" });
  assert.equal(b.session.getItem("eauth:organization"), null);
  await new EAuth(config).signIn();
  assert.equal(b.navigations.at(-1)!.searchParams.get("organization"), null);

  // An access_denied the application asked for, silently, is its to see.
  const asked = new EAuth(config);
  await asked.signIn({ prompt: "none", organization: "acme" });
  b.answer({ error: "access_denied" });
  await rejects(asked.handleRedirect(), "access_denied");

  // A tab without an organisation asks for none.
  const { b: plain } = await signedIn();
  plain.open(`${APP}/invoices`);
  void new EAuth(config).restore();
  await tick();
  assert.equal(plain.navigations.at(-1)!.searchParams.get("organization"), null);
});

test("local storage: a tab never presents the token of another organisation", async () => {
  const b = browser();
  const tabB = new EAuth({ ...config, storage: "local" });
  await tabB.signIn({ organization: "acme" });
  b.answer({ code: issueCode(b, acme) });
  await tabB.handleRedirect();
  assert.equal(JSON.parse(b.local.getItem("eauth:refresh")!).org, ACME_ID);

  // Tab A, the same person, signs in to another organisation.
  const globex = { ...acme, org_id: "0199b2c4-5e6f-7a80-9b1c-2d3e4f506173", org_slug: "globex" };
  const tabA = new EAuth({ ...config, storage: "local" });
  await tabA.signIn({ organization: "globex" });
  b.answer({ code: issueCode(b, globex) });
  await tabA.handleRedirect();
  const held = stored(b);

  due(tabB);
  assert.equal(await tabB.getAccessToken(), null);
  assert.equal(tabB.isAuthenticated(), false);
  assert.equal(grants(b, "refresh_token").length, 0, "tab B presented nothing");
  assert.equal(stored(b), held, "tab A's token is untouched");
  assert.equal(b.server.revoked.length, 0, "nothing was revoked");
  assert.equal(tabA.getUser()?.organization?.slug, "globex");
});

test("without a refresh token the session ends with the access token, and a reload can continue it", async () => {
  const changes: (EAuthUser | null)[] = [];
  const b = browser();
  b.server.offline = false;
  const { auth } = await signedIn({ onChange: (u) => changes.push(u) }, b);
  assert.equal(await auth.getAccessToken(), "access-1");
  (auth as unknown as { tokens: { expiresAt: number } }).tokens.expiresAt = Date.now() - 1;
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(await auth.getAccessToken(), null);
  assert.deepEqual(changes.map((u) => u?.sub ?? null), ["user-1", null]);
  assert.equal(b.local.getItem("eauth:signed-in"), "1", "the next page load may restore silently");
});

test("a short lifetime is renewed halfway, not on every call", async () => {
  const b = browser();
  b.server.expiresIn = 30;
  const { auth } = await signedIn({}, b);
  for (let i = 0; i < 3; i++) assert.equal(await auth.getAccessToken(), "access-1");
  assert.equal(grants(b, "refresh_token").length, 0);
});

test("without expires_in, an opaque access token gets a cautious lifetime", async () => {
  const b = browser();
  b.server.expiresIn = null;
  const { auth } = await signedIn({}, b);
  const expiresAt = (auth as unknown as { tokens: { expiresAt: number } }).tokens.expiresAt;
  assert.ok(Math.abs(expiresAt - (Date.now() + 300_000)) < 5_000);
});

// --- signing out, calling APIs -------------------------------------------------

test("signOut revokes the refresh token and forgets the session", async () => {
  const { b, auth } = await signedIn();
  await auth.signOut();
  const revoke = b.server.requests.find((r) => r.url.pathname === "/revoke")!;
  assert.equal(revoke.body.get("token"), "refresh-1");
  assert.equal(revoke.body.get("client_id"), CLIENT_ID);
  assert.equal(auth.getUser(), null);
  assert.equal(await auth.getAccessToken(), null);
  assert.equal(b.local.getItem("eauth:signed-in"), null);
});

test("signOut with local revokes nothing", async () => {
  const { b, auth } = await signedIn();
  await auth.signOut({ local: true });
  assert.equal(b.server.count("/revoke"), 0);
});

test("signOut with endSession goes to EAuth with the ID token as proof", async () => {
  const { b, auth } = await signedIn({ postLogoutRedirectUri: `${APP}/bye` });
  await auth.signOut({ endSession: true });
  const url = b.navigations.at(-1)!;
  assert.equal(url.origin + url.pathname, `${ISSUER}/logout`);
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("post_logout_redirect_uri"), `${APP}/bye`);
  assert.ok(url.searchParams.get("id_token_hint"));
});

test("fetch attaches the access token and keeps a Request's own headers", async () => {
  const { b, auth } = await signedIn();
  const res = await auth.fetch(`${ISSUER}/userinfo`);
  assert.equal(res.status, 200);
  assert.equal(b.server.requests.at(-1)!.headers.get("Authorization"), "Bearer access-1");

  let seen: Headers | undefined;
  const real = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen = new Headers(init?.headers);
    return new Response("{}");
  };
  try {
    await auth.fetch(new Request(`${APP}/api`, { method: "POST", headers: { "X-CSRF": "t", "Content-Type": "application/json" } }));
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen?.get("X-CSRF"), "t");
  assert.equal(seen?.get("Content-Type"), "application/json");
  assert.equal(seen?.get("Authorization"), "Bearer access-1");
});

test("decodeClaims reads UTF-8 and refuses what is not a token", () => {
  assert.equal(decodeClaims(jwt({ name: "Zoë Müller" })).name, "Zoë Müller");
  const refused = (token: string) =>
    assert.throws(() => decodeClaims(token), (e: unknown) => e instanceof EAuthError && e.code === "invalid_token");
  refused("not-a-token");
  refused("a.%%%.c");
  refused(`a.${Buffer.from("[1,2]").toString("base64url")}.c`);
});

test("outside a browser the browser-only methods say so", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  delete g.window;
  try {
    await rejects(new EAuth(config).signIn(), "not_in_browser");
  } finally {
    g.window = saved;
  }
});

test("ready completes a sign-in once, however often it is called", async () => {
  const b = browser();
  const first = new EAuth(config);
  await first.signIn();
  b.answer({ code: issueCode(b) });
  const auth = new EAuth(config);
  const [a, c] = await Promise.all([auth.ready(), auth.ready()]);
  assert.equal(a.user?.sub, "user-1");
  assert.equal(a, c);
  assert.equal(grants(b, "authorization_code").length, 1);
});
