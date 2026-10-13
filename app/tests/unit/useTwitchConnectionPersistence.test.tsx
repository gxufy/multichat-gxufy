import { useState } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_MULTICHAT_RUNTIME,
  type MultichatRuntime,
} from '@/features/multichat/runtime';
import { useTwitchConnection } from '@/features/multichat/useTwitchConnection';
import { readStoredConnection } from '@/lib/workspaceStorage';

const ID = '123e4567-e89b-12d3-a456-426614174000';

function Harness() {
  const [runtime, setRuntime] = useState<MultichatRuntime>(
    EMPTY_MULTICHAT_RUNTIME,
  );

  useTwitchConnection(runtime, setRuntime);

  return (
    <div
      data-testid="runtime"
      data-connection-id={runtime.connectionId}
      data-connected-login={runtime.connectedLogin}
    />
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/multichat');
});

describe('Twitch generator connection persistence', () => {
  it('re-adopts the stored Twitch connection after a remount', async () => {
    window.history.replaceState(
      {},
      '',
      `/multichat#twitchConnectionId=${ID}&twitch=Streamer`,
    );

    const first = render(<Harness />);

    await waitFor(() => {
      expect(
        first.getByTestId('runtime').getAttribute('data-connection-id'),
      ).toBe(ID);
    });

    expect(
      first.getByTestId('runtime').getAttribute('data-connected-login'),
    ).toBe('streamer');

    expect(window.location.hash).toBe('');

    expect(readStoredConnection()).toEqual({
      connectionId: ID,
      login: 'streamer',
    });

    first.unmount();

    // Equivalent to a browser reload: component state starts empty again,
    // while this tab's sessionStorage survives.
    window.history.replaceState({}, '', '/multichat');

    const second = render(<Harness />);

    await waitFor(() => {
      expect(
        second.getByTestId('runtime').getAttribute('data-connection-id'),
      ).toBe(ID);
    });

    expect(
      second.getByTestId('runtime').getAttribute('data-connected-login'),
    ).toBe('streamer');

    expect(readStoredConnection()).toEqual({
      connectionId: ID,
      login: 'streamer',
    });
  });
});
