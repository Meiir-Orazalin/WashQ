# Supported browsers

WashQueue authentication requires the browser-native Web Locks API because
login, refresh rotation, and logout all mutate one shared HttpOnly cookie.

The Version 1.2 release matrix covers:

- current stable desktop Chrome/Chromium;
- the pinned Playwright WebKit desktop engine;
- current stable mobile Chrome for general login, restoration, logout, and
  responsive-UI regression coverage.

Desktop Chromium and WebKit run the real two-page, shared-cookie-jar
coordination suite. A browser is supported only when `navigator.locks.request`
is available in a secure or local development context and the release matrix
passes.

When Web Locks are unavailable, the frontend fails closed with generic session
coordination UI. It does not send login, refresh, or logout, and does not fall
back to an unlocked request, localStorage mutex, token sharing, or
BroadcastChannel lease. Firefox is not in the Version 1.2 verified matrix and
must be added through an explicit compatibility test before being advertised
as supported.
