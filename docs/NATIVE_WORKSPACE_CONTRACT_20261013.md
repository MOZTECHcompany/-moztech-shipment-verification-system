# WMS native workspace contract

The standalone WMS and the ERP native workspace render the same `App` route tree and existing workflow components. Native mode uses a separate React 18 root, a MemoryRouter and a ShadowRoot. The ERP owns its page, navigation and identity selection. WMS's standalone sidebar, header and logout controls are absent in native mode.

## Release artifact

`GET /workspace-manifest.json` returns `{version:1,entry,styles,portalStyles,sourceCommit}`. The entry, Shadow CSS and scoped portal CSS use immutable hashed `/assets/` paths. The manifest is not cached. Only public static assets allow CORS `*`; API authorization and its exact origin policy are unchanged. Cloud Build passes the packaged full Git SHA as `VITE_SOURCE_COMMIT`; the imported SDK rejects a manifest whose source SHA differs from its compiled SHA. Local builds identify themselves as `development`.

The ERP fetches one manifest from its configured exact WMS origin, validates the asset paths, imports that manifest's entry and passes the same manifest to the SDK. It must not fetch a second manifest between import and mount. Lazy chunks contain JavaScript only; all WMS styles are loaded into the ShadowRoot. SweetAlert and modal libraries use an owned light-DOM portal with a fully scoped theme. Disposing the SDK removes its portal and style links.

SweetAlert retains its official headless public class and React extension. The locked 11.22.0 build schedules an initial textarea measurement that can run after a host has removed its prompt. A narrowly checked build/prebundle transform skips only this detached-node measurement and fails closed if the dependency's single source marker changes. Native prompt close transitions are disabled in its scoped theme so the library cannot wait forever for a WMS preflight transition with no changing property. Normal input validation and preConfirm actions are preserved.

## Host API

```js
const sdk = await import(wmsOrigin + manifest.entry);
const handle = await sdk.mountWorkspace(container, {
  manifest,
  session: { user, accessToken, destination },
  initialPath: '/admin/marketplace-converter?batch=42&view=return#batch-detail',
  assetOrigin: wmsOrigin,
  socketOrigin: wmsOrigin,
  signal: bootstrapAbortController.signal,
  transport: async axiosConfig => axiosResponse,
  navigate: (path, { replace }) => updateErpWarehouseUrl(path, { replace }),
  onAuthRequired: reason => requireWarehouseIdentity(reason),
  onReload: () => reconnectUsingFreshManifestAndSession(),
  download: async ({ id, kind }) => ({ data: blob, headers }),
});
handle.navigate('/tasks?group=pick', { replace: true });
handle.dispose();
```

`session` must come from the server's ticket exchange. Its user contains numeric WMS `id`, current `role`, immutable ERP `erpSubject`, `entityId`, permissions and management scope. It is not constructed from client role choices. Only one native mount may exist at a time. Dispose before changing actor, company, role or workspace entry, and on ERP unmount. Existing per-tab `wms_user`/`wms_token` and durable command journals continue to guard the original workflows. Dispose clears the workspace's own credentials, aborts pending transport calls, disconnects Socket.IO and clears query state. A newer actor's credentials are never erased by a stale session lease.

Pass an AbortSignal for bootstrap and mount ownership. Aborting during stylesheet loading disposes synchronously, releases the mount lease, rejects with `AbortError`, and prevents late session seeding or rendering. This permits immediate actor/company replacement while the old CSS request is still pending.

`transport` receives the complete Axios request config after Axios body transforms. JSON bodies may be strings; FormData remains FormData. Preserve method, path/query, body, response type, headers, cancellation signal, timeout and status. The ERP adds its own JWT plus `x-wms-session` containing the original WMS bearer value when calling its same-origin BFF. Return `{data,status,statusText,headers}` and reject failures with Axios-like `error.response`. Do not retry or change mutation bodies in the adapter. The existing workflow's durable command retry rules remain in the WMS components.

The marketplace `download({id,kind})` host method completes the server's existing scoped-cookie download flow through the BFF and returns a Blob and response headers. Other attachment/report calls already use the generic Axios Blob transport. No token, nonce or ticket appears in a URL.

`navigate` reports inner PUSH with `replace:false` and inner REPLACE/POP with `replace:true`. Initial path notification is suppressed. External `handle.navigate` defaults to replace and suppresses the resulting echo. All original batch, order, return, exception and print link context stays in MemoryRouter; native links do not navigate the ERP browser. `onAuthRequired` fires once per mount and immediately disables the session; it does not perform an ERP logout or reload.

The optional `onReload` callback handles an explicit user reconnect after a component or stale lazy-chunk load error. The host disposes the old workspace, fetches a fresh manifest and session, and imports that release's SDK. It must not replay a mutation. Without this callback the SDK remounts its current route and clears query state. A WMS release may remove older chunk files; active older workspaces can therefore need this reconnect even though asset filenames are immutable.

## Socket and workflow boundary

The SDK initializes its Socket.IO origin before rendering children and never carries an old token to another origin. WMS admits the configured exact `ERP_PORTAL_ORIGIN` for Socket.IO only when ERP SSO is enabled; `allowRequest` also checks WebSocket origins. The existing bearer handshake, ERP session inspection, role/scope checks and expiry guards remain active.

Before a paired DEV release, preserve the currently configured WMS CORS origins and add the canonical WMS DEV origin explicitly. The inspected value contains `https://corely-wms-dev-249593319772.asia-east1.run.app` and `https://carton-0fdd2b6---corely-wms-dev-sp5g377smq-de.a.run.app`; it must also contain `https://corely-wms-dev-sp5g377smq-de.a.run.app`. The new WebSocket origin guard would otherwise reject standalone clients from that canonical origin. Set the exact canonical ERP DEV origin in `ERP_PORTAL_ORIGIN` and enable ERP SSO for the ERP native connection. Do not accept arbitrary origins or derive trusted origins from a request Host header. This is a release prerequisite; these configuration values were not changed by the local implementation.

Native mode includes the existing converter, saved batches, ECOUNT return, print/prepick, pick/pack, exceptions, cartons, comments and related reports/settings according to current server permissions. This UI integration does not substitute a Corely accounting receipt for the ECOUNT workflow, and it does not implement the unused `corely_native_intakes` schema. Server state transitions, inventory boundaries, source identities, money/barcode reviews, command UUIDs, expected state and carton content revisions remain owned by the existing WMS services.

## Verification

Run `npm test` and `npm run build` in `frontend`, and the backend runtime/auth/socket unit suites. `frontend/tests/nativeWorkspace.browser.cjs` accepts an optional installed Playwright module path, serves the built SDK and a fake ERP host on loopback, and uses only synthetic in-memory API/socket responses. It checks real dialogs and validation, one synthetic deletion request plus one print receipt, native navigation, ERP style isolation, print-frame product/order barcodes, portal cleanup, bootstrap cancellation, manifest mismatch, remount and in-place session expiration. No real service or order is called.
