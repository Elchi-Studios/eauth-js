# Decisions

Choices that were made on purpose, so they are not reopened by accident.

## Tokens in memory, a silent redirect after a reload

A token in `localStorage` is readable by every script on the origin, so
one cross-site scripting bug in any dependency hands over the session.
Memory is not readable that way. The price is one redirect through EAuth
after a reload, which shows nothing and takes a moment. `storage: "local"`
is there for applications that have weighed it; it is not the default.

## A flag, not a token, in localStorage

Without it, every first visit would be sent through EAuth to find out
that nobody is signed in. The flag says only that this browser was
signed in before, and it goes the moment EAuth answers
`login_required`, so a signed-out browser is not redirected on every load.

## An answer that is not for this tab is ignored, not reported

An answer whose `state` does not match the sign-in pending in this tab is
a reload of one already spent, a link opened in another tab, or a forgery.
Reporting it would show a forger's `error_description` on the page and
turn every reload of a spent answer into an error. Ignoring it is as safe,
since nothing is exchanged, and the page restores the session as usual.

## Only a refused refresh token ends the session

A dropped connection or a 5xx says nothing about the session. Signing out
on them would throw away a good refresh token on a train in a tunnel.
`invalid_grant` and its siblings do mean the token is dead, and end it.

## Tabs take turns with a Web Lock

With `storage: "local"` every tab holds the same rotating refresh token.
Without coordination two tabs renew at once, the second presents a token
the first already rotated, and EAuth rightly ends the whole session. Web
Locks are in every browser this supports, cost nothing, and let each tab
read the newest token before it presents one.

## A failed sign-in is shown, not retried

A guard that starts a sign-in again after one failed loops for as long as
the cause lasts, a wrong device clock for instance, sending the person
between the application and EAuth several times a second. The Nuxt
middleware and the guards in the READMEs show the error instead. For
guards written without that care, the core refuses a sign-in after three
answers within half a minute that failed or refused. It counts answers,
not sign-ins started: a person who goes back from EAuth and clicks again
brings no answer and is never refused. An answer that arrives somewhere
other than the redirect URI, because a redirect in front of the
application moved it, is reported as `redirect_mismatch`, and a silent
attempt that never came back is tried once more, in case a reload
interrupted it, and then not again: both would otherwise loop without a
single failed answer to count.

## The ID token's signature is not checked in the browser

The ID token comes straight from the token endpoint, over TLS, in answer
to this client's own request, which OpenID Connect Core 3.1.3.7 accepts in
place of a signature check. Checking it would need a JWKS fetch and an RSA
implementation for no gain. Every token that reaches a server is checked
there.

## No dependencies in the core

Web Crypto and `fetch` do everything the protocol needs. A dependency in
an authentication library is one more thing that can be taken over, and
this one is small enough to read in one sitting.

## ESM only, ES2022

Every framework this supports is ESM. A CommonJS build would double what
has to be tested for nobody. ES2022 runs in every browser that has Web
Crypto.

## One version for every package

The framework packages are thin, and a change in the core often means a
change in each. One version, released together, means `@elchi-studios/eauth-react`
1.4.0 always runs on the core it was tested with.

## The Nuxt state changes after hydration

The server does not know who is signed in and renders `loading`. Setting
the state before hydration ends is a hydration mismatch, which makes Vue
throw the server's markup away. The browser tests fail on any hydration
warning.

## "use client" in the React package

It marks the package as client code for the Next.js App Router, so
`<SignedIn>` and the others can be used from server components. Other
bundlers ignore the directive.

## A stand-in for EAuth in the tests

The tests never reach the network. The stand-in enforces what EAuth
enforces (PKCE, codes spent once, rotation), so a test that passes against
it exercises the same rules, and it runs the same on every machine.

## MIT

An authentication library has to be read and trusted before it is
embedded, and it is embedded in applications of every license, most of
them closed. The SDK is worth nothing without the service, so there is
nothing to protect by a stronger license, and any obligation on the
applications that bundle it would only keep people away from EAuth.
