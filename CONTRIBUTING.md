# Contributing

Thank you for looking. A few things keep this repository easy to work in.

## Before a pull request

- `npm run check` passes. It builds every package, typechecks, runs every
  test and checks the tarballs npm would publish. The browser tests need
  Chromium once: `npx playwright-core install chromium`, or point
  `CHROMIUM_PATH` at one you have.
- A change to the core comes with a test in `packages/eauth/test`, against
  the stand-in browser and server there. A change to what a page does in
  the browser comes with a case in the Chromium tests.
- Commits are small and say what changed and why, in plain English.
  Squash the fixups.

## What fits

- Anything EAuth offers that the packages do not expose yet.
- Fixes, of course, with the case that showed them.
- A package for another framework, built the way the others are: a thin
  bridge to the core, safe during server rendering, with tests.

## What does not

- Dependencies in the core. It needs Web Crypto and `fetch` and nothing
  else, and it stays that way.
- Anything that keeps a token somewhere a script can read it without the
  application having asked for `storage: "local"`.
- Client secrets, the implicit flow and the password grant.

## Releasing

The packages are released together, with one version.

```bash
node scripts/version.mjs 1.1.0   # every version, and the ranges between the packages
npm install                      # the lockfile
```

Add a `## 1.1.0` section to `CHANGELOG.md`, commit, and push the tag
`v1.1.0` on its own. The release workflow checks everything again,
publishes to npm with provenance and creates the GitHub release from the
changelog.

## License

MIT. A contribution is under the same license.
