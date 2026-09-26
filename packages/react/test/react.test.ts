import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act, createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { EAuth } from "@elchi-studios/eauth";
import { EAuthProvider, SignedIn, SignedOut, useEAuth } from "../dist/index.js";
import { APP, CLIENT_ID, ISSUER, browser, issueCode } from "../../eauth/test/browser.ts";

const config = { clientId: CLIENT_ID, redirectUri: `${APP}/callback`, issuer: ISSUER };

function Who() {
  const { user, loading } = useEAuth();
  return h("p", { id: "who" }, loading ? "loading" : user ? user.email : "nobody");
}

/** A DOM for React, next to the fake browser the core talks to. */
function dom() {
  const win = new Window({ url: APP });
  const g = globalThis as Record<string, unknown>;
  g.document = win.document;
  // What react-dom reads from the global window; 18 also looks for iframes
  // when it restores focus after a commit.
  g.HTMLElement = win.HTMLElement;
  g.HTMLIFrameElement = win.HTMLIFrameElement;
  g.Element = win.Element;
  g.Node = win.Node;
  g.PopStateEvent = win.PopStateEvent;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const pops: string[] = [];
  (g.window as { addEventListener?: unknown }).addEventListener ??= () => {};
  (g.window as { dispatchEvent?: (e: { type: string }) => boolean }).dispatchEvent = (e) => {
    pops.push(e.type);
    return true;
  };
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  return { container, pops };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

test("server rendering shows the fallback and touches no browser API", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, location: g.location };
  delete g.window;
  delete g.location;
  try {
    const html = renderToString(
      h(EAuthProvider, { ...config, fallback: h("span", null, "one moment") }, h(SignedOut, null, "sign in")),
    );
    assert.match(html, /one moment/);
    assert.doesNotMatch(html, /sign in/);
  } finally {
    Object.assign(g, saved);
  }
});

test("a sign-in completes once in StrictMode, and the page returns where it was", async () => {
  const b = browser();
  const { container, pops } = dom();
  const starter = new EAuth(config);
  await starter.signIn({ returnTo: "/orders" });
  b.answer({ code: issueCode(b) });

  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(h(StrictMode, null, h(EAuthProvider, config, h(Who), h(SignedIn, null, h("b", null, "in")))));
  });
  await settle();
  assert.equal(container.querySelector("#who")?.textContent, "anna@example.test");
  assert.equal(container.querySelector("b")?.textContent, "in");
  assert.equal(b.server.requests.filter((r) => r.body.get("grant_type") === "authorization_code").length, 1);
  assert.equal(location.pathname, "/orders");
  assert.deepEqual(pops, ["popstate"]);
  await act(async () => root.unmount());
});

test("nobody signed in: SignedOut shows, and onReturn is not called", async () => {
  browser();
  const { container } = dom();
  let returned = "";
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(
      h(EAuthProvider, { ...config, onReturn: (p: string) => (returned = p) }, h(Who), h(SignedOut, null, h("i", null, "out"))),
    );
  });
  await settle();
  assert.equal(container.querySelector("#who")?.textContent, "nobody");
  assert.equal(container.querySelector("i")?.textContent, "out");
  assert.equal(returned, "");
  await act(async () => root.unmount());
});

test("a refused sign-in is reported as the error, and the page returns where it was", async () => {
  const b = browser();
  const { container, pops } = dom();
  b.open(`${APP}/shop`);
  const starter = new EAuth(config);
  await starter.signIn({ returnTo: "/orders" });
  b.answer({ error: "access_denied" });
  function Err() {
    const { error, loading } = useEAuth();
    return h("p", { id: "err" }, loading ? "" : error?.code ?? "none");
  }
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(h(EAuthProvider, config, h(Err)));
  });
  await settle();
  assert.equal(container.querySelector("#err")?.textContent, "access_denied");
  assert.equal(location.pathname, "/shop", "declining leads back to where the person was");
  assert.deepEqual(pops, ["popstate"]);
  await act(async () => root.unmount());
});
