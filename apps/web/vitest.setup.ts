import '@testing-library/jest-dom/vitest';

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
