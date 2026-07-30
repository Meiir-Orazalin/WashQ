export const authLifecycleChannelName = 'washqueue-auth-events-v1';

export type AuthLifecycleEvent =
  | {
      type: 'session-changed';
      sourceId: string;
    }
  | {
      type: 'logout';
      sourceId: string;
    };

type AuthLifecycleEventListener = (event: AuthLifecycleEvent) => void;

interface BroadcastChannelPort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

type OpenBroadcastChannel = (name: string) => BroadcastChannelPort | undefined;
type CreateSourceId = () => string;

export interface AuthLifecycleChannel {
  publishSessionChanged(): void;
  publishLogout(): void;
  subscribe(listener: AuthLifecycleEventListener): () => void;
  close(): void;
}

export function createAuthLifecycleChannel(
  openBroadcastChannel: OpenBroadcastChannel = openBrowserBroadcastChannel,
  createSourceId: CreateSourceId = createEphemeralSourceId,
): AuthLifecycleChannel | null {
  let broadcastChannel: BroadcastChannelPort | undefined;

  try {
    broadcastChannel = openBroadcastChannel(authLifecycleChannelName);
  } catch {
    return null;
  }

  if (!broadcastChannel) {
    return null;
  }
  const activeBroadcastChannel = broadcastChannel;

  let sourceId: string;
  try {
    sourceId = createSourceId();
  } catch {
    activeBroadcastChannel.close();
    return null;
  }

  if (!sourceId) {
    activeBroadcastChannel.close();
    return null;
  }

  const subscribers = new Set<AuthLifecycleEventListener>();
  let closed = false;

  function handleMessage(event: MessageEvent<unknown>) {
    if (closed || !isAuthLifecycleEvent(event.data) || event.data.sourceId === sourceId) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  }

  activeBroadcastChannel.addEventListener('message', handleMessage);

  function publish(type: AuthLifecycleEvent['type']) {
    if (closed) {
      return;
    }

    activeBroadcastChannel.postMessage({ type, sourceId } satisfies AuthLifecycleEvent);
  }

  return {
    publishSessionChanged() {
      publish('session-changed');
    },
    publishLogout() {
      publish('logout');
    },
    subscribe(listener) {
      if (closed) {
        return () => undefined;
      }

      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;
      subscribers.clear();
      activeBroadcastChannel.removeEventListener('message', handleMessage);
      activeBroadcastChannel.close();
    },
  };
}

function openBrowserBroadcastChannel(name: string): BroadcastChannelPort | undefined {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') {
    return undefined;
  }

  return new window.BroadcastChannel(name);
}

function createEphemeralSourceId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('A cryptographically random document identifier is unavailable');
  }

  return crypto.randomUUID();
}

function isAuthLifecycleEvent(value: unknown): value is AuthLifecycleEvent {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes('type') &&
    keys.includes('sourceId') &&
    (value.type === 'session-changed' || value.type === 'logout') &&
    typeof value.sourceId === 'string' &&
    value.sourceId.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
