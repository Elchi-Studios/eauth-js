/**
 * @elchi-studios/eauth: sign-in with EAuth for any web page.
 *
 * Everything a browser needs to sign somebody in through EAuth, with the
 * checks the specifications require already done. Four decisions are worth
 * knowing before you read further, because they differ from what a quick
 * tutorial would tell you:
 *
 * 1. Tokens live in memory by default, never in localStorage. A token in
 *    localStorage is readable by any script on the page, so one cross-site
 *    scripting bug in any dependency hands over the session. After a reload
 *    the page asks EAuth again without showing anything (prompt=none), which
 *    costs one quick redirect and nothing else.
 *
 * 2. `state`, `nonce`, `iss` and `aud` are verified for you, and a mismatch
 *    throws. These are the checks integrations most often skip, and each one
 *    exists because somebody was compromised without it.
 *
 * 3. There is no client secret anywhere in this package. A browser cannot
 *    keep one. If you find yourself wanting to pass one, the application is
 *    registered as the wrong type: make it public in the console.
 *
 * 4. Refreshes never overlap. Refresh tokens rotate, and two refreshes at
 *    once would present a token that was already rotated, which the server
 *    rightly reads as theft and answers by ending the session. Callers in
 *    one page share a refresh, and with storage "local" the tabs of an
 *    origin take turns.
 */

export interface EAuthConfig {
  /** The application's client ID, from panel.elchi.dev. */
  clientId: string;
  /** Must match a registered redirect URI exactly, including any trailing slash. */
  redirectUri: string;
  /**
   * Where to send the browser after signing out at EAuth (signOut with
   * endSession). Must be registered as a post-logout URI. Defaults to
   * redirectUri.
   */
  postLogoutRedirectUri?: string;
  /** Defaults to https://eauth.me. Point this at your own deployment if you run one. */
  issuer?: string;
  /**
   * Defaults to "openid profile email offline_access". With offline_access
   * the session outlives the 15 minutes of an access token; EAuth leaves it
   * out for an application whose settings do not allow it.
   */
  scope?: string;
  /**
   * Where to keep the refresh token between page loads.
   *
   * "memory" is the default and the safe answer: nothing survives a reload,
   * and the next page load signs in again silently (see silentRestore).
   * "local" persists the refresh token across reloads, where any script on
   * your origin can read it; choose it only if you have understood that.
   */
  storage?: "memory" | "local";
  /**
   * Whether restore() may sign in again silently after a reload, with a
   * redirect through EAuth that shows nothing. On by default with memory
   * storage; the redirect only happens when this browser was signed in
   * before.
   */
  silentRestore?: boolean;
  /** Called whenever the signed-in user changes, including on sign-out. */
  onChange?: (user: EAuthUser | null) => void;
}

export interface EAuthUser {
  /** The stable account ID. Use this, not the email address, as your key. */
  sub: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  /**
   * The organisation the person signed in for, for applications that use
   * organisations; absent otherwise.
   */
  organization?: EAuthOrganization;
  /** Every claim of the ID token, for anything not mapped above. */
  claims: Record<string, unknown>;
}

/** An organisation a person signed in for, from the org_* claims. */
export interface EAuthOrganization {
  /** The organisation's ID. Use this as your key; it never changes. */
  id: string;
  /** Its slug, which an admin can change. */
  slug: string;
  name: string;
  /** The key of the person's role there. */
  role: string;
  /** That role's permissions, as your application named them. */
  permissions: string[];
}

export interface EAuthTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  /** Absolute expiry in milliseconds since the epoch, not a duration. */
  expiresAt: number;
  scope: string;
}

/** What a page load came to: see ready(). */
export interface ReadyResult {
  /** The signed-in user, or null. */
  user: EAuthUser | null;
  /**
   * Set when this page load handled an answer from EAuth: the path the
   * application should show now, on its own origin. It is where the sign-in
   * was started (signIn's returnTo, or the page a silent restore left), and
   * otherwise the current path without the answer. Hand it to your router,
   * which may still hold the address as it was before the answer was
   * removed from it.
   */
  returnTo?: string;
}

export interface SignInOptions {
  /**
   * "login" asks for the password again even if EAuth remembers the person.
   * "none" shows nothing: the result is a sign-in or, on the redirect, null.
   * "consent" shows the consent screen again.
   */
  prompt?: "login" | "none" | "consent";
  /** Prefills the address field on the sign-in page. */
  loginHint?: string;
  /** Requires a sign-in no older than this many seconds. */
  maxAge?: number;
  /**
   * The organisation to sign in for, by its ID or its slug, for
   * applications that use organisations. Without it, or empty, EAuth takes
   * the person's only organisation, or asks which one. A person who is not
   * a member is refused with access_denied.
   */
  organization?: string;
  /**
   * Where your application should go after the sign-in completes, returned
   * by ready() as returnTo. A path on your own origin; anything else is
   * ignored, so it cannot become an open redirect.
   */
  returnTo?: string;
  /**
   * Replace the current history entry instead of adding one. For sign-ins a
   * page starts by itself, such as a guard on page load: with a new entry,
   * Back would return to the page that sends the person to EAuth again.
   * Always on for prompt "none".
   */
  replace?: boolean;
}

export interface SignOutOptions {
  /** Forget the session here only, without revoking the refresh token at EAuth. */
  local?: boolean;
  /**
   * End the session at EAuth as well, so the next sign-in asks for the
   * password again. Navigates to EAuth and back to postLogoutRedirectUri.
   */
  endSession?: boolean;
}

interface Metadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
  jwks_uri: string;
  code_challenge_methods_supported?: string[];
  authorization_response_iss_parameter_supported?: boolean;
}

interface Pending {
  verifier: string;
  state: string;
  nonce: string;
  at: number;
  silent?: boolean;
  returnTo?: string;
  /** The page the sign-in was started from. */
  from?: string;
  /** For a silent attempt: how many before it never came back. */
  tries?: number;
  maxAge?: number;
  login?: boolean;
  /** The organisation asked for, by ID or slug. */
  org?: string;
  /** Started by restore, to continue this tab's session after a reload. */
  resume?: boolean;
}

interface Expectations {
  nonce?: string;
  /** The subject of the session a refresh continues. */
  sub?: string;
  maxAge?: number;
  /** For prompt=login: the sign-in must have happened after this, in milliseconds. */
  authAfter?: number;
  /** The organisation asked for, by ID or slug. */
  org?: string;
  /** For a refresh: the organisation's ID the session is in, null for none. */
  orgId?: string | null;
}

/** Every failure is an EAuthError with a code to branch on. */
export class EAuthError extends Error {
  readonly code: string;
  override readonly cause?: unknown;
  /**
   * Set when the error came with an answer from EAuth, which is removed
   * from the address all the same: the path to show, as in ReadyResult.
   * When the person declined (access_denied), the page the sign-in was
   * started from.
   */
  returnTo?: string;

  constructor(message: string, code = "eauth_error", cause?: unknown) {
    super(message);
    this.name = "EAuthError";
    this.code = code;
    this.cause = cause;
  }
}

const DEFAULT_ISSUER = "https://eauth.me";
const PENDING_KEY = "eauth:pending";
const REFRESH_KEY = "eauth:refresh";
/** Only a flag, never a token: this browser was signed in before. */
const HINT_KEY = "eauth:signed-in";
/**
 * Only a flag: the person signed out with signOut() and has not started a
 * sign-in since. EAuth may still hold their session, so a code that answers
 * another tab's sign-in is not followed by a silent one meanwhile.
 */
const SIGNED_OUT_KEY = "eauth:signed-out";
/** When the last sign-ins in this tab failed, to stop a redirect loop. */
const FAILURES_KEY = "eauth:failures";
/**
 * The organisation this tab is signed in to, by ID, so a reload continues in
 * it. Per tab: two tabs can be in two organisations.
 */
const ORG_KEY = "eauth:organization";

/** Refresh this long before expiry at most, so a request in flight never carries a token that dies mid-call. */
const REFRESH_MARGIN_MS = 60_000;
/** Assumed lifetime of an access token whose answer and claims name none. */
const DEFAULT_LIFETIME_S = 300;
/** A sign-in started more than this long ago is not completed. */
const PENDING_TTL_MS = 10 * 60_000;
/** Clock difference tolerated when checking an ID token's times. */
const CLOCK_SKEW_S = 120;
/** After this many failed sign-ins within the window, and none completed, another would be a loop. */
const LOOP_LIMIT = 3;
const LOOP_WINDOW_MS = 30_000;
/** A request to EAuth that has not answered by then is given up, so it cannot hold the other tabs. */
const REQUEST_TIMEOUT_MS = 30_000;

const RESPONSE_PARAMS = ["code", "state", "iss", "error", "error_description", "error_uri", "session_state"];
/** What a prompt=none answer says when EAuth does not know the person: not a failure. */
const NOBODY = ["login_required", "consent_required", "interaction_required", "account_selection_required"];
/** Refresh errors that mean the refresh token is dead. Anything else may pass. */
const DEAD_GRANT = ["invalid_grant", "invalid_client", "unauthorized_client"];

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

/**
 * Reads a JWT's claims without verifying its signature.
 *
 * That is correct here, and only here: the ID token comes straight from the
 * token endpoint over TLS in answer to this client's own request, which
 * OpenID Connect Core 3.1.3.7 accepts in place of a signature check. A token
 * from anywhere else must be verified against the JWKS on your server.
 */
export function decodeClaims(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new EAuthError("Malformed token", "invalid_token");
  try {
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error("not an object");
    return claims as Record<string, unknown>;
  } catch (err) {
    throw new EAuthError("Malformed token", "invalid_token", err);
  }
}

function browserOnly(what: string): void {
  if (typeof window === "undefined" || typeof location === "undefined") {
    throw new EAuthError(`${what} runs in the browser only.`, "not_in_browser");
  }
}

function storageGet(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

/** Whether the storage took the change. */
function storageSet(store: "local" | "session", key: string, value: string | null): boolean {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    // Storage refused (a private window, a sandboxed frame, a full quota).
    return false;
  }
}

/** The refresh token kept with storage "local", whose it is, and for which organisation. */
interface Stored {
  token: string;
  sub?: string;
  /** The organisation's ID, null for none; undefined when stored by an earlier version. */
  org?: string | null;
}

function readStored(): Stored | null {
  const raw = storageGet("local", REFRESH_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Stored> | null;
    if (value && typeof value.token === "string" && value.token !== "") {
      return {
        token: value.token,
        sub: typeof value.sub === "string" ? value.sub : undefined,
        org: typeof value.org === "string" || value.org === null ? value.org : undefined,
      };
    }
  } catch {
    // Not written by this package.
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An organisation reference as the ID the tokens carry, or undefined when it
 * is a slug. EAuth reads an ID in any of the usual forms: with hyphens, in
 * braces, as a URN, or as 32 hex digits, in either case.
 */
function organisationID(ref: string): string | undefined {
  let s = ref;
  if (s.length === 45 && s.startsWith("urn:uuid:")) s = s.slice(9);
  else if (s.length === 38 && s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1);
  s = s.toLowerCase();
  if (/^[0-9a-f]{32}$/.test(s)) {
    s = `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return UUID.test(s) ? s : undefined;
}

/** Whether an ID token is for the organisation a sign-in asked for, by ID or slug. */
function isOrganisation(claims: Record<string, unknown>, ref: string): boolean {
  const id = organisationID(ref);
  if (id !== undefined) return typeof claims.org_id === "string" && claims.org_id.toLowerCase() === id;
  return typeof claims.org_slug === "string" && claims.org_slug === ref.toLowerCase();
}

/** Whether two paths are the same page, whatever a server does with a trailing slash. */
function samePage(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/**
 * A path on this origin, or undefined. Only a path can come back out: a
 * value that names another origin, or a path that starts with two slashes
 * (which anything navigating with it reads as another host), is dropped.
 */
function sameOriginPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return undefined;
    const path = url.pathname + url.search + url.hash;
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

function currentPath(): string {
  return location.pathname + location.search + location.hash;
}

interface LockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export class EAuth {
  private readonly config: Required<Omit<EAuthConfig, "onChange" | "postLogoutRedirectUri">> &
    Pick<EAuthConfig, "onChange" | "postLogoutRedirectUri">;
  private metadata?: Promise<Metadata>;
  private tokens: EAuthTokens | null = null;
  private user: EAuthUser | null = null;
  /** When the access token is renewed; before expiresAt by a margin. */
  private renewAt = 0;
  private refreshing?: Promise<EAuthTokens>;
  private starting?: Promise<ReadyResult>;
  /** Counts sign-outs, so a refresh that finishes after one cannot bring the session back. */
  private epoch = 0;
  /** The path after an answer that was not for this tab was removed from the address. */
  private cleaned?: string;
  /** handleRedirect removed a code this tab did not ask for; see there. */
  private foreignCode = false;
  private expiry?: ReturnType<typeof setTimeout>;
  /** With storage "local": whether the refresh token held here is also in storage. */
  private persisted = false;
  private requestTimeout = REQUEST_TIMEOUT_MS;

  constructor(config: EAuthConfig) {
    if (!config.clientId) throw new EAuthError("clientId is required", "invalid_config");
    if (!config.redirectUri) throw new EAuthError("redirectUri is required", "invalid_config");
    let redirect: URL;
    try {
      redirect = new URL(config.redirectUri);
    } catch {
      throw new EAuthError("redirectUri must be an absolute URL.", "invalid_config");
    }
    if (redirect.protocol !== "https:" && redirect.protocol !== "http:") {
      throw new EAuthError("redirectUri must be http or https.", "invalid_config");
    }
    const storage = config.storage ?? "memory";
    if (storage !== "memory" && storage !== "local") {
      throw new EAuthError(`storage must be "memory" or "local", not "${String(storage)}".`, "invalid_config");
    }
    this.config = {
      ...config,
      issuer: (config.issuer ?? DEFAULT_ISSUER).replace(/\/+$/, ""),
      scope: config.scope ?? "openid profile email offline_access",
      storage,
      silentRestore: config.silentRestore ?? storage === "memory",
    };
  }

  /**
   * Gets the session going on a page load: completes a sign-in when the
   * address carries EAuth's answer, and otherwise continues one (restore).
   * Resolves to the user, or null, and to returnTo when an answer was
   * handled; see ReadyResult.
   *
   * Runs once per instance and hands every later caller the same promise,
   * so a framework that mounts twice, as React does in development, starts
   * one sign-in and not two racing each other. This is what the framework
   * packages call; call it yourself without one.
   */
  ready(): Promise<ReadyResult> {
    this.starting ??= (async () => {
      const answer = await this.handleRedirect();
      if (answer) return answer;
      const user = await this.restore();
      return this.cleaned === undefined ? { user } : { user, returnTo: this.cleaned };
    })();
    return this.starting;
  }

  /** The signed-in user, or null. Call ready first. */
  getUser(): EAuthUser | null {
    this.checkExpiry();
    return this.user;
  }

  /** Whether somebody is signed in. */
  isAuthenticated(): boolean {
    return this.getUser() !== null;
  }

  /**
   * A valid access token, renewed when it is close to expiry, or null when
   * nobody is signed in or the session cannot be continued. Starts ready()
   * in the browser when nothing has yet, and waits for it.
   */
  async getAccessToken(): Promise<string | null> {
    // A component may ask before the code that calls ready() has run, as
    // children's effects run before their parent's in React.
    if (!this.starting && typeof window !== "undefined" && typeof location !== "undefined") {
      void this.ready().catch(() => undefined);
    }
    if (this.starting) await this.starting.catch(() => undefined);
    const tokens = this.tokens;
    if (!tokens) return null;
    if (Date.now() < this.renewAt) return tokens.accessToken;
    if (!tokens.refreshToken) {
      // Nothing to renew it with: valid until it expires, then the session ends.
      if (Date.now() < tokens.expiresAt) return tokens.accessToken;
      this.expire();
      return null;
    }
    try {
      return (await this.refreshShared()).accessToken;
    } catch {
      // A refresh that failed for a passing reason keeps the session; the
      // current token is still good until it expires.
      const current = this.tokens;
      return current && Date.now() < current.expiresAt ? current.accessToken : null;
    }
  }

  /** Starts a sign-in by navigating to EAuth. */
  signIn(options: SignInOptions = {}): Promise<void> {
    return this.start(options, 0);
  }

  private async start(options: SignInOptions, tries: number, resume = false): Promise<void> {
    browserOnly("signIn");
    this.refuseLoop();
    const meta = await this.discover();

    const verifier = randomString(48);
    const challenge = base64url(await sha256(verifier));
    const state = randomString(16);
    const nonce = randomString(16);
    const silent = options.prompt === "none";
    // The person asks to sign in, so a code from it may be followed in
    // another tab again (see handleRedirect).
    if (!silent) storageSet("local", SIGNED_OUT_KEY, null);
    // An empty organisation asks for none, as it does at EAuth.
    const org = options.organization?.trim() || undefined;

    // The verifier has to survive a full-page navigation, so it cannot live
    // in memory. sessionStorage is the right scope: it dies with the tab,
    // and the value is worthless without the matching code.
    const pending: Pending = {
      verifier, state, nonce, at: Date.now(),
      silent,
      returnTo: sameOriginPath(options.returnTo),
      from: sameOriginPath(this.here()),
      tries: silent ? tries : undefined,
      maxAge: options.maxAge,
      login: options.prompt === "login",
      org,
      resume: resume || undefined,
    };
    if (!storageSet("session", PENDING_KEY, JSON.stringify(pending))) {
      // The answer could never be matched to this request, so every sign-in
      // would come back as a stranger's.
      throw new EAuthError(
        "This browser does not let the page keep a sign-in in progress (session storage is blocked).",
        "storage_unavailable",
      );
    }

    const url = new URL(meta.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", this.config.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (options.prompt) url.searchParams.set("prompt", options.prompt);
    if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);
    if (options.maxAge !== undefined) url.searchParams.set("max_age", String(options.maxAge));
    if (org) url.searchParams.set("organization", org);

    if (silent || options.replace) location.replace(url.toString());
    else location.assign(url.toString());
  }

  /**
   * Completes a sign-in on the redirect URI.
   *
   * Resolves to null when the address carries no answer for this tab, so it
   * is safe to call on every page load. An answer that does not belong to a
   * sign-in started in this tab (a reload of one already used, a link opened
   * in another tab, or somebody else's) is removed from the address and
   * otherwise ignored. When a silent sign-in (prompt "none") finds nobody
   * signed in, resolves with user null. Throws an EAuthError otherwise.
   */
  async handleRedirect(): Promise<ReadyResult | null> {
    browserOnly("handleRedirect");
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const error = params.get("error");
    const state = params.get("state");
    const pending = this.readPending();

    // Only the redirect URI receives answers. A "code" parameter anywhere
    // else belongs to the application, unless it answers this tab's own
    // sign-in: then something between EAuth and the application redirected
    // the answer, and signing in again would only end up here again.
    const target = new URL(this.config.redirectUri);
    if (location.origin !== target.origin || !samePage(location.pathname, target.pathname)) {
      if (pending && state === pending.state && (code || error)) {
        storageSet("session", PENDING_KEY, null);
        if (pending.silent) storageSet("local", HINT_KEY, null);
        this.cleanAddress();
        this.recordFailure();
        const failure = new EAuthError(
          `EAuth's answer arrived at ${location.origin}${location.pathname} instead of the redirect URI ${this.config.redirectUri}. Something redirects away from it.`,
          "redirect_mismatch",
        );
        failure.returnTo = pending.from ?? currentPath();
        throw failure;
      }
      return null;
    }
    if ((!code && !error) || state === null) return null;

    if (!pending || pending.state !== state) {
      // Not ours to redeem. Nothing in it is trusted, not even the error
      // text; it only leaves the address.
      this.cleanAddress();
      this.cleaned = currentPath();
      // A code from our issuer says the browser was signed in there a
      // moment ago, by a sign-in another tab started: a person who
      // registered in one tab and confirmed their address from the mail in
      // a new one lands here. restore() then tries one silent sign-in,
      // which completes it in this tab. Not after the person signed out
      // and before they started a sign-in again: EAuth may still hold the
      // session, and an old code, from a mail link clicked again or the
      // history, would sign them back in.
      const iss = params.get("iss");
      this.foreignCode =
        code !== null &&
        error === null &&
        (iss === null || iss === this.config.issuer) &&
        storageGet("local", SIGNED_OUT_KEY) === null;
      return null;
    }

    // The answer is spent whatever happens next. Taking it out of the
    // address first means a reload cannot try to redeem it again.
    storageSet("session", PENDING_KEY, null);
    this.cleanAddress();
    const returnTo = pending.returnTo ?? currentPath();

    try {
      const iss = params.get("iss");
      if (iss !== null && iss !== this.config.issuer) {
        // RFC 9207. Without it, somebody who controls a second authorization
        // server can make your application exchange a code at the wrong one.
        throw new EAuthError(`The answer came from ${iss}, expected ${this.config.issuer}.`, "issuer_mismatch");
      }
      if (error) {
        // A silent sign-in that found nobody is not a failure. Nor is a
        // reload that cannot continue in the tab's organisation any more:
        // the tab is signed out, and signing in again chooses anew.
        if (pending.silent && (NOBODY.includes(error) || (pending.resume && pending.org && error === "access_denied"))) {
          storageSet("local", HINT_KEY, null);
          storageSet("session", FAILURES_KEY, null);
          storageSet("session", ORG_KEY, null);
          return { user: null, returnTo };
        }
        throw new EAuthError(params.get("error_description") ?? "The sign-in was refused.", error);
      }
      if (Date.now() - pending.at > PENDING_TTL_MS) {
        throw new EAuthError("The sign-in took too long. Please start again.", "request_expired");
      }

      const meta = await this.discover();
      if (iss === null && meta.authorization_response_iss_parameter_supported) {
        throw new EAuthError("The answer does not name its issuer, which this server always does.", "issuer_mismatch");
      }
      const epoch = this.epoch;
      const tokens = await this.exchange(meta, code!, pending.verifier);
      if (!tokens.idToken) {
        throw new EAuthError("No ID token came back. The scope must include openid.", "invalid_token");
      }
      const claims = decodeClaims(tokens.idToken);
      this.checkIDToken(claims, meta, {
        nonce: pending.nonce,
        maxAge: pending.maxAge,
        authAfter: pending.login ? pending.at : undefined,
        org: pending.org,
      });
      if (epoch !== this.epoch) {
        // Signed out while the exchange was under way.
        void this.revoke(meta, tokens.refreshToken);
        return { user: null, returnTo };
      }
      this.setTokens(tokens, claims);
      storageSet("session", FAILURES_KEY, null);
      return { user: this.user, returnTo };
    } catch (err) {
      // A silent attempt that failed is not tried again on the next load.
      if (pending.silent) storageSet("local", HINT_KEY, null);
      const failure = err instanceof EAuthError ? err : new EAuthError("The sign-in failed.", "unknown", err);
      // A refusal counts too: EAuth can refuse without showing a page, and a
      // guard that ignores the error would ask again at once.
      this.recordFailure();
      // Declining leads back to where the person was, not to the page that
      // needed the sign-in.
      failure.returnTo = failure.code === "access_denied" ? (pending.from ?? returnTo) : returnTo;
      throw failure;
    }
  }

  /**
   * Continues a session after a page load.
   *
   * With storage "local", from the stored refresh token. With memory storage
   * and silentRestore, by a redirect through EAuth that shows nothing, when
   * this browser was signed in before: the promise then does not resolve,
   * because the page is navigating away, and handleRedirect completes it on
   * the way back. Resolves to null when there is nothing to continue.
   */
  async restore(): Promise<EAuthUser | null> {
    browserOnly("restore");
    if (this.user) return this.user;

    if (this.config.storage === "local") {
      const stored = readStored();
      if (!stored) return null;
      this.tokens = { accessToken: "", refreshToken: stored.token, expiresAt: 0, scope: this.config.scope };
      this.renewAt = 0;
      this.persisted = true;
      try {
        await this.refreshShared();
      } catch {
        // A dead token was removed by the refresh. A refresh that failed for
        // a passing reason, such as no network, keeps it: the next call to
        // getAccessToken tries again.
      }
      return this.user;
    }

    if (this.config.silentRestore && (storageGet("local", HINT_KEY) === "1" || this.foreignCode)) {
      // A silent attempt still pending never came back with its answer:
      // interrupted by a reload once, or lost to a redirect in front of the
      // application every time. The first gets one more try; after that,
      // one more would end the same way, over and over.
      const earlier = this.readPending();
      const unanswered = earlier?.silent && Date.now() - earlier.at < PENDING_TTL_MS;
      const tries = unanswered ? (earlier.tries ?? 0) + 1 : 0;
      if (tries > 1) {
        storageSet("local", HINT_KEY, null);
        storageSet("session", PENDING_KEY, null);
        throw new EAuthError(
          `The silent sign-in did not come back to the redirect URI ${this.config.redirectUri}. Something redirects away from it, or drops its query.`,
          "redirect_mismatch",
        );
      }
      // In the organisation this tab was in. Without it, EAuth would take
      // the one used last, perhaps in another tab.
      const organization = storageGet("session", ORG_KEY) ?? undefined;
      await this.start({ prompt: "none", returnTo: this.here(), organization }, tries, true);
      return new Promise<never>(() => {});
    }
    return null;
  }

  /**
   * Signs out. Revokes the refresh token at EAuth unless local is set, and
   * with endSession ends the EAuth session too, by navigating there and
   * back to postLogoutRedirectUri.
   */
  async signOut(options: SignOutOptions = {}): Promise<void> {
    const refreshToken = this.tokens?.refreshToken;
    const stored = this.config.storage === "local" ? readStored()?.token : undefined;
    const idToken = this.tokens?.idToken;
    this.signOutLocal();
    storageSet("local", SIGNED_OUT_KEY, "1");

    if (!options.local) {
      // Another tab may have rotated the stored token past the one held here.
      const tokens = [...new Set([refreshToken, stored].filter((t): t is string => !!t))];
      if (tokens.length > 0) {
        try {
          const meta = await this.discover();
          await Promise.all(tokens.map((t) => this.revoke(meta, t)));
        } catch {
          // Already signed out here. A failed revocation leaves the token
          // alive at EAuth until it expires; retrying would not make that better.
        }
      }
    }

    if (options.endSession) {
      browserOnly("signOut with endSession");
      const meta = await this.discover();
      if (!meta.end_session_endpoint) {
        throw new EAuthError("This server does not offer sign-out.", "end_session_unsupported");
      }
      const url = new URL(meta.end_session_endpoint);
      url.searchParams.set("client_id", this.config.clientId);
      url.searchParams.set("post_logout_redirect_uri", this.config.postLogoutRedirectUri ?? this.config.redirectUri);
      // With the ID token as proof, EAuth ends the session without asking
      // and sends the browser back. Without it, it asks the person first.
      if (idToken) url.searchParams.set("id_token_hint", idToken);
      location.assign(url.toString());
    }
  }

  /** The claims of the userinfo endpoint, fetched now. */
  async fetchUserInfo(): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    if (!token) throw new EAuthError("Nobody is signed in.", "not_authenticated");
    const meta = await this.discover();
    const response = await fetch(meta.userinfo_endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new EAuthError(`userinfo answered ${response.status}`, "userinfo_failed");
    }
    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * fetch with the access token attached. Only for your own API: it sends
   * the token with every request it makes.
   */
  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    // A Request carries its own headers; init.headers would replace them.
    const base = init.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(base);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }

  // --- internals ----------------------------------------------------------

  /**
   * The current path to return to. On the redirect URI without an answer
   * from EAuth in it: a router can write the address it started with back
   * after the answer was removed, and a spent answer must not be kept.
   * Anywhere else the query belongs to the application and stays whole.
   */
  private here(): string {
    const url = new URL(location.href);
    const target = new URL(this.config.redirectUri);
    if (url.origin === target.origin && samePage(url.pathname, target.pathname) && url.searchParams.has("state")) {
      for (const p of RESPONSE_PARAMS) url.searchParams.delete(p);
    }
    return url.pathname + url.search + url.hash;
  }

  private readPending(): Pending | null {
    const raw = storageGet("session", PENDING_KEY);
    if (!raw) return null;
    try {
      const pending = JSON.parse(raw) as Pending;
      return typeof pending?.state === "string" && typeof pending.verifier === "string" ? pending : null;
    } catch {
      return null;
    }
  }

  private failures(): number[] {
    try {
      const parsed: unknown = JSON.parse(storageGet("session", FAILURES_KEY) ?? "[]");
      const now = Date.now();
      return Array.isArray(parsed)
        ? parsed.filter((t): t is number => typeof t === "number" && now - t < LOOP_WINDOW_MS)
        : [];
    } catch {
      return [];
    }
  }

  private recordFailure(): void {
    storageSet("session", FAILURES_KEY, JSON.stringify([...this.failures(), Date.now()]));
  }

  /**
   * Refuses a sign-in after three answers within half a minute that failed
   * or refused, and none completed. That is a loop, for instance a guard
   * that starts a sign-in again whenever one fails, and redirecting again
   * would only repeat it. A person who goes back from EAuth and clicks
   * again brings no answer and is never refused.
   */
  private refuseLoop(): void {
    if (this.failures().length >= LOOP_LIMIT) {
      throw new EAuthError(
        "Sign-in failed several times in a row, so it was not started again.",
        "sign_in_loop",
      );
    }
  }

  private discover(): Promise<Metadata> {
    this.metadata ??= this.loadMetadata().catch((err: unknown) => {
      // A failed discovery is retried at the next call, not cached.
      this.metadata = undefined;
      throw err;
    });
    return this.metadata;
  }

  private async loadMetadata(): Promise<Metadata> {
    let response: Response;
    try {
      response = await fetch(`${this.config.issuer}/.well-known/openid-configuration`, { signal: this.timeout() });
    } catch (err) {
      // fetch says no more than that it failed: the network, or the browser
      // refusing to let this page read the answer (CORS) look the same here.
      throw new EAuthError(
        `EAuth could not be reached at ${this.config.issuer}, or the browser kept its answer from this page. Check the issuer.`,
        "discovery_failed",
        err,
      );
    }
    if (!response.ok) {
      throw new EAuthError(`Discovery answered ${response.status}. Check the issuer.`, "discovery_failed");
    }
    const meta = (await response.json()) as Metadata;
    // The document must describe the server we asked, or it describes a
    // server we do not trust.
    if (meta.issuer !== this.config.issuer) {
      throw new EAuthError(`Discovery names ${meta.issuer}, expected ${this.config.issuer}.`, "issuer_mismatch");
    }
    if (!meta.code_challenge_methods_supported?.includes("S256")) {
      throw new EAuthError("This server does not offer PKCE with S256, which this library requires.", "pkce_unsupported");
    }
    return meta;
  }

  /** OpenID Connect Core 3.1.3.7, and 12.2 for a refresh. */
  private checkIDToken(claims: Record<string, unknown>, meta: Metadata, expect: Expectations): void {
    const now = Date.now() / 1000;
    if (claims.iss !== meta.issuer) {
      throw new EAuthError("The ID token names another issuer.", "issuer_mismatch");
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.config.clientId)) {
      throw new EAuthError("The ID token was issued for another application.", "audience_mismatch");
    }
    if (claims.azp !== undefined ? claims.azp !== this.config.clientId : audiences.length > 1) {
      throw new EAuthError("The ID token was issued to another party.", "audience_mismatch");
    }
    if (typeof claims.sub !== "string" || claims.sub === "") {
      throw new EAuthError("The ID token names nobody.", "invalid_token");
    }
    if (typeof claims.exp !== "number") {
      throw new EAuthError("The ID token has no expiry.", "invalid_token");
    }
    if (claims.exp + CLOCK_SKEW_S < now) {
      throw new EAuthError("The ID token has expired. Check this device's clock.", "token_expired");
    }
    if (expect.nonce !== undefined && claims.nonce !== expect.nonce) {
      throw new EAuthError("nonce does not match. The ID token belongs to another sign-in.", "nonce_mismatch");
    }
    if (expect.sub !== undefined && claims.sub !== expect.sub) {
      throw new EAuthError("The refreshed ID token names somebody else.", "subject_mismatch");
    }
    if (expect.org !== undefined && !isOrganisation(claims, expect.org)) {
      throw new EAuthError(`The ID token is not for the organisation ${expect.org}.`, "organization_mismatch");
    }
    if (expect.orgId !== undefined && (typeof claims.org_id === "string" ? claims.org_id : null) !== expect.orgId) {
      throw new EAuthError("The refreshed ID token is for another organisation.", "organization_mismatch");
    }
    if (expect.maxAge !== undefined || expect.authAfter !== undefined) {
      const authTime = claims.auth_time;
      if (typeof authTime !== "number") {
        throw new EAuthError("The ID token does not say when the person signed in.", "stale_authentication");
      }
      if (expect.maxAge !== undefined && authTime + expect.maxAge + CLOCK_SKEW_S < now) {
        throw new EAuthError("The sign-in is older than maxAge allows.", "stale_authentication");
      }
      if (expect.authAfter !== undefined && authTime + CLOCK_SKEW_S < expect.authAfter / 1000) {
        throw new EAuthError("EAuth did not ask for the password again.", "stale_authentication");
      }
    }
  }

  private async exchange(meta: Metadata, code: string, verifier: string): Promise<EAuthTokens> {
    return this.tokenRequest(meta, {
      grant_type: "authorization_code",
      code,
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    }, "token_failed");
  }

  /** One refresh at a time in this page, and with storage "local" one at a time across the origin's tabs. */
  private refreshShared(): Promise<EAuthTokens> {
    this.refreshing ??= this.refreshInTurn().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refreshInTurn(): Promise<EAuthTokens> {
    const locks = typeof navigator !== "undefined" ? (navigator as { locks?: LockManager }).locks : undefined;
    if (this.config.storage === "local" && locks) {
      // Discovery first, outside the lock, so a slow one holds no other tab.
      await this.discover();
      // Every tab holds the same refresh token, and rotation makes a second
      // use of it look like theft. Under the lock each tab reads the token
      // the previous one stored before it presents one.
      return locks.request(`eauth:refresh:${this.config.clientId}`, () => this.refresh());
    }
    return this.refresh();
  }

  private async refresh(): Promise<EAuthTokens> {
    if (this.config.storage === "local" && this.tokens) {
      const stored = readStored();
      if (!stored) {
        if (this.persisted) {
          // Signed out in another tab.
          this.signOutLocal();
          throw new EAuthError("Signed out in another tab.", "not_authenticated");
        }
        // Storage refused the token when it was issued: the one held here
        // is the only copy.
      } else if (this.user && stored.sub !== undefined && stored.sub !== this.user.sub) {
        // Another tab signed in as somebody else. That token is not this
        // session's to present, and this session is over.
        this.signOutLocal(this.tokens.refreshToken ?? "");
        throw new EAuthError("Signed in as somebody else in another tab.", "not_authenticated");
      } else if (this.user && stored.org !== undefined && stored.org !== (this.user.organization?.id ?? null)) {
        // Another tab signed in to another organisation, and the origin
        // keeps one refresh token. Presenting it here would switch this tab
        // to that organisation, and refusing the answer would sign the
        // other tab out; this tab's session ends instead.
        this.signOutLocal(this.tokens.refreshToken ?? "");
        throw new EAuthError("Signed in to another organisation in another tab.", "not_authenticated");
      } else {
        // Possibly rotated by another tab since this one last renewed.
        this.tokens.refreshToken = stored.token;
        this.persisted = true;
      }
    }
    const presented = this.tokens?.refreshToken;
    if (!presented) throw new EAuthError("There is no refresh token.", "not_authenticated");
    const epoch = this.epoch;
    const meta = await this.discover();

    let tokens: EAuthTokens;
    try {
      tokens = await this.tokenRequest(meta, {
        grant_type: "refresh_token",
        refresh_token: presented,
        client_id: this.config.clientId,
      }, "refresh_failed");
    } catch (err) {
      if (err instanceof EAuthError && DEAD_GRANT.includes(err.code) && epoch === this.epoch) {
        // Revoked, expired or already used: the session is over.
        this.signOutLocal(presented);
      }
      throw err;
    }
    // Rotation: the answer carries a new refresh token and the old one is
    // dead. Keeping the old one would make the next refresh look like reuse.
    tokens.refreshToken ??= presented;

    if (epoch !== this.epoch) {
      // Signed out while this was under way: the new token must not bring
      // the session back, and is handed back to EAuth.
      if (tokens.refreshToken !== presented) void this.revoke(meta, tokens.refreshToken);
      throw new EAuthError("Signed out during the refresh.", "not_authenticated");
    }
    if (this.config.storage === "local" && this.persisted && readStored()?.token !== presented) {
      // Another tab signed out, or in, while this was under way; sign-outs
      // and sign-ins do not wait for the lock. Their word counts: the new
      // token goes back, and this tab's session ends.
      if (tokens.refreshToken !== presented) void this.revoke(meta, tokens.refreshToken);
      this.signOutLocal(presented);
      throw new EAuthError("Signed out in another tab.", "not_authenticated");
    }

    let claims: Record<string, unknown> | undefined;
    if (tokens.idToken) {
      try {
        claims = decodeClaims(tokens.idToken);
        this.checkIDToken(claims, meta, {
          sub: this.user?.sub,
          // A refresh continues in the organisation the session is in.
          orgId: this.user ? (this.user.organization?.id ?? null) : undefined,
        });
      } catch (err) {
        // Not an answer for this session. The new token goes back, and the
        // session ends here.
        void this.revoke(meta, tokens.refreshToken);
        this.signOutLocal();
        throw err;
      }
    } else if (!this.user) {
      // A restore needs to know who signed in, and only the ID token says.
      void this.revoke(meta, tokens.refreshToken);
      this.signOutLocal();
      throw new EAuthError("No ID token came back. The scope must include openid.", "invalid_token");
    }
    this.setTokens(tokens, claims);
    return tokens;
  }

  /** Gives a request up after a while, so a hung one cannot hold the other tabs. */
  private timeout(): AbortSignal | undefined {
    return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(this.requestTimeout)
      : undefined;
  }

  private async tokenRequest(meta: Metadata, body: Record<string, string>, code: string): Promise<EAuthTokens> {
    let response: Response;
    try {
      response = await fetch(meta.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
        signal: this.timeout(),
      });
    } catch (err) {
      // The token endpoint lets a page read its answer only on the origin of
      // one of the application's redirect URIs; elsewhere the browser hides
      // it, and fetch reports that as a network failure.
      throw new EAuthError(
        `EAuth could not be reached, or the browser kept its answer from this page: the token endpoint answers a page only on the origin of one of the application's redirect URIs, and ${typeof location === "undefined" ? "this page's origin" : location.origin} may not be one.`,
        code,
        err,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new EAuthError(
        typeof payload.error_description === "string" ? payload.error_description : "The token request was refused.",
        typeof payload.error === "string" ? payload.error : code,
      );
    }
    if (typeof payload.access_token !== "string" || payload.access_token === "") {
      throw new EAuthError("The answer carries no access token.", code);
    }
    return {
      accessToken: payload.access_token,
      idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
      refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
      expiresAt: Date.now() + lifetime(payload.expires_in, payload.access_token) * 1000,
      scope: typeof payload.scope === "string" ? payload.scope : this.config.scope,
    };
  }

  private setTokens(tokens: EAuthTokens, claims?: Record<string, unknown>): void {
    this.tokens = tokens;
    // Renew a minute before expiry, or halfway through a shorter lifetime.
    const remaining = Math.max(0, tokens.expiresAt - Date.now());
    this.renewAt = tokens.expiresAt - Math.min(REFRESH_MARGIN_MS, remaining / 2);
    if (claims) this.user = toUser(claims);
    const org = this.user?.organization?.id ?? null;
    if (this.config.storage === "local" && tokens.refreshToken) {
      this.persisted = storageSet("local", REFRESH_KEY, JSON.stringify({ token: tokens.refreshToken, sub: this.user?.sub, org }));
    }
    storageSet("session", ORG_KEY, org);
    storageSet("local", HINT_KEY, "1");
    this.scheduleExpiry();
    this.config.onChange?.(this.user);
  }

  /** Without a refresh token the session ends with the access token; this makes that visible when it happens. */
  private scheduleExpiry(): void {
    if (this.expiry !== undefined) clearTimeout(this.expiry);
    this.expiry = undefined;
    const tokens = this.tokens;
    if (!tokens || tokens.refreshToken || typeof setTimeout === "undefined") return;
    const wait = Math.min(Math.max(0, tokens.expiresAt - Date.now()), 2_147_483_647);
    this.expiry = setTimeout(() => this.checkExpiry(), wait);
    // In Node a pending timer would keep the process alive.
    (this.expiry as { unref?: () => void }).unref?.();
  }

  private checkExpiry(): void {
    const tokens = this.tokens;
    if (tokens && !tokens.refreshToken && this.user && Date.now() >= tokens.expiresAt) this.expire();
  }

  /**
   * The access token has run out and nothing can renew it. The session here
   * ends; the hint stays, so the next page load continues it silently when
   * EAuth still knows the person.
   */
  private expire(): void {
    const had = this.user !== null;
    this.epoch++;
    this.tokens = null;
    this.user = null;
    this.renewAt = 0;
    if (this.expiry !== undefined) clearTimeout(this.expiry);
    this.expiry = undefined;
    if (had) this.config.onChange?.(null);
  }

  /**
   * Forgets the session here. With `presented`, the stored refresh token is
   * only removed when it is that one: another tab may have stored a newer one.
   */
  private signOutLocal(presented?: string): void {
    const had = this.user !== null || this.tokens !== null;
    this.epoch++;
    this.tokens = null;
    this.user = null;
    this.renewAt = 0;
    if (this.expiry !== undefined) clearTimeout(this.expiry);
    this.expiry = undefined;
    if (presented === undefined || readStored()?.token === presented) {
      storageSet("local", REFRESH_KEY, null);
    }
    this.persisted = false;
    storageSet("local", HINT_KEY, null);
    storageSet("session", PENDING_KEY, null);
    storageSet("session", ORG_KEY, null);
    if (had) this.config.onChange?.(null);
  }

  private async revoke(meta: Metadata, token: string | undefined): Promise<void> {
    if (!token || !meta.revocation_endpoint) return;
    try {
      await fetch(meta.revocation_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: "refresh_token", client_id: this.config.clientId }),
      });
    } catch {
      // Best effort: the token dies at EAuth when it expires.
    }
  }

  private cleanAddress(): void {
    const url = new URL(location.href);
    for (const p of RESPONSE_PARAMS) url.searchParams.delete(p);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
}

/** Seconds an access token lives: expires_in, else its own exp claim, else a cautious default. */
function lifetime(expiresIn: unknown, accessToken: string): number {
  const given = typeof expiresIn === "string" ? Number(expiresIn) : expiresIn;
  if (typeof given === "number" && Number.isFinite(given) && given > 0) return given;
  try {
    const exp = decodeClaims(accessToken).exp;
    if (typeof exp === "number") return Math.max(0, exp - Date.now() / 1000);
  } catch {
    // An opaque token.
  }
  return DEFAULT_LIFETIME_S;
}

function toUser(claims: Record<string, unknown>): EAuthUser {
  return {
    sub: String(claims.sub),
    name: typeof claims.name === "string" ? claims.name : undefined,
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined,
    organization: toOrganization(claims),
    claims,
  };
}

function toOrganization(claims: Record<string, unknown>): EAuthOrganization | undefined {
  if (typeof claims.org_id !== "string" || claims.org_id === "") return undefined;
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    id: claims.org_id,
    slug: text(claims.org_slug),
    name: text(claims.org_name),
    role: text(claims.org_role),
    permissions: Array.isArray(claims.org_permissions)
      ? claims.org_permissions.filter((p): p is string => typeof p === "string")
      : [],
  };
}

/** Same as new EAuth(config). */
export function createEAuth(config: EAuthConfig): EAuth {
  return new EAuth(config);
}
