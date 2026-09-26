import { abortNavigation, defineNuxtRouteMiddleware, useNuxtApp, useRuntimeConfig } from "#imports";
import { EAuthError } from "@elchi-studios/eauth";
import { browserPath } from "./paths.js";
import { useEAuthState } from "./state.js";

/** Fails the navigation with the error page, which says why. */
function refuse(err: unknown) {
  const message = err instanceof Error ? err.message : "The sign-in failed.";
  return abortNavigation({ statusCode: 401, statusMessage: "Sign-in failed", message, fatal: true });
}

/**
 * Requires somebody signed in: `definePageMeta({ middleware: "eauth" })`.
 *
 * Waits for the page load's sign-in or restore before deciding, because
 * deciding earlier sends somebody who is signed in to EAuth on every
 * reload. When that sign-in failed, the navigation fails with the reason
 * instead of starting another sign-in, which would most likely fail the
 * same way and redirect again and again. On the server it lets the page
 * through; the browser decides.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return;
  const nuxtApp = useNuxtApp();
  const auth = nuxtApp.$eauth;
  if (!auth) {
    return refuse(useEAuthState().error.value ?? new EAuthError("EAuth is not configured; see the console.", "invalid_config"));
  }
  try {
    await auth.ready();
  } catch (err) {
    return refuse(err);
  }
  if (auth.isAuthenticated()) return;
  try {
    await auth.signIn({
      returnTo: browserPath(to.fullPath, useRuntimeConfig().app.baseURL),
      // On the page load itself the entry is replaced, so Back does not
      // return to a page that sends the person to EAuth again.
      replace: nuxtApp.isHydrating === true,
    });
  } catch (err) {
    return refuse(err);
  }
  return abortNavigation();
});
