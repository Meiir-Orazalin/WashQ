'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application render failed', {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <main className="centered-state">
      <h1>Something went wrong</h1>
      <p>The page could not be rendered.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
