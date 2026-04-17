import { test, expect, mock } from 'bun:test';

// Store original platform
const originalPlatform = process.platform;

// Helper to dynamically import notify module after platform mock
async function importNotifyModule() {
  // Clear the module cache to force re-evaluation
  delete require.cache?.[require.resolve('../lib/notify.js')];
  // Use dynamic import to get fresh module with current process.platform
  return import('../lib/notify.js');
}

test('Linux: systemNotify calls Bun.spawn with notify-send', async () => {
  // Mock process.platform
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    writable: true,
    configurable: true,
  });

  // Mock Bun.spawn
  const spawnMock = mock(() => null);
  const originalSpawn = Bun.spawn;
  Bun.spawn = spawnMock;

  try {
    const { systemNotify } = await importNotifyModule();
    await systemNotify({ title: 'Test Title', message: 'Test Message' });

    expect(spawnMock).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledWith(
      ['notify-send', '-u', 'normal', '-t', '10000', '-a', 'AI Gauge', 'Test Title', 'Test Message'],
      { stderr: 'ignore', stdout: 'ignore' }
    );
  } finally {
    Bun.spawn = originalSpawn;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});

test('Linux: systemNotify forwards urgency parameter', async () => {
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    writable: true,
    configurable: true,
  });

  const spawnMock = mock(() => null);
  const originalSpawn = Bun.spawn;
  Bun.spawn = spawnMock;

  try {
    const { systemNotify } = await importNotifyModule();
    await systemNotify({ title: 'Alert', message: 'Critical', urgency: 'critical' });

    expect(spawnMock).toHaveBeenCalled();
    const callArgs = spawnMock.mock.calls[0];
    expect(callArgs[0]).toContain('-u');
    expect(callArgs[0]).toContain('critical');
  } finally {
    Bun.spawn = originalSpawn;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});

test('Darwin: systemNotify does NOT call Bun.spawn', async () => {
  Object.defineProperty(process, 'platform', {
    value: 'darwin',
    writable: true,
    configurable: true,
  });

  const spawnMock = mock(() => null);
  const originalSpawn = Bun.spawn;
  Bun.spawn = spawnMock;

  try {
    const { systemNotify } = await importNotifyModule();
    await systemNotify({ title: 'Test', message: 'macOS test' });

    expect(spawnMock).not.toHaveBeenCalled();
  } finally {
    Bun.spawn = originalSpawn;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});

test('Unsupported platform: systemNotify does NOT throw', async () => {
  Object.defineProperty(process, 'platform', {
    value: 'win32',
    writable: true,
    configurable: true,
  });

  const spawnMock = mock(() => null);
  const originalSpawn = Bun.spawn;
  Bun.spawn = spawnMock;

  try {
    const { systemNotify } = await importNotifyModule();
    // Should not throw
    await expect(systemNotify({ title: 'Test', message: 'Windows' })).resolves.toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  } finally {
    Bun.spawn = originalSpawn;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});

test('NOTIFY_DELIVERY_METHOD is correct for Linux', async () => {
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    writable: true,
    configurable: true,
  });

  try {
    const { NOTIFY_DELIVERY_METHOD } = await importNotifyModule();
    expect(NOTIFY_DELIVERY_METHOD).toBe('notify-send');
  } finally {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});

test('NOTIFY_DELIVERY_METHOD is correct for Darwin', async () => {
  Object.defineProperty(process, 'platform', {
    value: 'darwin',
    writable: true,
    configurable: true,
  });

  try {
    const { NOTIFY_DELIVERY_METHOD } = await importNotifyModule();
    expect(NOTIFY_DELIVERY_METHOD).toBe('ws-broadcast');
  } finally {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});

test('NOTIFY_DELIVERY_METHOD is unsupported for unknown platform', async () => {
  Object.defineProperty(process, 'platform', {
    value: 'freebsd',
    writable: true,
    configurable: true,
  });

  try {
    const { NOTIFY_DELIVERY_METHOD } = await importNotifyModule();
    expect(NOTIFY_DELIVERY_METHOD).toBe('unsupported');
  } finally {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  }
});
