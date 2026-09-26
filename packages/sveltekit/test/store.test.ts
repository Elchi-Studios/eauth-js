import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { EAuth } from "@elchi-studios/eauth";
import { createAuth, type AuthState } from "../src/index.ts";
import { APP, CLIENT_ID, ISSUER, browser, issueCode } from "../../eauth/test/browser.ts";

const config = { clientId: CLIENT_ID, redirectUri: `${APP}/callback`, issuer: ISSUER };

function until(store: { subscribe: (fn: (s: AuthState) => void) => () => void }, done: (s: AuthState) => boolean): Promise<AuthState> {
  return new Promise((resolve) => {
    let stop: (() => void) | undefined;
    stop = store.subscribe((s) => {
      if (done(s)) {
        queueMicrotask(() => stop?.());
        resolve(s);
      }
    });
  });
}

test("on the server the store says loading and touches no browser API", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, location: g.location };
  delete g.window;
  delete g.location;
  try {
    const auth = createAuth(config);
    assert.deepEqual(get(auth), { user: null, loading: true, error: null });
    assert.equal(auth.client, null);
    assert.equal(await auth.getAccessToken(), null);
  } finally {
    Object.assign(g, saved);
  }
});

test("in the browser a sign-in completes and the store follows", async () => {
  const b = browser();
  await new EAuth(config).signIn({ returnTo: "/orders" });
  b.answer({ code: issueCode(b) });

  let returned = "";
  const auth = createAuth({ ...config, onReturn: (p) => (returned = p) });
  const state = await until(auth, (s) => !s.loading);
  assert.equal(state.user?.email, "anna@example.test");
  assert.equal(returned, "/orders");
  assert.equal(await auth.getAccessToken(), "access-1");

  // Two subscribers share one client and one exchange.
  await until(auth, (s) => !s.loading);
  assert.equal(b.server.requests.filter((r) => r.body.get("grant_type") === "authorization_code").length, 1);

  await auth.signOut();
  assert.equal(get(auth).user, null);
});

test("a refused sign-in lands in the store as the error, with the way back", async () => {
  const b = browser();
  b.open(`${APP}/shop`);
  await new EAuth(config).signIn({ returnTo: "/orders" });
  b.answer({ error: "access_denied" });
  let returned = "";
  const auth = createAuth({ ...config, onReturn: (p) => (returned = p) });
  const state = await until(auth, (s) => !s.loading);
  assert.equal(state.error?.code, "access_denied");
  assert.equal(state.user, null);
  assert.equal(returned, "/shop");
});

test("a store that loses its last subscriber and gains a new one keeps the session", async () => {
  const b = browser();
  await new EAuth(config).signIn();
  b.answer({ code: issueCode(b) });
  const auth = createAuth(config);
  await until(auth, (s) => !s.loading);
  const again = await until(auth, (s) => !s.loading);
  assert.equal(again.user?.sub, "user-1");
  assert.equal(b.server.requests.filter((r) => r.body.get("grant_type") === "authorization_code").length, 1);
});
