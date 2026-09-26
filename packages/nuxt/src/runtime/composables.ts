import { useNuxtApp } from "#imports";
import { EAuthError, type EAuth, type SignInOptions, type SignOutOptions } from "@elchi-studios/eauth";
import { useEAuthState } from "./state.js";

/**
 * The auth state and actions, in any component or composable.
 *
 * user, loading and error are refs. The actions need the browser: on the
 * server getAccessToken resolves to null and the others throw.
 */
export function useEAuth() {
  const nuxtApp = useNuxtApp();
  const state = useEAuthState();
  const client = (): EAuth => {
    if (nuxtApp.$eauth) return nuxtApp.$eauth;
    // In the browser the only reason for no client is a configuration the
    // plugin refused, and that reason is more useful than a generic one.
    if (import.meta.client && state.error.value) throw state.error.value;
    throw new EAuthError("EAuth runs in the browser only.", "not_in_browser");
  };
  return {
    ...state,
    signIn: (options?: SignInOptions) =>
      client()
        .signIn(options)
        .catch((err: unknown) => {
          // A sign-in that could not start (a loop, blocked storage) says why.
          state.error.value = err instanceof EAuthError ? err : new EAuthError("The sign-in could not start.", "unknown", err);
          throw err;
        }),
    signOut: (options?: SignOutOptions) => client().signOut(options),
    getAccessToken: () => (import.meta.client ? client().getAccessToken() : Promise.resolve(null)),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => client().fetch(input, init),
  };
}
