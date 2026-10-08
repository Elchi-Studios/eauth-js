// EAuth as a real browser sees it, for the tests that drive Chromium: the
// same stand-in server as the unit tests, reached through request
// interception instead of a patched fetch.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { ISSUER, Server } from "./browser.ts";

/** Chromium from `npx playwright-core install chromium`, or from CHROMIUM_PATH. */
export function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

export interface Stand {
  server: Server;
  /** Every request to /authorize, in order. */
  authorizations: URL[];
  /** Ends the session at EAuth, as a sign-out on another device would. */
  forget(): void;
  /** Claims the next sign-in puts into the ID token. */
  claims?: Record<string, unknown>;
  /** The person declines at EAuth. */
  decline?: boolean;
  /** A path the answers are sent to instead, as a redirect in front of the application would. */
  misroute?: string;
  /** Requests that left for anywhere but the page's own server and the stand-in. */
  unexpected: string[];
}

/**
 * Routes every request to the issuer in this context to a stand-in for
 * EAuth, and refuses every other request that would leave the machine, so a
 * test never depends on the network. Routes added later take precedence.
 */
export async function eauth(context: BrowserContext): Promise<Stand> {
  const stand: Stand = {
    server: new Server(),
    authorizations: [],
    unexpected: [],
    forget() {
      session = false;
    },
  };
  await context.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === "localhost" || hostname === "127.0.0.1") return route.continue();
    stand.unexpected.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  let session = false;

  // CORS as EAuth answers it, no wider, so a test passes only where the
  // real server lets the browser read the answer: discovery, the keys and
  // userinfo for any page; the token endpoint and revocation only for a
  // page on the origin of a redirect URI the client uses; credentials never.
  const preflight = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST",
    "access-control-allow-headers": "Authorization, Content-Type",
  };
  const cors = (url: URL, origin: string | undefined): Record<string, string> => {
    if (url.pathname.startsWith("/.well-known/") || url.pathname === "/userinfo") {
      return { "access-control-allow-origin": "*" };
    }
    const registered = stand.authorizations.map((a) => new URL(a.searchParams.get("redirect_uri")!).origin);
    if ((url.pathname === "/token" || url.pathname === "/revoke") && origin && registered.includes(origin)) {
      return { "access-control-allow-origin": origin, vary: "Origin" };
    }
    return {};
  };

  await context.route(`${ISSUER}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: preflight });

    if (url.pathname === "/authorize") {
      stand.authorizations.push(url);
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("state", url.searchParams.get("state")!);
      back.searchParams.set("iss", ISSUER);
      if (url.searchParams.get("prompt") === "none" && !session) {
        back.searchParams.set("error", "login_required");
      } else if (stand.decline) {
        back.searchParams.set("error", "access_denied");
      } else {
        // The person signs in here; EAuth remembers them from now on.
        session = true;
        const code = `code-${stand.authorizations.length}`;
        const nonce = url.searchParams.get("nonce")!;
        stand.server.codes.set(code, {
          verifier: url.searchParams.get("code_challenge")!,
          nonce,
          claims: stand.claims ? { nonce, ...stand.claims } : undefined,
        });
        back.searchParams.set("code", code);
      }
      if (stand.misroute) back.pathname = stand.misroute;
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }

    let response: Response;
    try {
      response = await stand.server.handle(url, {
        method: request.method(),
        body: request.postData() ?? undefined,
        headers: request.headers(),
      });
    } catch {
      return route.abort("failed");
    }
    return route.fulfill({
      status: response.status,
      headers: {
        ...cors(url, request.headers()["origin"]),
        "content-type": response.headers.get("content-type") ?? "text/plain",
      },
      body: await response.text(),
    });
  });
  return stand;
}

/** A page that records every script error and hydration warning. */
export async function open(context: BrowserContext): Promise<{ page: Page; problems: string[] }> {
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text())) problems.push(message.text());
  });
  return { page, problems };
}
