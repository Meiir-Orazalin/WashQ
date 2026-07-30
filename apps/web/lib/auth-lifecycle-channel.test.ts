import { describe, expect, it, vi } from 'vitest';
import {
  authLifecycleChannelName,
  createAuthLifecycleChannel,
  type AuthLifecycleEvent,
} from './auth-lifecycle-channel';

class TestBroadcastChannel {
  readonly postedMessages: unknown[] = [];
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  close = vi.fn();
  removeEventListener = vi.fn(
    (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
      this.listeners.delete(listener);
    },
  );

  postMessage(message: unknown) {
    this.postedMessages.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.add(listener);
  }

  dispatch(data: unknown) {
    for (const listener of this.listeners) {
      listener(new MessageEvent('message', { data }));
    }
  }
}

describe('auth lifecycle channel', () => {
  it('uses the stable channel name and a different ephemeral source per document', () => {
    const openedNames: string[] = [];
    const firstSource = 'ephemeral-document-one';
    const secondSource = 'ephemeral-document-two';
    const firstBroadcastChannel = new TestBroadcastChannel();
    const secondBroadcastChannel = new TestBroadcastChannel();
    const first = createAuthLifecycleChannel(
      (name) => {
        openedNames.push(name);
        return firstBroadcastChannel;
      },
      () => firstSource,
    );
    const second = createAuthLifecycleChannel(
      (name) => {
        openedNames.push(name);
        return secondBroadcastChannel;
      },
      () => secondSource,
    );

    first?.publishSessionChanged();
    second?.publishSessionChanged();

    expect(openedNames).toEqual([authLifecycleChannelName, authLifecycleChannelName]);
    expect(firstBroadcastChannel.postedMessages).toEqual([
      { type: 'session-changed', sourceId: firstSource },
    ]);
    expect(secondBroadcastChannel.postedMessages).toEqual([
      { type: 'session-changed', sourceId: secondSource },
    ]);
    expect(firstSource).not.toBe(secondSource);
  });

  it('publishes only exact non-sensitive lifecycle payloads', () => {
    const broadcast = new TestBroadcastChannel();
    const channel = createAuthLifecycleChannel(
      () => broadcast,
      () => 'ephemeral-document-id',
    );

    channel?.publishSessionChanged();
    channel?.publishLogout();

    expect(broadcast.postedMessages).toEqual([
      { type: 'session-changed', sourceId: 'ephemeral-document-id' },
      { type: 'logout', sourceId: 'ephemeral-document-id' },
    ]);
    for (const payload of broadcast.postedMessages) {
      expect(Object.keys(payload as AuthLifecycleEvent).sort()).toEqual(['sourceId', 'type']);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(
        /access.?token|refresh.?token|cookie|email|password|user.?id|session.?id|family.?id|first.?name|last.?name/i,
      );
      expect(serialized).not.toContain('df4e7850-e329-4679-91f1-77b409d93f4f');
      expect(serialized).not.toContain('meiir@example.com');
    }
  });

  it('ignores its own and invalid events while delivering remote lifecycle events', () => {
    const broadcast = new TestBroadcastChannel();
    const channel = createAuthLifecycleChannel(
      () => broadcast,
      () => 'local-document',
    );
    const subscriber = vi.fn();
    channel?.subscribe(subscriber);

    broadcast.dispatch({ type: 'session-changed', sourceId: 'local-document' });
    broadcast.dispatch({
      type: 'session-changed',
      sourceId: 'remote-document',
      accessToken: 'must-be-rejected',
    });
    broadcast.dispatch({ type: 'unknown', sourceId: 'remote-document' });
    broadcast.dispatch({ type: 'session-changed', sourceId: 'remote-document' });
    broadcast.dispatch({ type: 'logout', sourceId: 'other-document' });

    expect(subscriber.mock.calls).toEqual([
      [{ type: 'session-changed', sourceId: 'remote-document' }],
      [{ type: 'logout', sourceId: 'other-document' }],
    ]);
  });

  it('unsubscribes and closes the browser channel during cleanup', () => {
    const broadcast = new TestBroadcastChannel();
    const channel = createAuthLifecycleChannel(
      () => broadcast,
      () => 'ephemeral-document-id',
    );
    const subscriber = vi.fn();
    const unsubscribe = channel?.subscribe(subscriber);

    unsubscribe?.();
    broadcast.dispatch({ type: 'logout', sourceId: 'remote-document' });
    channel?.close();
    channel?.close();
    channel?.publishLogout();

    expect(subscriber).not.toHaveBeenCalled();
    expect(broadcast.removeEventListener).toHaveBeenCalledTimes(1);
    expect(broadcast.close).toHaveBeenCalledTimes(1);
    expect(broadcast.postedMessages).toEqual([]);
  });

  it('handles unsupported or failed BroadcastChannel capability safely', () => {
    const opener = vi.fn().mockReturnValue(undefined);
    const sourceId = vi.fn();

    expect(createAuthLifecycleChannel(opener, sourceId)).toBeNull();
    expect(opener).toHaveBeenCalledWith(authLifecycleChannelName);
    expect(sourceId).not.toHaveBeenCalled();
    expect(
      createAuthLifecycleChannel(() => {
        throw new Error('constructor failure');
      }),
    ).toBeNull();
  });
});
