# @elchi-studios/eauth-sveltekit

Sign in with [EAuth](https://eauth.me) in Svelte 4 and 5 and SvelteKit. One
store holds the state and the actions; it is safe during server rendering.
The protocol is done by [`@elchi-studios/eauth`](https://www.npmjs.com/package/@elchi-studios/eauth).

## Install

```bash
npm install @elchi-studios/eauth-sveltekit
```

Create the application at [panel.elchi.dev](https://panel.elchi.dev) as a
**public** client and register the redirect URI exactly as you pass it,
trailing slash included. The package asks for `offline_access`, so a
session outlives the 15 minutes of an access token; new applications may
have it.

## Use

Create the store once, in a module:

```ts
// src/lib/auth.ts
import { goto } from "$app/navigation";
import { createAuth } from "@elchi-studios/eauth-sveltekit";

export const auth = createAuth({
  clientId: "eauth_pub_...",
  redirectUri: "https://app.example/",
  onReturn: (path) => goto(path, { replaceState: true }),
});
```

and use it anywhere:

```svelte
<script>
  import { auth } from "$lib/auth";
</script>

{#if $auth.loading}
  <p>One moment</p>
{:else if $auth.user}
  <p>Hello {$auth.user.name}</p>
  <button onclick={() => auth.signOut()}>Sign out</button>
{:else}
  <button onclick={() => auth.signIn()}>Sign in</button>
{/if}
```

(Svelte 4 writes `on:click` instead of `onclick`; the store is the same.)

The first subscription in the browser completes the sign-in when EAuth
sends the browser back, or continues the session after a reload.
`onReturn` is called when the page load handled an answer from EAuth, with
the path to show: where the sign-in started, or the current page without
the answer. A module is
evaluated once per page, so the tokens the store holds in memory survive
client-side navigation.

## Calling your own API

```ts
const response = await auth.fetch("/api/orders");
```

`auth.fetch` attaches the access token, which is renewed shortly before it
expires. `await auth.getAccessToken()` gives the token itself, or `null`.
Only send it to your own API.

## Pages that need somebody signed in

```svelte
<!-- src/routes/account/+layout.svelte -->
<script>
  import { page } from "$app/state";
  import { auth } from "$lib/auth";

  let { children } = $props();

  $effect(() => {
    if (!$auth.loading && !$auth.user && !$auth.error) {
      auth.signIn({ returnTo: page.url.pathname, replace: true });
    }
  });
</script>

{#if $auth.error}
  <p>The sign-in failed: {$auth.error.message}</p>
{:else if $auth.user}
  {@render children()}
{/if}
```

In Svelte 4, the same with `$: if (...)`, `$page` from `$app/stores` and
`<slot />`.

Wait for `loading` to turn false before deciding: deciding earlier sends a
person who is signed in to EAuth on every reload. When the sign-in failed,
show `error` instead of starting another one, which would most likely fail
the same way and redirect again and again. `replace: true` keeps Back from
returning to a page that redirects again.

A guard in the browser decides what is shown, not what can be read.
The session lives in the browser, so `load` functions on the server do not
know who is signed in. Data that needs a signed-in person comes from your
API, called with the access token.

## The store

`$auth` is `{ user, loading, error }`:

| Field | |
|---|---|
| `user` | The signed-in user or `null`: `sub`, `name`, `email`, `emailVerified`, `orgId`, `claims`. |
| `loading` | `true` until the page load's sign-in or restore has finished. Stays `true` during server rendering. |
| `error` | An `EAuthError` from the last sign-in, or `null`. `error.code` says what happened. |

and `auth` has:

| Method | |
|---|---|
| `signIn(options)` | Goes to EAuth. Options: `prompt`, `loginHint`, `maxAge`, `returnTo`, `replace`. |
| `signOut(options)` | `{ endSession: true }` signs out at EAuth too. |
| `getAccessToken()` | A valid access token, or `null`; `null` on the server. |
| `fetch(input, init)` | `fetch` with the access token attached. |
| `client` | The underlying `EAuth` instance, or `null` before the first use in the browser. |

`createAuth` takes every option of the core (see the
[core README](https://www.npmjs.com/package/@elchi-studios/eauth#configuration)) and
`onReturn`.

## License

MIT. Made by [Elchi Studios](https://elchi.dev).
