# Supported browsers

WashQueue authentication requires both browser-native capabilities:

- Web Locks, because login, refresh rotation, and logout all mutate one shared
  HttpOnly cookie;
- BroadcastChannel, because verified login and confirmed logout must promptly
  invalidate or synchronize memory-only authentication in other same-origin
  documents.

The Version 1.3.1 release matrix covers:

- current stable desktop Chrome/Chromium;
- the pinned Playwright WebKit desktop engine;
- current stable mobile Chrome for general login, restoration, logout, and
  responsive-UI regression coverage.

Desktop Chromium and WebKit run the real two-page, shared-cookie-jar
coordination and lifecycle-event suites, including same-user login,
different-user switching, logout, and repeated stress. A browser is supported
only when `navigator.locks.request` and `window.BroadcastChannel` are available
in a secure or local development context and the release matrix passes.

When either capability is unavailable, the frontend fails closed with generic,
accessible session-coordination UI. Without Web Locks it sends no unlocked
login, refresh, or logout. Without BroadcastChannel it does not claim immediate
cross-tab identity synchronization or allow frontend authentication to
continue. There is no fallback to localStorage events or mutexes, polling,
token or user sharing, or a custom event bus.

Firefox is not in the Version 1.3.1 verified matrix and must be added through an
explicit compatibility and multi-tab release test before being advertised as
supported. Capability availability alone does not add a browser to the support
policy.
