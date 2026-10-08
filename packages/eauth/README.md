# @elchi-studios/eauth

Sign in with [EAuth](https://eauth.me) from any web page. OAuth 2.1 and
OpenID Connect with PKCE, no client secret, no dependencies, about 5 kB
minified and gzipped.

This is the core. For a framework, use the package built on it:

| Framework | Package |
|---|---|
| React 18 and 19, Next.js | [`@elchi-studios/eauth-react`](https://www.npmjs.com/package/@elchi-studios/eauth-react) |
| Svelte 4 and 5, SvelteKit | [`@elchi-studios/eauth-sveltekit`](https://www.npmjs.com/package/@elchi-studios/eauth-sveltekit) |
| Nuxt 3 and 4 | [`@elchi-studios/eauth-nuxt`](https://www.npmjs.com/package/@elchi-studios/eauth-nuxt) |

## Install

```bash
npm install @elchi-studios/eauth
```

## Before you start

Create the application at [panel.elchi.dev](https://panel.elchi.dev) as a
**public** client. A browser cannot keep a secret, so this package never
asks for one. Register the redirect URI exactly as you pass it below,
trailing slash included.

An access token lives 15 minutes. The package asks for `offline_access`
by default and renews the token before it runs out. New applications may
have it; for one whose settings leave it out, EAuth leaves it out of the
sign-in, and the session ends with the access token. The next page load
then continues it silently for as long as EAuth still knows the person.

## Sign in

```js
import { EAuth } from "@elchi-studios/eauth";

const auth = new EAuth({
  clientId: "eauth_pub_...",
  redirectUri: location.origin + "/",
});

// On every page load. Completes a sign-in when EAuth has just sent the
// browser back, and otherwise continues the session.
const { user, returnTo } = await auth.ready();
if (returnTo) history.replaceState(null, "", returnTo);

if (user) {
  greeting.textContent = `Hello ${user.name ?? user.email}`;
} else {
  signInButton.onclick = () => auth.signIn({ returnTo: location.pathname });
}
```

`signIn` navigates to EAuth. The person signs in there, EAuth sends the
browser back to the redirect URI, and `ready()` on that page load exchanges
the answer for tokens, checks it, and removes it from the address.
`returnTo` is set whenever `ready()` handled an answer: the path the
sign-in started from, or the current path without the answer. A router
that read the address before the answer was removed wants to be told.

## Calling your own API

```js
const response = await auth.fetch("/api/orders");

// or, for a client of your own
const token = await auth.getAccessToken();
```

`getAccessToken` renews the token shortly before it expires and resolves to
`null` when nobody is signed in. `auth.fetch` attaches the token to every
request it makes, so use it for your own API only.

The access token is a signed JWT ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)).
Your server verifies it with any JWT library against the keys at
`https://eauth.me/.well-known/jwks.json` and checks `iss`, `aud` (your client
ID) and `exp`. The server never has to call EAuth for that.

## Pages that need somebody signed in

```js
let result;
try {
  result = await auth.ready();
} catch (err) {
  // The sign-in of this page load failed. Show why; starting another one
  // would most likely fail the same way, and redirect again and again.
  return showError(err);
}
if (!result.user) await auth.signIn({ returnTo: location.pathname, replace: true });
```

Wait for `ready()` before deciding: deciding earlier sends a person who is
signed in to EAuth on every reload. `replace: true` takes the page's place
in the history, so Back does not return to a page that redirects again. As
a last line, after three sign-ins within half a minute that failed or were
refused, and none completed, the next is refused with `sign_in_loop`. A
person who goes back from EAuth and clicks again brings no answer and
never counts.

A guard in the browser decides what is shown, not what can be read. Keep
data behind your API, which checks the access token.

## Signing out

```js
await auth.signOut();                     // here, and the refresh token is revoked
await auth.signOut({ endSession: true }); // at EAuth too; the next sign-in asks for the password
```

`endSession` navigates to EAuth and back to `postLogoutRedirectUri`, which
must be registered as a post-logout URI.

## After a reload

Tokens are kept in memory, so a reload forgets them. When this browser was
signed in before, `ready()` then asks EAuth again with `prompt=none`: one
redirect that shows nothing, takes the page's place in the history, and
comes straight back. While it is under way the promise does not resolve,
because the page is leaving. On the way back `ready()` completes the
sign-in, with `returnTo` the path the page was on. When EAuth no longer
knows the person, it resolves with `user` null and the same `returnTo`,
and the next load does not try again.

With `storage: "local"` the refresh token is kept in `localStorage`
instead, and a reload continues without any redirect. Any script on your
origin can read it there, which is why this is not the default. The tabs of
an origin then share the token and take turns renewing it, so rotation
never looks like theft to EAuth. Signing out in one tab ends the others at
their next renewal, and is not undone by a renewal already under way. The
token is stored with whose it is, so a tab never presents the token of an
account another tab has signed in to.

## Organisations

For applications with [organisations](https://docs.elchi.dev/organisations)
turned on. A sign-in for one of them carries it on the user:

```js
const { user } = await auth.ready();
user?.organization; // { id, slug, name, role, permissions } or undefined
```

Without being told, EAuth takes the person's only organisation or asks
which one. To sign in for a particular one, or to switch, name it by its ID
or its slug (an empty string names none):

```js
await auth.signIn({ organization: "acme-ag" });
```

A person who is not a member comes back with `access_denied`. An answer for
another organisation than the one named is refused with
`organization_mismatch`, and a renewal that changes the organisation ends
the session. Key your data on `organization.id`; the slug can change. Your
API checks the same claims in the access token (`org_id`, `org_role`,
`org_permissions`).

Two tabs can be in two organisations. With memory storage each tab
remembers its own, and a reload continues in it; when the person may no
longer enter it, the reload ends signed out. With `storage: "local"` the
origin keeps one refresh token, so a tab whose organisation is not the
stored token's signs itself out instead of presenting it.

## Answers that are not for this tab

An answer from EAuth that does not belong to a sign-in started in this tab
(a reload of an answer already used, a link opened in another tab, or a
forged one) is removed from the address and ignored, and the page carries
on as if it had not been there. Only the redirect URI is looked at, so a
`code` parameter of your own on another page is left alone.

Nothing in such an answer is redeemed, but a code from EAuth says that the
browser was signed in there a moment ago, as when somebody registers in one
tab and confirms their address from the mail in another. With
`silentRestore`, `restore()` then tries one silent sign-in, which completes
it in this tab. It does not after `signOut()`, until a sign-in is started
again in this browser, so an old code cannot sign the person back in. With
`storage: "local"` there is no silent sign-in at all.

## Configuration

| Option | Default | |
|---|---|---|
| `clientId` | | Required. From panel.elchi.dev. |
| `redirectUri` | | Required. An absolute URL that matches a registered redirect URI exactly. |
| `postLogoutRedirectUri` | `redirectUri` | Where `signOut({ endSession: true })` returns to. |
| `issuer` | `https://eauth.me` | Your own deployment, if you run one. Everything else is discovered. |
| `scope` | `openid profile email offline_access` | `offline_access` brings the refresh token. |
| `storage` | `"memory"` | `"local"` keeps the refresh token across reloads. |
| `silentRestore` | on with memory storage | The `prompt=none` redirect after a reload. |
| `onChange` | | Called with the user, or `null`, whenever that changes. |

## Methods

| Method | |
|---|---|
| `ready()` | Completes or continues the session on a page load; resolves to `{ user, returnTo }`. Runs once per instance; later calls share the result. |
| `getUser()` | The signed-in user or `null`: `sub`, `name`, `email`, `emailVerified`, `organization` and every claim in `claims`. |
| `isAuthenticated()` | Whether somebody is signed in. |
| `getAccessToken()` | A valid access token, or `null`. Starts `ready()` if nothing has, which may be the silent redirect of a restore, and waits for it. |
| `signIn(options)` | Navigates to EAuth. Options: `prompt` (`"login"`, `"none"`, `"consent"`), `loginHint`, `maxAge` in seconds, `organization`, `returnTo`, `replace`. |
| `signOut(options)` | Options: `local` to skip the revocation, `endSession` to sign out at EAuth too. |
| `fetch(input, init)` | `fetch` with the access token attached, keeping a `Request`'s own headers. |
| `fetchUserInfo()` | The claims of the userinfo endpoint, fetched now. |
| `handleRedirect()`, `restore()` | The two halves of `ready()`, for when you need them apart. |

Use `sub` as the key for the person in your own data. It never changes;
an email address can.

Create one `EAuth` per page, and call `ready()` once per page load; the
framework packages do both.

`returnTo` only accepts a path on your own origin. Another origin, or a
path starting with two slashes, which a browser reads as another host, is
dropped, so it cannot be turned into an open redirect.

## Errors

Everything throws an `EAuthError` with a `code` to branch on. An error
that came with an answer from EAuth also carries `returnTo`, as `ready()`
would have; when the person declined (`access_denied`), it is the page the
sign-in was started from.

| Code | Meaning |
|---|---|
| `issuer_mismatch` | The answer, the discovery document or the ID token names another server, or the answer names none. |
| `audience_mismatch` | The ID token was issued for another application. |
| `nonce_mismatch` | The ID token belongs to another sign-in. |
| `subject_mismatch` | A renewed ID token names somebody else. The session ends. |
| `organization_mismatch` | The ID token is for another organisation than the one named at sign-in, or a renewed one changes the organisation. A renewal ends the session. |
| `stale_authentication` | With `maxAge` or `prompt: "login"`: the sign-in is older than asked for. |
| `invalid_token` | The ID token is malformed, or lacks `sub` or `exp`. |
| `token_expired` | The ID token has expired; usually the device clock is wrong. |
| `request_expired` | The sign-in took more than ten minutes. |
| `sign_in_loop` | Three sign-ins failed or were refused within half a minute, so no fourth was started. |
| `redirect_mismatch` | EAuth's answer did not arrive at the redirect URI: something in front of the application redirects away from it, or drops its query. A silent attempt interrupted by a reload is tried once more before this. |
| `storage_unavailable` | The browser blocks session storage, so a sign-in could never be completed. |
| `discovery_failed` | EAuth could not be reached, or the issuer is wrong. |
| `pkce_unsupported` | The server does not offer PKCE with S256. |
| `not_in_browser` | A browser-only method was called during server rendering. |
| `invalid_config` | `clientId`, `redirectUri` or `storage` is missing or wrong. |

Errors EAuth itself reports keep EAuth's code, for example `access_denied`
when the person declines, or `invalid_grant` when a code was already used.

## What it does that a tutorial would not

**No client secret anywhere.** If you find yourself wanting to pass one, the
application is registered as the wrong type.

**Tokens in memory by default.** A token in `localStorage` is readable by any
script on the page, so one cross-site scripting bug in any dependency hands
over the session.

**`state`, `nonce`, `iss`, `aud` and `azp` are verified,** and a mismatch
throws. The `iss` check ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207))
stops a mix-up attack when an application talks to more than one provider.

**Refreshes never overlap.** Refresh tokens rotate. Two refreshes at once
would present a token that was already rotated, which EAuth reads as theft
and answers by ending the session. Callers in a page share one refresh,
and with `storage: "local"` the tabs take turns. A refresh that fails for a
passing reason, such as a dropped connection or no answer within 30
seconds, keeps the session; only a refresh token EAuth refuses ends it.

## Requirements

A browser with the Web Crypto API and `fetch`: every current version of
Chrome, Edge, Firefox and Safari. Web Crypto only exists in a secure
context, so serve the page over https, or from `http://localhost` while
developing. The package can be imported during server rendering; the
methods that need a browser throw `not_in_browser` there.

## License

MIT. Made by [Elchi Studios](https://elchi.dev).
