import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createLocalRepository, type LocalRepository } from './engine';
import { createSqlJsDriver, loadSnapshot, saveSnapshot } from './sqljs-driver';

/**
 * Opens the standalone engine inside a normal browser (development and the
 * "standalone" web build). The SQLite database is kept in IndexedDB; the
 * Android app replaces this with native SQLite in milestone 4.
 */
export async function openBrowserLocalRepository(): Promise<LocalRepository> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  // Ask the browser not to evict our data under storage pressure.
  await navigator.storage?.persist?.().catch(() => false);
  const driver = createSqlJsDriver(SQL, {
    data: await loadSnapshot(),
    persist: (bytes) => void saveSnapshot(bytes).catch((err) => console.error('Could not save local database', err)),
  });
  const repo = await createLocalRepository(driver, {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language || 'en-US',
  });
  // Flush pending writes when the tab is hidden or closed.
  addEventListener('pagehide', () => void repo.close());
  return repo;
}
