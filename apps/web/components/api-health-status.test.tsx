import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiHealthStatus } from './api-health-status';

function renderStatus() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <ApiHealthStatus />
    </QueryClientProvider>,
  );
}

describe('ApiHealthStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a checking state while the health request is pending', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined)),
    );

    renderStatus();

    expect(screen.getByText('Checking')).toBeInTheDocument();
  });

  it('shows an available state for a contract-valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'washqueue-api',
            timestamp: '2026-07-23T12:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );

    renderStatus();

    expect(await screen.findByText('Available')).toBeInTheDocument();
  });

  it('shows an unavailable state for an invalid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: 'unknown' }), { status: 200 })),
    );

    renderStatus();

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
  });
});
