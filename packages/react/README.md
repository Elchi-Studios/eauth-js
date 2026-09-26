# @elchi-studios/eauth-react

Sign in with [EAuth](https://eauth.me) in React 18 and 19. One provider, one
hook, and components for the common cases. The protocol is done by
[`@elchi-studios/eauth`](https://www.npmjs.com/package/@elchi-studios/eauth); this package
connects it to React state.

## Install

```bash
npm install @elchi-studios/eauth-react
```

Create the application at [panel.elchi.dev](https://panel.elchi.dev) as a
**public** client and register the redirect URI exactly as you pass it,
trailing slash included. The package asks for `offline_access`, so a
session outlives the 15 minutes of an access token; new applications may
have it.

## Use

```tsx
import { EAuthProvider, SignedIn, SignedOut, SignInButton, useEAuth } from "@elchi-studios/eauth-react";

export default function App() {
  return (
    <EAuthProvider clientId="eauth_pub_..." redirectUri={location.origin + "/"}>
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <Profile />
      </SignedIn>
    </EAuthProvider>
  );
}

function Profile() {
  const { user, signOut } = useEAuth();
  return (
    <>
      <p>Hello {user?.name}</p>
      <button onClick={() => signOut()}>Sign out</button>
    </>
  );
}
```

The provider completes the sign-in when EAuth sends the browser back,
continues the session after a reload, and takes the person back to the page
they started on. It does this once, also under StrictMode.

## Calling your own API

```tsx
const { fetch } = useEAuth();
const response = await fetch("/api/orders");
```

`fetch` attaches the access token, which is renewed shortly before it
expires. For another HTTP client, `await getAccessToken()` gives the token
itself, or `null` when nobody is signed in. Only send it to your own API.

## Pages that need somebody signed in

```tsx
import { useEffect, type ReactNode } from "react";
import { useEAuth } from "@elchi-studios/eauth-react";

function RequireSignIn({ children }: { children: ReactNode }) {
  const { user, loading, error, signIn } = useEAuth();
  useEffect(() => {
    if (!loading && !user && !error) {
      void signIn({ returnTo: location.pathname + location.search, replace: true });
    }
  }, [loading, user, error, signIn]);
  if (error) return <p>The sign-in failed: {error.message}</p>;
  return user ? <>{children}</> : null;
}
```

Wait for `loading` to turn false before deciding: deciding earlier sends a
person who is signed in to EAuth on every reload. When the sign-in failed,
show `error` instead of starting another one, which would most likely fail
the same way and redirect again and again. `replace: true` keeps Back from
returning to a page that redirects again.

A guard in the browser decides what is shown, not what can be read. Keep
data behind your API, which checks the access token.

## Provider props

Every option of the core (`clientId`, `redirectUri`, `postLogoutRedirectUri`,
`issuer`, `scope`, `storage`, `silentRestore`; see the
[core README](https://www.npmjs.com/package/@elchi-studios/eauth#configuration)),
read once when the provider first renders, and:

| Prop | |
|---|---|
| `fallback` | Rendered instead of the children while the session is being established. |
| `onReturn` | Called when the page load handled an answer from EAuth, with the path to show: where the sign-in started, or the current page without the answer. The default replaces the address and fires `popstate`, which React Router and most other routers follow. Pass your router's navigation for anything else. |

## useEAuth()

| Field | |
|---|---|
| `user` | The signed-in user or `null`: `sub`, `name`, `email`, `emailVerified`, `orgId`, `claims`. |
| `loading` | `true` until the page load's sign-in or restore has finished. |
| `error` | An `EAuthError` from the last sign-in, or `null`. `error.code` says what happened. |
| `signIn(options)` | Goes to EAuth. Options: `prompt`, `loginHint`, `maxAge`, `returnTo`, `replace`. |
| `signOut(options)` | `{ endSession: true }` signs out at EAuth too. |
| `getAccessToken()` | A valid access token, or `null`. |
| `fetch(input, init)` | `fetch` with the access token attached. |
| `client` | The underlying `EAuth` instance. |

## Components

| Component | |
|---|---|
| `<SignedIn>` | Renders its children only when somebody is signed in. |
| `<SignedOut>` | Renders its children only when nobody is signed in. |
| `<SignInButton>` | A button that starts a sign-in. Takes the sign-in options as props, and `className`. |
| `<SignOutButton>` | A button that signs out. Takes `endSession`, `local` and `className`. |

Both conditional components render nothing while `loading` is true, so the
page does not flash the wrong state.

## Next.js

The package is marked as client code, so its components can be used from
server components. During server rendering nobody is signed in and
`loading` is true; the browser takes over after hydration.

With the App Router, wrap the provider in a client component of your own, so
it can hand the router to `onReturn` and read the configuration from the
environment (`location` does not exist on the server):

```tsx
// app/auth.tsx
"use client";

import { useRouter } from "next/navigation";
import { EAuthProvider } from "@elchi-studios/eauth-react";

export function Auth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <EAuthProvider
      clientId={process.env.NEXT_PUBLIC_EAUTH_CLIENT_ID!}
      redirectUri={process.env.NEXT_PUBLIC_EAUTH_REDIRECT_URI!}
      onReturn={(path) => router.replace(path)}
    >
      {children}
    </EAuthProvider>
  );
}
```

Then put `<Auth>` around `{children}` in `app/layout.tsx`.

## License

MIT. Made by [Elchi Studios](https://elchi.dev).
