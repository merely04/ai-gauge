import { mkdir } from 'node:fs/promises';
import { renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export async function atomicWriteJSON(filePath, data, options = {}) {
  const { validate, indent } = options;
  await mkdir(dirname(filePath), { recursive: true });

  const tmp = `${filePath}.tmp`;
  const serialized = indent ? JSON.stringify(data, null, indent) : JSON.stringify(data);

  try {
    await Bun.write(tmp, serialized);
    if (validate) {
      const parsed = await Bun.file(tmp).json();
      if (!validate(parsed)) throw new Error(`atomic-write: validation failed for ${filePath}`);
    }
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}
