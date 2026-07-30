import '@testing-library/jest-dom/vitest';

if (!window.BroadcastChannel) {
  class TestBroadcastChannel {
    constructor(readonly name: string) {}

    postMessage(_message: unknown) {
      return undefined;
    }

    addEventListener(_type: 'message', _listener: (event: MessageEvent<unknown>) => void) {
      return undefined;
    }

    removeEventListener(_type: 'message', _listener: (event: MessageEvent<unknown>) => void) {
      return undefined;
    }

    close() {
      return undefined;
    }
  }

  Object.defineProperty(window, 'BroadcastChannel', {
    configurable: true,
    value: TestBroadcastChannel,
  });
}

if (!navigator.locks) {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async <T>(
        _name: string,
        _options: { mode: 'exclusive' },
        callback: () => Promise<T>,
      ): Promise<T> => callback(),
    },
  });
}
