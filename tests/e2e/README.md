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

Keep tests self-contained. Opt large files into parallel mode with
`test.describe.configure({ mode: "parallel" })` only when their setup and output
paths are independent. Account for `beforeAll` and `afterAll` running separately for
every parallel test.

Use `test.use({ viewerMap: "route-only" })` when a scenario does not exercise
basemap styles or providers. This keeps real MapLibre maps and local overlays;
map integration tests must retain the default. Export maps remain independent.

Use reduced motion for data and control assertions; keep normal motion when
testing transitions and layout stability.

A test that passes only after a retry still fails the run. Keep `failOnFlakyTests`
enabled in [the e2e config](../playwright.e2e.config.ts); use retry traces to
diagnose failures.
