/** Everything DocuMind keeps in localStorage. "Reset App Data" must clear all of it. */
import { FIRED_STORAGE_KEY } from './alertScheduler';
import { disablePersistence, listStateKeys } from './persistedState';

export const RESET_STORAGE_KEYS = [
  'docreminder_items',
  'docreminder_profile',
  'docreminder_darkmode',
  'docreminder_notifications',
  FIRED_STORAGE_KEY,
  'docmind_push_sub_v1',
] as const;

export function clearAppStorage(storage: Pick<Storage, 'removeItem'> & Partial<Pick<Storage, 'length' | 'key'>>): void {
  // The page is about to reload: stop the UI-state layer (pagehide flush!) from writing anything back.
  disablePersistence();
  // UI snapshot + form drafts live under one prefix (docmind_ui:*): collect first, then remove (indexes shift while removing).
  const dynamic = listStateKeys(storage as Pick<Storage, 'length' | 'key'>);
  for (const k of [...RESET_STORAGE_KEYS, ...dynamic]) {
    try { storage.removeItem(k); } catch { /* ignore */ }
  }
}

/**
 * Full reset: stop pushes first (server subscription + browser subscription), then wipe local data and the
 * service worker's "already fired" marker cache. `disable` is injected so this stays testable.
 */
export async function resetAppData(
  disable: () => Promise<void>,
  storage: Pick<Storage, 'removeItem'> & Partial<Pick<Storage, 'length' | 'key'>>,
  opts: { timeoutMs?: number; clearFiredCache?: () => Promise<void> } = {},
): Promise<void> {
  try {
    await Promise.race([
      disable(),
      new Promise<void>((r) => setTimeout(r, opts.timeoutMs ?? 5000)), // never block the reset on a slow network
    ]);
  } catch { /* still reset local data */ }
  clearAppStorage(storage);
  try { await opts.clearFiredCache?.(); } catch { /* ignore */ }
}
