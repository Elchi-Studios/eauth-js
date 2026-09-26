# @elchi-studios/eauth-nuxt

Sign in with [EAuth](https://eauth.me) in Nuxt 3 and 4. A module with a
`useEAuth()` composable, an `eauth` route middleware and runtime config. The
protocol is done by [`@elchi-studios/eauth`](https://www.npmjs.com/package/@elchi-studios/eauth).

## Install

```bash
npm install @elchi-studios/eauth-nuxt
```

Create the application at [panel.elchi.dev](https://panel.elchi.dev) as a
**public** client and register the redirect URI exactly as configured,
trailing slash included. The module asks for `offline_access`, so a
session outlives the 15 minutes of an access token; new applications may
have it.

## Configure

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@elchi-studios/eauth-nuxt"],
  eauth: {
    clientId: "eauth_pub_...",
    redirectUri: "https://app.example/",
  },
});
```

Without `redirectUri` the module uses the application's root
(`origin` plus `app.baseURL`), which must then be registered.

The options are public runtime config, so every environment can set its own
without a new build:

```bash
NUXT_PUBLIC_EAUTH_CLIENT_ID=eauth_pub_...
NUXT_PUBLIC_EAUTH_REDIRECT_URI=https://staging.app.example/
```

| Option | Environment variable | Default |
|---|---|---|
| `clientId` | `NUXT_PUBLIC_EAUTH_CLIENT_ID` | required |
| `redirectUri` | `NUXT_PUBLIC_EAUTH_REDIRECT_URI` | the application's root |
| `postLogoutRedirectUri` | `NUXT_PUBLIC_EAUTH_POST_LOGOUT_REDIRECT_URI` | `redirectUri` |
| `issuer` | `NUXT_PUBLIC_EAUTH_ISSUER` | `https://eauth.me` |
| `scope` | `NUXT_PUBLIC_EAUTH_SCOPE` | `openid profile email offline_access` |
| `storage` | `NUXT_PUBLIC_EAUTH_STORAGE` | `memory` |
| `silentRestore` | (only in `nuxt.config`) | on with memory storage |

The [core README](https://www.npmjs.com/package/@elchi-studios/eauth#configuration)
explains each of them. None of them is a secret; a browser application has
none.

## Use

```vue
<script setup lang="ts">
const { user, loading, signIn, signOut } = useEAuth();
</script>

<template>
  <p v-if="loading">One moment</p>
  <template v-else-if="user">
    <p>Hello {{ user.name }}</p>
    <button @click="signOut()">Sign out</button>
  </template>
  <button v-else @click="signIn()">Sign in</button>
</template>
```

`useEAuth` is auto-imported. The module completes the sign-in when EAuth
sends the browser back, continues the session after a reload, and returns
the person to the page they started on, `app.baseURL` included.

## Pages that need somebody signed in

```vue
<script setup lang="ts">
definePageMeta({ middleware: "eauth" });
</script>
```

The middleware waits for the session to be established before it decides,
and sends anybody who is not signed in to EAuth and back to this page. On
the page load itself it takes the page's place in the history, so Back
does not return to a page that redirects again.

When the page load's sign-in failed, the middleware does not start another
one, which would most likely fail the same way and redirect again and
again. The navigation fails with a 401 error instead, whose message says
why; an `error.vue` shows it:

```vue
<script setup lang="ts">
const props = defineProps<{ error: { statusCode: number; message: string } }>();
</script>

<template>
  <h1>{{ props.error.statusCode === 401 ? "Signing in did not work" : "Something went wrong" }}</h1>
  <p>{{ props.error.message }}</p>
</template>
```

The middleware decides in the browser. Pages behind it are still rendered
on the server for anyone, and their code ships to every browser, so keep
data behind your API, which checks the access token.

## Calling your own API

```ts
const { fetch, getAccessToken } = useEAuth();

const response = await fetch("/api/orders");
// or with $fetch
const token = await getAccessToken();
const orders = await $fetch("/api/orders", {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
```

The access token is renewed shortly before it expires. Only send it to your
own API.

## Server rendering

The session lives in the browser. During server rendering nobody is signed
in and `loading` is `true`; the state changes after the page has hydrated,
so there is no hydration mismatch. Server routes and `useFetch` on the
server do not know who is signed in: data that needs a signed-in person is
fetched in the browser with the access token.

## useEAuth()

| Field | |
|---|---|
| `user` | Ref: the signed-in user or `null` (`sub`, `name`, `email`, `emailVerified`, `organization`, `claims`). |
| `loading` | Ref: `true` until the page load's sign-in or restore has finished. |
| `error` | Ref: an `EAuthError` from the last sign-in, or `null`. `error.code` says what happened. |
| `signIn(options)` | Goes to EAuth. Options: `prompt`, `loginHint`, `maxAge`, `organization`, `returnTo` (a path as the browser sees it), `replace`. |
| `signOut(options)` | `{ endSession: true }` signs out at EAuth too. |
| `getAccessToken()` | A valid access token, or `null`; `null` on the server. |
| `fetch(input, init)` | `fetch` with the access token attached. |

The `EAuth` instance itself is `useNuxtApp().$eauth`, in the browser.

## License

MIT. Made by [Elchi Studios](https://elchi.dev).
