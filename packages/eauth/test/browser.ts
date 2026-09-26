// A browser and an EAuth server, both small enough to read, for the tests.
//
// The browser is the part of the DOM the library touches: location,
// history, the two storages, fetch and navigator.locks. The server answers
// discovery, the token endpoint and revocation the way EAuth does (codes
// are spent once, refresh tokens rotate, and presenting a rotated one ends
// the whole session), and records every request so a test can check what
// was sent.

export const ISSUER = "https://auth.test";
export const APP = "https://app.test";
export const CLIENT_ID = "eauth_pub_testclientidentifier1";

class MemoryStorage {
  private map = new Map<string, string>();
  /** Makes setItem throw for these keys, as a full or blocked storage does. */
  refuse = new Set<string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.refuse.has(k)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

export interface Request {
  url: URL;
  method: string;
  body: URLSearchParams;
  headers: Headers;
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

/** An unsigned JWT; the library reads the claims and never the signature. */
export function jwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}.c2ln`;
}

export class Server {
  requests: Request[] = [];
  /** Codes the server will accept, with what they were issued for. */
  codes = new Map<string, { verifier?: string; nonce?: string; claims?: Record<string, unknown> }>();
  refreshTokens = new Set<string>();
  /** Refresh tokens that were rotated; presenting one again is theft. */
  rotated = new Set<string>();
  revoked: string[] = [];
  /** Answers the next token request with this status and body instead. */
  fail?: { status: number; body?: Record<string, unknown> } | "network";
  discovery: Record<string, unknown> = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    revocation_endpoint: `${ISSUER}/revoke`,
    end_session_endpoint: `${ISSUER}/logout`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
  offline = true;
  private counter = 0;
  /** Makes the next token response wait for this promise. */
  hold?: Promise<void>;
  /** Claims for the ID tokens of refreshes. */
  refreshClaims?: Record<string, unknown>;
  /** Lifetime of access tokens, in seconds; null leaves expires_in out. */
  expiresIn: number | null = 900;

  idToken(extra: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt({
      iss: ISSUER, sub: "user-1", aud: CLIENT_ID, iat: now, exp: now + 900, auth_time: now,
      name: "Anna Muster", email: "anna@example.test", email_verified: true, ...extra,
    });
  }

  async handle(url: URL, init: RequestInit = {}): Promise<Response> {
    const body = new URLSearchParams(typeof init.body === "string" ? init.body : (init.body as URLSearchParams | undefined)?.toString() ?? "");
    this.requests.push({ url, method: init.method ?? "GET", body, headers: new Headers(init.headers) });
    const json = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/.well-known/openid-configuration") return json(200, this.discovery);
    if (url.pathname === "/revoke") {
      const token = body.get("token") ?? "";
      this.revoked.push(token);
      this.refreshTokens.delete(token);
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/userinfo") {
      return url && new Headers(init.headers).get("Authorization")?.startsWith("Bearer ")
        ? json(200, { sub: "user-1", email: "anna@example.test" })
        : json(401, { error: "invalid_token" });
    }
    if (url.pathname !== "/token") return json(404, { error: "not_found" });
    if (this.hold) await this.hold;
    if (this.fail) {
      const fail = this.fail;
      this.fail = undefined;
      if (fail === "network") throw new TypeError("Failed to fetch");
      return json(fail.status, fail.body ?? {});
    }

    const grant = body.get("grant_type");
    if (grant === "authorization_code") {
      const issued = this.codes.get(body.get("code") ?? "");
      if (!issued) return json(400, { error: "invalid_grant", error_description: "The code is invalid." });
      this.codes.delete(body.get("code")!);
      if (issued.verifier !== undefined) {
        const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier") ?? ""))).toString("base64url");
        if (digest !== issued.verifier) return json(400, { error: "invalid_grant", error_description: "PKCE failed." });
      }
      return json(200, this.tokens(issued.claims ?? { nonce: issued.nonce }));
    }
    if (grant === "refresh_token") {
      const token = body.get("refresh_token") ?? "";
      if (this.rotated.has(token)) {
        // Reuse of a rotated token: somebody has a copy. The session ends.
        this.refreshTokens.clear();
        return json(400, { error: "invalid_grant", error_description: "The refresh token was already used." });
      }
      if (!this.refreshTokens.has(token)) {
        return json(400, { error: "invalid_grant", error_description: "The refresh token is invalid." });
      }
      this.refreshTokens.delete(token);
      this.rotated.add(token);
      return json(200, this.tokens(this.refreshClaims ?? {}));
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  private tokens(claims: Record<string, unknown>): Record<string, unknown> {
    this.counter++;
    const out: Record<string, unknown> = {
      access_token: `access-${this.counter}`,
      token_type: "Bearer",
      ...(this.expiresIn === null ? {} : { expires_in: this.expiresIn }),
      scope: "openid profile email offline_access",
      id_token: this.idToken(claims),
    };
    if (this.offline) {
      const refresh = `refresh-${this.counter}`;
      this.refreshTokens.add(refresh);
      out.refresh_token = refresh;
    }
    return out;
  }

  count(path: string): number {
    return this.requests.filter((r) => r.url.pathname === path).length;
  }
}

export interface Browser {
  server: Server;
  local: MemoryStorage;
  session: MemoryStorage;
  /** Every address the page navigated to, with location.assign or location.replace. */
  navigations: URL[];
  /** The ones of those that replaced the history entry. */
  replacements: URL[];
  /** Sets the address as if the page had just loaded there. */
  open(href: string): void;
  /** Follows the last navigation to /authorize as EAuth would, answering with a code or an error. */
  answer(result: { code?: string; error?: string; iss?: string | null; state?: string }): string;
}

/** Installs a fresh browser around a fresh server. */
export function browser(): Browser {
  const server = new Server();
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const navigations: URL[] = [];
  const replacements: URL[] = [];
  let current = new URL(`${APP}/`);

  const loc = {
    get href() { return current.href; },
    get origin() { return current.origin; },
    get pathname() { return current.pathname; },
    get search() { return current.search; },
    get hash() { return current.hash; },
    assign(to: string) { navigations.push(new URL(to, current)); },
    replace(to: string) {
      navigations.push(new URL(to, current));
      replacements.push(new URL(to, current));
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.location = loc;
  g.history = {
    state: null,
    replaceState(_s: unknown, _t: string, to: string) { current = new URL(to, current); },
    pushState(_s: unknown, _t: string, to: string) { current = new URL(to, current); },
  };
  // Web Locks, as the tabs of one origin share them: one holder per name
  // at a time, the others queued in order.
  const queues = new Map<string, Promise<unknown>>();
  const locks = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const previous = queues.get(name) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(callback);
      queues.set(name, run.catch(() => undefined));
      return run;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node", locks },
    configurable: true,
    writable: true,
  });
  g.localStorage = local;
  g.sessionStorage = session;
  g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== ISSUER) return Promise.resolve(new Response("no", { status: 599 }));
    const answer = server.handle(url, init);
    const signal = init?.signal;
    if (!signal) return answer;
    // A request given up by its signal fails, as in a browser.
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      answer.then(resolve, reject);
    });
  };

  return {
    server, local, session, navigations, replacements,
    open(href) { current = new URL(href, APP); },
    answer({ code, error, iss = ISSUER, state }) {
      const auth = [...navigations].reverse().find((n) => n.pathname === "/authorize");
      if (!auth) throw new Error("no sign-in was started");
      const back = new URL(auth.searchParams.get("redirect_uri")!);
      back.searchParams.set("state", state ?? auth.searchParams.get("state")!);
      if (iss !== null) back.searchParams.set("iss", iss);
      if (code) back.searchParams.set("code", code);
      if (error) back.searchParams.set("error", error);
      current = back;
      return back.href;
    },
  };
}

/** Issues a code for the sign-in the page started, bound to its PKCE challenge and nonce. */
export function issueCode(b: Browser, claims?: Record<string, unknown>): string {
  const auth = [...b.navigations].reverse().find((n) => n.pathname === "/authorize")!;
  const code = `code-${Math.random().toString(36).slice(2)}`;
  b.server.codes.set(code, {
    verifier: auth.searchParams.get("code_challenge")!,
    nonce: auth.searchParams.get("nonce")!,
    claims: claims ? { nonce: auth.searchParams.get("nonce")!, ...claims } : undefined,
  });
  return code;
}
