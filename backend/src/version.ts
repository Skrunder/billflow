import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Version from backend/package.json (next to both src/ and dist/); APP_VERSION overrides it. */
function packageVersion(): string | undefined {
  try {
    return (JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

export const version = process.env.APP_VERSION || packageVersion() || '0.0.0';
