# Release confidence checklist

This document is a quality gate for releasing a new version of Sparkle CLI. It
answers the question, "Is this release ready?" with a mix of automated checks
and manual verification.

## Level 1: Automated gates (must pass)

If any of these fail, the release is a no-go.

### CI/CD health

All workflows in `.github/workflows/ci.yml` must pass on the `main` branch:

- **Platforms:** Tests must pass on **Linux and macOS**.
- **Checks:**
  - **Linting:** No linting errors (ESLint, Prettier, etc.).
  - **Typechecking:** No TypeScript errors.
  - **Unit tests:** All unit tests in `packages/core` and `packages/cli` must
    pass.
  - **Build:** The project must build and bundle successfully.

### End-to-end (E2E) tests

All workflows in `.github/workflows/chained_e2e.yml` must pass.

- **Platforms:** **Linux, macOS and Windows**.
- **Sandboxing:** Tests must pass with both `sandbox:none` and `sandbox:docker`
  on Linux.

### Post-deployment smoke test

After a release is published to npm, the `smoke-test.yml` workflow runs. It must
pass to confirm the package is installable and the binary is executable.

- **Command:** `npx -y sparkle-cli@latest --version` must return the correct
  version without error.
- **Platform:** Currently runs on `ubuntu-latest`.

## Level 2: Manual verification

Automated tests cannot catch everything, especially UX issues. Before releasing,
run through this checklist on the release candidate:

- **Setup:**

  - [ ] Install the release candidate: `npm install -g sparkle-cli@<version>`
  - [ ] Verify the version: `sparkle --version`

- **Authentication:**

  - [ ] In interactive mode, run `/auth` and verify the sign-in flow works:
    - [ ] API Key

- **Basic prompting:**

  - [ ] Run `sparkle "Tell me a joke"` and verify a sensible response.
  - [ ] Run in interactive mode with `sparkle`. Ask a follow-up question to test
        context.

- **Piped input:**

  - [ ] Run `echo "Summarize this" | sparkle` and verify it processes stdin.

- **Context management:**

  - [ ] In interactive mode, use `@file` to add a local file to context. Ask a
        question about it.

- **Settings:**

  - [ ] In interactive mode, run `/settings` and make modifications.
  - [ ] Validate that the setting is changed.

- **Function calling:**

  - [ ] In interactive mode, ask sparkle to "create a file named hello.md with
        the content 'hello world'" and verify the file is created correctly.

If any of these checks fail, fix the issue and cut a new patch release before
shipping.

## The "go/no-go" decision

1.  [ ] **Level 1:** CI and E2E workflows are green for the release commit.
2.  [ ] **Level 2:** The manual verification checklist has been completed with
        no blocking issues.

If all checks pass, proceed with the release.
