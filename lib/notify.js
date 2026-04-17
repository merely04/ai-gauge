const platform = process.platform;

export const NOTIFY_DELIVERY_METHOD =
  platform === 'darwin' ? 'ws-broadcast' : platform === 'linux' ? 'notify-send' : 'unsupported';

export async function systemNotify({ title, message, urgency = 'normal' }) {
  if (platform === 'linux') {
    Bun.spawn([
      'notify-send',
      '-u', urgency,
      '-t', '10000',
      '-a', 'AI Gauge',
      title,
      message,
    ], {
      stderr: 'ignore',
      stdout: 'ignore',
    });
    return;
  }

  if (platform === 'darwin') {
    process.stderr.write('[notify] macOS: suppressed (handled by Swift client)\n');
    return;
  }

  console.warn('systemNotify: unsupported platform:', platform);
}
