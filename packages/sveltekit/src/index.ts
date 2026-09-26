/**
 * @elchi-studios/eauth-sveltekit: EAuth for Svelte and SvelteKit.
 *
 * A store of the auth state and the actions to change it. SvelteKit renders
 * on the server too, so nothing here touches a browser API until the store
 * is subscribed to in the browser. Works with Svelte 4 and 5; the store
 * contract is the same in both.
 *
 *   // src/lib/auth.ts
 *   export const auth = createAuth({ clientId: "eauth_pub_...", redirectUri: "https://app.example/" });
 *
 *   <!-- any component -->
 *   {#if $auth.user}Hello {$auth.user.name}{:else}<button onclick={() => auth.signIn()}>Sign in</button>{/if}
 */

import { readable, type Readable } from "svelte/store";
import {
  EAuth,
  EAuthError,
  type EAuthConfig,
  type EAuthOrganization,
  type EAuthUser,
  type ReadyResult,
  type SignInOptions,
  type SignOutOptions,
} from "@elchi-studios/eauth";

export { EAuth, EAuthError };
export type { EAuthConfig, EAuthOrganization, EAuthUser, ReadyResult, SignInOptions, SignOutOptions };

export interface AuthState {
  /** The signed-in user, or null. */
  user: EAuthUser | null;
  /** True until the page load's sign-in or restore has finished; stays true during server rendering. */
  loading: boolean;
  /** What went wrong with the last sign-in, if anything. */
  error: EAuthError | null;
}

export interface AuthStore extends Readable<AuthState> {
  signIn: (options?: SignInOptions) => Promise<void>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  /** A valid access token for your own API, or null. */
  getAccessToken: () => Promise<string | null>;
  /** fetch with the access token attached. Only for your own API. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** The client, created in the browser at the first use; null on the server. */
  readonly client: EAuth | null;
}

export interface CreateAuthOptions extends Omit<EAuthConfig, "onChange"> {
  /**
   * Called when a page load handled an answer from EAuth, with the path to
   * show: where the sign-in was started, or the current page without the
   * answer. Pass SvelteKit's goto, so the router follows:
   * `onReturn: (path) => goto(path, { replaceState: true })`.
   */
  onReturn?: (returnTo: string) => void;
}

/**
 * Creates the auth store. Call it once, in a module, and import the result
 * wherever it is needed; a module is evaluated once per page, so the tokens
 * the client holds in memory survive navigation.
 */
export function createAuth(options: CreateAuthOptions): AuthStore {
  const { onReturn, ...config } = options;
  let client: EAuth | null = null;
  let push: ((state: AuthState) => void) | null = null;
  let current: AuthState = { user: null, loading: true, error: null };

  const set = (state: AuthState) => {
    current = state;
    push?.(state);
  };

  const ensure = (): EAuth => {
    if (typeof window === "undefined") {
      throw new EAuthError("EAuth runs in the browser only.", "not_in_browser");
    }
    if (!client) {
      client = new EAuth({ ...config, onChange: (user) => set({ ...current, user }) });
      client.ready().then(
        (result) => {
          set({ user: client!.getUser(), loading: false, error: null });
          if (result.returnTo !== undefined && onReturn) onReturn(result.returnTo);
        },
        (err: unknown) => {
          const failure = err instanceof EAuthError ? err : new EAuthError("The sign-in failed.", "unknown", err);
          set({ user: null, loading: false, error: failure });
          if (failure.returnTo !== undefined && onReturn) onReturn(failure.returnTo);
        },
      );
    }
    return client;
  };

  const store = readable<AuthState>(current, (update) => {
    push = update;
    update(current);
    if (typeof window !== "undefined") ensure();
    return () => {
      push = null;
    };
  });

  return {
    subscribe: store.subscribe,
    signIn: (o) =>
      ensure()
        .signIn(o)
        .catch((err: unknown) => {
          // A sign-in that could not start (a loop, blocked storage) says why.
          set({ ...current, error: err instanceof EAuthError ? err : new EAuthError("The sign-in could not start.", "unknown", err) });
          throw err;
        }),
    signOut: (o) => ensure().signOut(o),
    getAccessToken: () => (typeof window === "undefined" ? Promise.resolve(null) : ensure().getAccessToken()),
    fetch: (input, init) => ensure().fetch(input, init),
    get client() {
      return client;
    },
  };
}
