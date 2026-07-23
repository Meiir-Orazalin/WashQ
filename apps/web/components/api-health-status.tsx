'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchApiHealth } from '@/lib/api-client';

export function ApiHealthStatus() {
  const health = useQuery({
    queryKey: ['api-health'],
    queryFn: ({ signal }) => fetchApiHealth(signal),
    refetchInterval: 30_000,
  });

  if (health.isPending) {
    return <Status label="Checking" tone="pending" detail="Contacting the backend API" />;
  }

  if (health.isError) {
    return (
      <Status
        label="Unavailable"
        tone="error"
        detail="The API health endpoint could not be verified"
      />
    );
  }

  return (
    <Status
      label="Available"
      tone="success"
      detail={`Verified at ${new Date(health.data.timestamp).toLocaleTimeString()}`}
    />
  );
}

interface StatusProps {
  label: string;
  tone: 'success' | 'pending' | 'error';
  detail: string;
}

function Status({ label, tone, detail }: StatusProps) {
  return (
    <div className="status-row" role="status" aria-live="polite">
      <span className={`status-indicator status-indicator--${tone}`} aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}
