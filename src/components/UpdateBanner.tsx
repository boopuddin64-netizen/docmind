import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { SW_UPDATE_EVENT, type SwUpdateDetail } from '../lib/swRegister';

/** Small, non-blocking "Update available" prompt. Never reloads by itself; the tap on Refresh is the only trigger. */
export const UpdateBanner: React.FC = () => {
  const [update, setUpdate] = useState<SwUpdateDetail | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setUpdate((e as CustomEvent<SwUpdateDetail>).detail);
    window.addEventListener(SW_UPDATE_EVENT, on);
    return () => window.removeEventListener(SW_UPDATE_EVENT, on);
  }, []);

  if (!update) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[55] w-[92vw] max-w-sm bg-white dark:bg-[#0c1e2e] text-[#191c1d] dark:text-sky-100 border border-[#bae6fd] dark:border-sky-800 rounded-2xl shadow-xl px-3 py-2 flex items-center gap-2 text-xs"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
      id="update-banner"
    >
      <RefreshCw className="w-4 h-4 shrink-0 text-[#0284c7] dark:text-sky-300" aria-hidden="true" />
      <span className="flex-1 font-semibold">Update available. It will also apply next time you open the app.</span>
      <button
        type="button"
        disabled={applying}
        onClick={() => { setApplying(true); update.apply(); }}
        className="px-3 py-1.5 rounded-full bg-[#0284c7] text-white font-extrabold hover:bg-[#0369a1] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        id="btn-update-refresh"
      >
        {applying ? 'Updating…' : 'Refresh'}
      </button>
      <button type="button" onClick={() => setUpdate(null)} aria-label="Dismiss update notice" className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-sky-900/40">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
