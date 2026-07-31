# Supported browsers

WashQueue authentication requires both browser-native capabilities:

- Web Locks, because login, refresh rotation, and logout all mutate one shared
  HttpOnly cookie;
- BroadcastChannel, because verified login and confirmed logout must promptly
  invalidate or synchronize memory-only authentication in other same-origin
  documents.

The Version 1.3.2 qualified matrix covers:

- current stable desktop Chrome/Chromium;
- the pinned Playwright WebKit desktop engine;
- current stable mobile Chrome for general login, restoration, logout, and
  responsive-UI regression coverage.

Pull requests run a built-app, real-PostgreSQL Chromium smoke covering
simultaneous restoration, different-account switching, confirmed cross-tab
logout, and refresh-versus-logout ordering. Pushes to `main`, manual workflow
runs, and the bounded weekly schedule run the full pinned Chromium and WebKit
desktop matrix. That matrix also covers bounded restoration and account-switch
stress, near-expiration refresh, waiting-page closure, lock-holder page close
and navigation, close/reload during synchronization, and BroadcastChannel
runtime failures.

A browser is supported only when `navigator.locks.request` and
`window.BroadcastChannel` are available in a secure or local development
context and the qualified matrix passes. The reliability harness additionally
uses `navigator.locks.query` to observe deterministic queue barriers. The
release checks prove browser-document close and navigation behavior. They do
not claim operating-system process crashes, browser suspension, device sleep,
or abrupt machine loss.

When either capability is unavailable, the frontend fails closed with generic,
accessible session-coordination UI. Without Web Locks it sends no unlocked
login, refresh, or logout. Without BroadcastChannel it does not claim immediate
cross-tab identity synchronization or allow frontend authentication to
continue. There is no fallback to localStorage events or mutexes, polling,
token or user sharing, or a custom event bus.

Firefox is not in the Version 1.3.2 verified matrix and must be added through an
explicit compatibility and multi-tab release test before being advertised as
supported. Capability availability alone does not add a browser to the support
policy.
