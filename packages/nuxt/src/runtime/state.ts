import { useState } from "#imports";
import type { EAuthError, EAuthUser } from "@elchi-studios/eauth";

/** The shared auth state, one per request on the server and one per page in the browser. */
export function useEAuthState() {
  return {
    user: useState<EAuthUser | null>("eauth:user", () => null),
    loading: useState<boolean>("eauth:loading", () => true),
    error: useState<EAuthError | null>("eauth:error", () => null),
  };
}
