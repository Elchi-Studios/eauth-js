/**
 * @elchi-studios/eauth-react: EAuth for React.
 *
 * One provider at the root, one hook anywhere below it:
 *
 *   <EAuthProvider clientId="eauth_pub_..." redirectUri={location.origin + "/"}>
 *     <App />
 *   </EAuthProvider>
 *
 *   const { user, signIn, signOut } = useEAuth();
 *
 * The core package does the protocol; this one only bridges it to React
 * state. Works with React 18 and 19, in StrictMode too: the provider starts
 * one sign-in however often React mounts it.
 *
 * The directive below marks the module as client code for frameworks with
 * server components, such as the Next.js App Router, so the provider can be
 * used straight from a server layout. Other bundlers ignore it.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  EAuth,
  EAuthError,
  type EAuthConfig,
  type EAuthUser,
  type ReadyResult,
  type SignInOptions,
  type SignOutOptions,
} from "@elchi-studios/eauth";

export { EAuth, EAuthError };
export type { EAuthConfig, EAuthUser, ReadyResult, SignInOptions, SignOutOptions };

export interface EAuthContextValue {
  /** The signed-in user, or null. */
  user: EAuthUser | null;
  /** True until the page load's sign-in or restore has finished. */
  loading: boolean;
  /** What went wrong with the last sign-in, if anything. */
  error: EAuthError | null;
  signIn: (options?: SignInOptions) => Promise<void>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  /** A valid access token for your own API, or null. */
  getAccessToken: () => Promise<string | null>;
  /** fetch with the access token attached. Only for your own API. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** The client, for anything the context does not expose. */
  client: EAuth;
}

const Context = createContext<EAuthContextValue | null>(null);

export interface EAuthProviderProps extends Omit<EAuthConfig, "onChange"> {
  children?: ReactNode;
  /** Shown instead of children while the session is being established. */
  fallback?: ReactNode;
  /**
   * Called when a page load handled an answer from EAuth, with the path to
   * show: where the sign-in was started, or the current page without the
   * answer. The default replaces the address and tells the router with a
   * popstate event, which React Router and most others follow. Pass your
   * router's navigation for anything else.
   */
  onReturn?: (returnTo: string) => void;
}

function defaultReturn(returnTo: string): void {
  if (returnTo !== location.pathname + location.search + location.hash) {
    history.replaceState(history.state, "", returnTo);
  }
  // Routers read the address when they start, which may have been before
  // EAuth's answer was removed from it. A popstate event makes them read it
  // again.
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

export function EAuthProvider({ children, fallback, onReturn, ...config }: EAuthProviderProps) {
  const [user, setUser] = useState<EAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EAuthError | null>(null);

  // One client for the provider's life. A new one on every render would
  // forget the tokens it holds in memory and sign the person out. The
  // configuration is read once, at the first render.
  const [client] = useState(() => new EAuth({ ...config, onChange: setUser }));

  useEffect(() => {
    let cancelled = false;
    client.ready().then(
      (result) => {
        if (cancelled) return;
        setUser(client.getUser());
        setLoading(false);
        if (result.returnTo !== undefined) (onReturn ?? defaultReturn)(result.returnTo);
      },
      (err: unknown) => {
        if (cancelled) return;
        const failure = err instanceof EAuthError ? err : new EAuthError("The sign-in failed.", "unknown", err);
        setError(failure);
        setLoading(false);
        if (failure.returnTo !== undefined) (onReturn ?? defaultReturn)(failure.returnTo);
      },
    );
    return () => {
      cancelled = true;
    };
    // onReturn is read when the sign-in completes, once; a new function on
    // every render must not start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const signIn = useCallback(
    (options?: SignInOptions) => {
      setError(null);
      return client.signIn(options).catch((err: unknown) => {
        // A sign-in that could not start (a loop, blocked storage) says why.
        setError(err instanceof EAuthError ? err : new EAuthError("The sign-in could not start.", "unknown", err));
        throw err;
      });
    },
    [client],
  );
  const signOut = useCallback((options?: SignOutOptions) => client.signOut(options), [client]);
  const getAccessToken = useCallback(() => client.getAccessToken(), [client]);
  const authFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => client.fetch(input, init),
    [client],
  );

  const value = useMemo<EAuthContextValue>(
    () => ({ user, loading, error, signIn, signOut, getAccessToken, fetch: authFetch, client }),
    [user, loading, error, signIn, signOut, getAccessToken, authFetch, client],
  );

  return <Context.Provider value={value}>{loading && fallback !== undefined ? fallback : children}</Context.Provider>;
}

/** The auth state and actions. Must be used below EAuthProvider. */
export function useEAuth(): EAuthContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useEAuth must be used inside <EAuthProvider>.");
  return value;
}

/** Renders its children only when somebody is signed in. */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user, loading } = useEAuth();
  return !loading && user ? <>{children}</> : null;
}

/** Renders its children only when nobody is signed in. */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, loading } = useEAuth();
  return !loading && !user ? <>{children}</> : null;
}

/**
 * Sends the person to the sign-in page.
 *
 * A button and not a link: the address is built at click time from a fresh
 * PKCE pair, so there is no URL for an href that would still be valid when
 * clicked.
 */
export function SignInButton({
  children = "Sign in",
  className,
  ...options
}: SignInOptions & { children?: ReactNode; className?: string }) {
  const { signIn } = useEAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        signIn(options).catch(() => setBusy(false));
      }}
    >
      {children}
    </button>
  );
}

/** Signs out; with endSession at EAuth too. */
export function SignOutButton({
  children = "Sign out",
  className,
  ...options
}: SignOutOptions & { children?: ReactNode; className?: string }) {
  const { signOut } = useEAuth();
  return (
    <button type="button" className={className} onClick={() => void signOut(options)}>
      {children}
    </button>
  );
}
