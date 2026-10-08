# Changelog

Every package in this repository is released with the same version. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### @elchi-studios/eauth

- A code from EAuth that answers a sign-in another tab started is followed
  by one silent sign-in, so a person who registers in one tab and confirms
  their address from the mail in another is signed in there, not left
  signed out. Only with `silentRestore`, and never for an error. Not
  after `signOut()` either, until a sign-in is started again in this
  browser: EAuth may still hold the session, and an old code, from a mail
  link clicked again or the history, would sign the person back in. With
  `storage: "local"` none of this applies: `restore()` continues from the
  stored refresh token, or not at all.
- A request the browser does not let through says that it may be the
  browser keeping the answer from the page, not only that EAuth could not
  be reached, and for the token endpoint which origins it answers.
- The browser tests run against a stand-in that answers CORS as EAuth
  does, so a request EAuth would not let a page read fails here too.

## 1.0.0

The first release.

### @elchi-studios/eauth

- Authorization code flow with PKCE (S256), for public clients only.
- `state`, `nonce`, `iss` (RFC 9207), `aud`, `azp`, `sub` and `exp`
  verified on every sign-in, `auth_time` against `maxAge` and
  `prompt: "login"`; a mismatch throws an `EAuthError` with a code.
- Answers that do not belong to a sign-in started in the tab are removed
  from the address and ignored.
- Asks for `offline_access` by default, so a session outlives the access
  token; EAuth leaves it out for applications that may not have it.
- Tokens in memory by default. After a reload, one silent `prompt=none`
  redirect continues the session, only when the browser was signed in
  before, and not again after it failed. `storage: "local"` keeps the
  refresh token across reloads instead.
- `ready()` completes or continues the session once per page load and
  resolves to `{ user, returnTo }`.
- Refreshes never overlap: callers share one, and with `storage: "local"`
  the tabs of an origin take turns, never presenting another account's
  token. Only a refresh token EAuth refuses ends the session. A sign-out,
  in this tab or another, stays a sign-out while a refresh is under way.
- Without a refresh token the session ends with the access token.
- `signIn` with `prompt`, `loginHint`, `maxAge`, `returnTo` (paths on the
  application's own origin only) and `replace`. After three failed or
  refused sign-ins in half a minute the next is refused with
  `sign_in_loop`, and an answer redirected away from the redirect URI is
  reported as `redirect_mismatch` instead of tried again. Declining at
  EAuth leads back to the page the sign-in started from.
- `signOut` revokes the refresh token, and with `endSession` signs out at
  EAuth too.
- `fetch` and `getAccessToken` for calling your own API.
- Organisations: `signIn` takes `organization` by ID or slug, the user
  carries `organization` (`id`, `slug`, `name`, `role`, `permissions`), an
  answer for another organisation than the one named is refused, and a
  renewal that changes the organisation ends the session. A reload
  continues in the tab's own organisation, and with `storage: "local"` a
  tab never presents the refresh token of another organisation.

### @elchi-studios/eauth-react

- `EAuthProvider`, `useEAuth`, `SignedIn`, `SignedOut`, `SignInButton` and
  `SignOutButton` for React 18 and 19.
- One sign-in per page load under StrictMode.
- Renders on the server with nobody signed in; marked as client code for the
  Next.js App Router.

### @elchi-studios/eauth-sveltekit

- `createAuth`, a store of `{ user, loading, error }` with the actions, for
  Svelte 4 and 5 and SvelteKit.
- Touches no browser API during server rendering.

### @elchi-studios/eauth-nuxt

- Module for Nuxt 3 and 4 with the auto-imported `useEAuth` composable and
  the `eauth` route middleware, which shows a failed sign-in as a 401
  error instead of starting another.
- Options as public runtime config, overridable per environment with
  `NUXT_PUBLIC_EAUTH_*`.
- The state changes only after hydration, so server rendering causes no
  hydration mismatch. `app.baseURL` is respected on the way back.
