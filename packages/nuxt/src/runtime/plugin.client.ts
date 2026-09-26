import { defineNuxtPlugin, navigateTo, useRuntimeConfig } from "#imports";
import { EAuth, EAuthError, type EAuthConfig } from "@elchi-studios/eauth";
import { routerPath } from "./paths.js";
import { useEAuthState } from "./state.js";

function asError(err: unknown): EAuthError {
  return err instanceof EAuthError ? err : new EAuthError("The sign-in failed.", "unknown", err);
}

// Creates the client in the browser and gets the session going. The
// plugin does not wait for it: the page renders at once, loading, and
// updates when the sign-in or restore has finished.
export default defineNuxtPlugin((nuxtApp) => {
  const runtime = useRuntimeConfig();
  const baseURL = runtime.app.baseURL;
  const options = (runtime.public.eauth ?? {}) as Record<string, unknown>;
  const { user, loading, error } = useEAuthState();

  // The state changes only once the page has hydrated. The server rendered
  // "loading"; a different value before hydration ends makes Vue throw the
  // server's markup away and warn about a mismatch.
  const hydrated = nuxtApp.isHydrating
    ? new Promise<void>((resolve) => nuxtApp.hooks.hookOnce("app:suspense:resolve", () => resolve()))
    : Promise.resolve();
  let live = false;

  // The router still holds the address as it was when the page loaded,
  // with EAuth's answer in it, and would write it back. Navigating to the
  // path the core hands over replaces it.
  const settle = (path: string | undefined) =>
    path === undefined
      ? undefined
      : nuxtApp.runWithContext(() => navigateTo(routerPath(path, baseURL), { replace: true }));

  // Runtime config cannot hold undefined, so unset options arrive as "".
  const text = (key: string): string | undefined =>
    typeof options[key] === "string" && options[key] !== "" ? (options[key] as string) : undefined;

  let auth: EAuth;
  try {
    auth = new EAuth({
      clientId: text("clientId") ?? "",
      redirectUri: text("redirectUri") ?? location.origin + baseURL,
      postLogoutRedirectUri: text("postLogoutRedirectUri"),
      issuer: text("issuer"),
      scope: text("scope"),
      storage: text("storage") as EAuthConfig["storage"],
      silentRestore: typeof options.silentRestore === "boolean" ? options.silentRestore : undefined,
      onChange: (value) => {
        if (live) user.value = value;
      },
    });
  } catch (err) {
    // A missing client ID should say so on the page, not stop the application.
    console.error(err);
    void hydrated.then(() => {
      error.value = asError(err);
      loading.value = false;
    });
    return;
  }
  nuxtApp.provide("eauth", auth);

  auth.ready().then(
    async (result) => {
      await hydrated;
      live = true;
      user.value = auth.getUser();
      loading.value = false;
      await settle(result.returnTo);
    },
    async (err: unknown) => {
      await hydrated;
      live = true;
      const failure = asError(err);
      error.value = failure;
      loading.value = false;
      await settle(failure.returnTo);
    },
  );
});
