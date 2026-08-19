# Sparkle CLI releases

This document describes how to release a new version of Sparkle CLI. Every
release is a stable release; there are no nightly or preview channels.

## Versioning

Sparkle CLI follows [Semantic Versioning](https://semver.org/):

- **Major:** Breaking changes.
- **Minor:** New features.
- **Patch:** Bug fixes.

## Release flow

Releasing a new version involves building the packages, publishing to npm, and
creating a GitHub release:

1.  **Preflight:** Run `npm run preflight` to run tests, linting, and
    type-checking. All checks must pass.
2.  **Bump the version:** Update the `version` in `packages/cli/package.json`
    (and `packages/core/package.json` if the core package changed) to the new
    release version.
3.  **Build and test:** Run `npm run build` and the relevant test suites.
4.  **Publish to npm:** Run `npm publish` in the changed packages, or use
    `npm run build:packages` first and then publish each package.
5.  **Create the GitHub release:** Attach the bundled single-file executable and
    the `bundle/` assets to a GitHub release. This enables
    `npx https://github.com/krrr/sparkle-cli`.

## Build artifacts

The release process creates two artifacts:

- **npm:** Standard, un-bundled Node.js packages. `sparkle-cli` depends on
  `sparkle-cli-core`.
- **GitHub release:** A single, bundled `sparkle.js` executable that contains
  all dependencies, enabling `npx https://github.com/krrr/sparkle-cli`.

To build the bundled executable locally:

```bash
npm run bundle       # Assembles bundle/ with sparkle.js and assets
npm run build:binary # Builds the single-file executable with Node SEA
```

The bundle is assembled by esbuild from the compiled `packages/core/dist` and
`packages/cli/dist`, excluding native binaries like `node-pty`. The bundle
directory also includes the sandbox profiles, `README.md`, and `LICENSE`.

The sandbox Docker image is published as part of the release pipeline.

## Release validation

After publishing, verify the packages work as expected:

- `npx -y sparkle-cli@latest --version` to confirm the npm push worked.
- `node ./bundle/sparkle.js --version` to confirm the bundle works.
- Smoke test a basic run with a few LLM commands and tools.

## Rollback

To revert a broken release, publish the previous version as a new patch release.
npm tags are mutable, so you can also point the `latest` tag back at the
previous version with `npm dist-tag add sparkle-cli@<previous-version> latest`.
