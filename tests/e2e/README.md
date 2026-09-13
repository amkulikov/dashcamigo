# E2E regression tests

Run `npm run test:e2e` from the repository root. It builds the app before testing.
For browser installation, see [the CI workflow](../../.github/workflows/ci.yml).

Import `test` and `expect` from [`_fixtures.ts`](_fixtures.ts) to retain the shared
runtime-error and network checks. For File System Access tests that persist OPFS
handles in IndexedDB, import `persistentTest as test` from the same module. Keep
each test's temporary browser profile isolated, and exercise real handles.
That fixture reports an unaffected Chromium version to exercise durable storage.
Keep crash-workaround coverage in the default incognito fixture with the real
browser identity, as in [`file-handle-compat.spec.ts`](file-handle-compat.spec.ts).

A test that passes only after a retry still fails the run. Keep `failOnFlakyTests`
enabled in [the e2e config](../playwright.e2e.config.ts); use retry traces to
diagnose failures.
