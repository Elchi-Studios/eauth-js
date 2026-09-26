# Architecture

## Layers

```
@elchi-studios/eauth-react  @elchi-studios/eauth-sveltekit  @elchi-studios/eauth-nuxt
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             ▼
                        @elchi-studios/eauth  ── fetch, Web Crypto, storage
                             │
                             ▼
                    EAuth (discovery, /authorize, /token, /revoke)
```

The core speaks the protocol and knows nothing about frameworks. Each
framework package holds one `EAuth` instance, calls `ready()` once, and
turns `user`, `loading` and `error` into the framework's own state. None
of them talks to EAuth directly.

## The core

One class, `EAuth`, in `packages/eauth/src/index.ts`.

**Discovery.** The first call that needs EAuth fetches
`/.well-known/openid-configuration` from the issuer and keeps the promise.
The document must name the issuer that was asked and offer PKCE with S256;
anything else throws. A failed discovery is not cached.

**Sign-in.** `signIn()` makes a PKCE verifier, `state` and `nonce`, keeps
them in `sessionStorage` under `eauth:pending` (the only storage that
survives the navigation and dies with the tab), and navigates to the
authorization endpoint: with `location.assign` when the person asked, and
with `location.replace` for a silent attempt or a guard on page load, so
Back does not lead to a page that redirects again. It refuses to start
after three failed or refused answers within half a minute (kept in
`eauth:failures`, cleared by a completed sign-in) with `sign_in_loop`, and
refuses when session storage is blocked, since the answer could never be
matched.

**The way back.** `handleRedirect()` only looks at the redirect URI
(ignoring a trailing slash), and only at an address with `state` and
`code` or `error`. Elsewhere, an answer carrying this tab's pending
`state` means a redirect in front of the application moved it; that is
reported as `redirect_mismatch` rather than retried. An answer whose
`state` is not the pending one of this tab is removed from the address and
ignored, error text included, and the page carries on to restore. A
matching answer is spent at once: the pending request goes and the answer
leaves the address, so a reload cannot redeem the code twice. Then `iss`
is checked, on errors too, and required when discovery says the server
always sends it (RFC 9207). A silent attempt that EAuth answers with
`login_required` or one of its siblings resolves with nobody signed in;
any other failure of a silent attempt clears the hint, so it is not
repeated. When the person declined, `returnTo` is the page the sign-in
started from rather than the page that needed it. Otherwise the code is
exchanged with the verifier, and the ID token's `iss`, `aud`, `azp`,
`sub`, `exp` and `nonce` are checked, with `auth_time` against `maxAge`
and `prompt=login`, and the organisation against the one named at sign-in:
an ID in any form EAuth reads, compared with `org_id`, or a slug, compared
with `org_slug`, both without regard to case.

Everything that handled an answer returns `returnTo`: the path the sign-in
started from, or the current path without the answer. Errors carry it too.
Routers read the address when they start, and are told this way.

**Restore.** With memory storage, `restore()` looks for the flag
`eauth:signed-in` in `localStorage`. With the flag, it signs in again with
`prompt=none`, and with the organisation the tab was in, kept by ID in
`sessionStorage` as `eauth:organization`; `access_denied` for it then
means signed out, like `login_required`. When the previous silent attempt
is still pending, it never came back to the redirect URI: a reload may
have interrupted it, so it is tried once more, and after that restore
stops with `redirect_mismatch`. Paths kept to return to lose a spent
answer when they are on the redirect URI, where a router may have written
it back; anywhere else the query belongs to the application and stays
whole. With `storage: "local"` the refresh token is in `localStorage` and
restore is a refresh.

**Refresh.** `getAccessToken()` renews the token a minute before it
expires, or halfway through a shorter lifetime. It starts `ready()` if
nothing has yet, since a React child's effect runs before its provider's,
and waits for it. Callers share one refresh promise. With
`storage: "local"` the refresh runs under a Web Lock per client ID and
first re-reads the stored token, so the tabs of an origin take turns and
each presents the newest token. The stored token carries the `sub` and the
organisation's ID it belongs to, and a tab whose person or organisation
differs signs itself out instead of presenting it. When storage no longer
holds the presented token once the answer arrives, another tab signed out
or in meanwhile: the new token is revoked and this tab's session ends.
Token requests give up after 30 seconds, so a hung one cannot hold the
lock. Only `invalid_grant` and its siblings end the session; a network
failure or a 5xx keeps it. A renewed ID token must name the same `sub` and
the same organisation. A counter of sign-outs, the epoch, lets a refresh
that finishes after a sign-out hand its new token back to EAuth instead of
bringing the session back.

**Expiry.** Without a refresh token the session ends with the access
token: a timer, and a check whenever the user is read, clear it and call
`onChange(null)`. The hint stays, so the next page load continues the
session silently while EAuth still knows the person.

**`ready()`** is `handleRedirect()` and then, if there was no answer for
this tab, `restore()`, run once per instance with the promise shared. That
is what makes React's double mount in development, or two components
asking at once, start one sign-in and not two.

## The framework packages

**React.** `EAuthProvider` creates the client in a `useState` initialiser,
so it survives re-renders, and calls `ready()` in an effect. When a
`returnTo` comes back, with a result or an error, it goes to `onReturn`,
by default `history.replaceState` and a `popstate` event that routers
follow.

**Svelte.** `createAuth()` returns a readable store. The client is created
on the first subscription in the browser, never on the server. A store
module is evaluated once per page, so the tokens survive navigation.

**Nuxt.** A module that adds public runtime config, a client-only plugin,
the `useEAuth` composable and the `eauth` route middleware. The state is
`useState`, so the server renders `loading` and the payload carries it to
the browser. The plugin changes the state only after the
`app:suspense:resolve` hook, when hydration has finished; changing it
earlier would make Vue discard the server's markup. It then navigates to
`returnTo`, with `app.baseURL` taken off, which also replaces the address
the router read before the answer left it. The middleware waits for
`ready()` before it decides. When that failed it fails the navigation with
a fatal 401 carrying the reason, instead of starting a sign-in that would
fail the same way; otherwise it signs in with `replace` on the page load
itself.

## Tests

- `packages/eauth/test/browser.ts` is a browser (location, history, both
  storages, `fetch`, Web Locks) and an EAuth server small enough to read.
  The server checks PKCE, spends codes once, rotates refresh tokens and
  ends the session when a rotated one comes back, as EAuth does.
- The React and Svelte tests run the real framework in Node against that
  browser, with happy-dom for React's DOM.
- `packages/eauth/test/chromium.ts` puts the same server behind request
  interception in Chromium and refuses every request that is not for the
  page's own server or the stand-in. The Nuxt tests build a real
  application with the module and drive it there; `test/example.test.ts`
  does the same for `examples/vanilla.html`.
- `scripts/check-packages.mjs` packs every package and checks the tarball:
  the files, the metadata, publint, and attw for the types.

## Releases

`scripts/version.mjs` sets one version on every package and the ranges
between them. `.github/workflows/lockfile.yml` resolves the lockfile afresh,
runs every check with it and commits it; Dependabot keeps it current in
between. A tag `v*` runs `.github/workflows/release.yml`: every check
again, then `npm publish` per package with provenance, skipping versions
already on npm, then the GitHub release from `CHANGELOG.md`.
