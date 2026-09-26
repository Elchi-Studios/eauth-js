<div align="center">

```
███████╗ █████╗ ██╗   ██╗████████╗██╗  ██╗
██╔════╝██╔══██╗██║   ██║╚══██╔══╝██║  ██║
█████╗  ███████║██║   ██║   ██║   ███████║
██╔══╝  ██╔══██║██║   ██║   ██║   ██╔══██║
███████╗██║  ██║╚██████╔╝   ██║   ██║  ██║
╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝
```

**Sign in with EAuth, from any web page**

[![CI](https://github.com/Elchi-Studios/eauth-js/actions/workflows/ci.yml/badge.svg)](https://github.com/Elchi-Studios/eauth-js/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-stable-brightgreen)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Made by Elchi Studios](https://img.shields.io/badge/made%20by-Elchi%20Studios-8A2BE2)](https://github.com/Elchi-Studios)

</div>

---

## Overview

[EAuth](https://eauth.me) is the sign-in service of Elchi Studios: OAuth 2.1
and OpenID Connect, free, with no user limit. A browser application signs
in with the authorization code flow and PKCE. Doing that correctly takes
more than a tutorial shows: the answer has to be checked in four ways,
tokens have to live somewhere a script bug cannot reach, and two refreshes
at once must not end the session.

This repository does all of that, once, for every framework:

| Package | For | |
| --- | --- | --- |
| [`@elchi-studios/eauth`](packages/eauth) | any web page | The core. No dependencies, about 5 kB minified and gzipped. |
| [`@elchi-studios/eauth-react`](packages/react) | React 18 and 19, Next.js | Provider, `useEAuth()`, `<SignedIn>`, `<SignedOut>` and buttons. |
| [`@elchi-studios/eauth-sveltekit`](packages/sveltekit) | Svelte 4 and 5, SvelteKit | One store with the state and the actions. |
| [`@elchi-studios/eauth-nuxt`](packages/nuxt) | Nuxt 3 and 4 | A module with `useEAuth()`, an `eauth` route middleware and runtime config. |

The framework packages are bridges: the protocol is in the core, and each
of them only turns its state into the framework's.

## The trick

A page load is the only moment anything happens, and `ready()` handles all
of it:

```
page load ─► ready()
              ├─ an answer for this tab ────► check state, iss, nonce, aud ─► signed in
              ├─ this browser was signed in ─► prompt=none through EAuth ────► back with an answer
              └─ neither ────────────────────► signed out
```

Because a reload can always ask EAuth again without showing anything,
tokens never have to be stored: they stay in memory, where a script
injected into the page cannot find them in `localStorage`. The one thing
kept is a flag saying this browser was signed in, so a first visit costs
no redirect.

## Quick look

```bash
npm install @elchi-studios/eauth-react
```

```tsx
import { EAuthProvider, SignedIn, SignedOut, SignInButton, useEAuth } from "@elchi-studios/eauth-react";

export default function App() {
  return (
    <EAuthProvider clientId="eauth_pub_..." redirectUri={location.origin + "/"}>
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <Orders />
      </SignedIn>
    </EAuthProvider>
  );
}

function Orders() {
  const { user, fetch, signOut } = useEAuth();
  async function load() {
    // fetch attaches the access token and renews it before it expires.
    const orders = await (await fetch("/api/orders")).json();
    console.table(orders);
  }
  return (
    <>
      <p>Hello {user?.name}</p>
      <button onClick={load}>Load orders</button>
      <button onClick={() => signOut()}>Sign out</button>
    </>
  );
}
```

Without a framework:

```js
import { EAuth } from "@elchi-studios/eauth";

const auth = new EAuth({ clientId: "eauth_pub_...", redirectUri: location.origin + "/" });
const { user } = await auth.ready();
if (!user) await auth.signIn();
```

The application is created as a public client at
[panel.elchi.dev](https://panel.elchi.dev). There is no secret to pass,
because a browser cannot keep one.

## Design

- **No client secret, anywhere.** PKCE proves that the browser finishing a
  sign-in is the one that started it.
- **Every answer checked.** `state`, `nonce`, `iss`
  ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207)) and `aud`, and a
  mismatch throws an `EAuthError` with a code to branch on.
- **Refreshes never overlap.** Refresh tokens rotate; two refreshes at once
  would look like a stolen token and end the session. Callers in a page
  share one, and tabs sharing a stored token take turns. Only a token EAuth
  refuses ends the session, not a dropped connection.
- **No redirect loops.** An answer that is not for this tab is ignored, a
  failed silent attempt is not repeated, the Nuxt middleware shows a failed
  sign-in instead of starting another, and the core refuses a sign-in
  after three failed ones in half a minute.
- **Safe during server rendering.** Every package can be imported and
  rendered on the server, where nobody is signed in. The Nuxt module
  changes its state only after hydration.
- **No dependencies in the core.** Web Crypto and `fetch` are enough.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the plan in
[docs/ROADMAP.md](docs/ROADMAP.md), the choices in
[docs/DECISIONS.md](docs/DECISIONS.md).

## Non-goals

- Client secrets and confidential clients. An application with a server
  that keeps the tokens uses any OpenID Connect library on that server.
- The implicit flow and the password grant. OAuth 2.1 removed both.
- Tokens in `localStorage` by default. `storage: "local"` exists for those
  who have weighed it; it will not become the default.
- Features EAuth does not have. The SDK follows the service; ideas for the
  service are welcome as issues.

## Status

Stable. The API of every package follows semantic versioning from 1.0.0,
and the packages are released together with one version.

The bar every change clears: the unit tests of each package, the Nuxt
module and the plain example driven in Chromium against a stand-in for
EAuth with every other request refused, all of it on Node 22 and 24 and
again with React 18, Svelte 4 and Nuxt 3, and the tarballs npm would
publish checked with publint and attw.

```bash
npm ci
npx playwright-core install chromium
npm run check
```

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Security matters go to the address in [SECURITY.md](SECURITY.md).

## Documentation

| | |
| --- | --- |
| Each package's reference | [core](packages/eauth), [React](packages/react), [Svelte](packages/sveltekit), [Nuxt](packages/nuxt) |
| A page without a build step | [examples/vanilla.html](examples/vanilla.html) |
| EAuth itself | [docs.elchi.dev](https://docs.elchi.dev/eauth) |
| What changed | [CHANGELOG.md](CHANGELOG.md) |

## License

[MIT](LICENSE). Made by Elchi Studios.
