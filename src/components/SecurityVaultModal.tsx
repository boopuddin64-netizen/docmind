import React, { useState } from 'react';
import { Reminder, SecuritySettings } from '../types';
import { autoPurgeOldDocuments } from '../lib/securityVault';
import { Shield, Lock, Key, Users, Trash2, CheckCircle2, History, X, Sparkles, HardDrive } from 'lucide-react';

interface SecurityVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  securitySettings: SecuritySettings;
  onUpdateSecuritySettings: (updated: SecuritySettings) => void;
  reminders: Reminder[];
  onPurgeOldScans: (cleanedReminders: Reminder[], purgedCount: number) => void;
}

export const SecurityVaultModal: React.FC<SecurityVaultModalProps> = ({
  isOpen,
  onClose,
  securitySettings,
  onUpdateSecuritySettings,
  reminders,
  onPurgeOldScans,
}) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'vault' | 'logs'>('vault');

  const handleToggleEncryption = () => {
    onUpdateSecuritySettings({
      ...securitySettings,
      endToEndEncryption: !securitySettings.endToEndEncryption,
    });
  };

  const handleVaultTenantChange = (vault: 'personal' | 'household') => {
    onUpdateSecuritySettings({
      ...securitySettings,
      activeVault: vault,
    });
  };

  const handlePurgeNow = () => {
    const { cleanedReminders, purgedCount } = autoPurgeOldDocuments(
      reminders,
      securitySettings.autoPurgeDays
    );
    onPurgeOldScans(cleanedReminders, purgedCount);
  };

  // Collect all audit logs across reminders
  const allLogs = reminders
    .flatMap((r) => r.auditLogs || [])
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#0c1e2e] w-full max-w-md rounded-2xl shadow-2xl border border-sky-900/20 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-[#0284c7] text-white p-4 flex items-center justify-between border-b border-sky-700/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 border border-white/30 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Security & Privacy Controls</h3>
              <p className="text-[11px] text-sky-100/90">Private Document Storage & Safety</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-sky-100/80 hover:text-white hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-sky-900/40 bg-slate-50 dark:bg-[#07131e]">
          <button
            type="button"
            onClick={() => setActiveTab('vault')}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'vault'
                ? 'border-[#0284c7] text-[#0284c7] dark:text-sky-300 bg-white dark:bg-[#0c1e2e]'
                : 'border-transparent text-slate-500 dark:text-sky-300/60 hover:text-slate-700'
            }`}
          >
            <Lock className="w-3.5 h-3.5" /> Security Controls
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'logs'
                ? 'border-[#0284c7] text-[#0284c7] dark:text-sky-300 bg-white dark:bg-[#0c1e2e]'
                : 'border-transparent text-slate-500 dark:text-sky-300/60 hover:text-slate-700'
            }`}
          >
            <History className="w-3.5 h-3.5" /> Activity Log ({allLogs.length})
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs text-slate-700 dark:text-slate-200">
          {activeTab === 'vault' ? (
            <>
              {/* E2E Encryption Toggle */}
              <div className="p-3 bg-sky-50 dark:bg-sky-950/40 rounded-xl border border-sky-200 dark:border-sky-800/40 flex items-center justify-between">
                <div>
                  <div className="font-bold text-[#0369a1] dark:text-sky-200 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-[#0284c7]" /> Private Device Protection
                  </div>
                  <p className="text-[11px] text-[#0369a1] dark:text-sky-300/80 mt-0.5">
                    {securitySettings.endToEndEncryption
                      ? 'Active: Your uploaded documents and details are locked securely on your device'
                      : 'Disabled: Standard storage'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleEncryption}
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                    securitySettings.endToEndEncryption ? 'bg-[#0284c7]' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      securitySettings.endToEndEncryption ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Multi-tenant Household Data Isolation */}
              <div className="space-y-1.5">
                <label className="font-bold flex items-center gap-1.5 text-slate-800 dark:text-sky-200">
                  <Users className="w-3.5 h-3.5 text-[#0284c7]" /> Who Can View These Documents?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleVaultTenantChange('personal')}
                    className={`p-2.5 rounded-xl border font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                      securitySettings.activeVault === 'personal'
                        ? 'bg-[#0284c7] text-white border-sky-500 shadow-sm'
                        : 'bg-slate-50 dark:bg-[#07131e] text-slate-700 dark:text-sky-300 border-slate-200 dark:border-sky-900/40'
                    }`}
                  >
                    <span>Just Me</span>
                    <span className="text-[10px] font-normal opacity-80">Private to my account only</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVaultTenantChange('household')}
                    className={`p-2.5 rounded-xl border font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                      securitySettings.activeVault === 'household'
                        ? 'bg-[#0284c7] text-white border-sky-500 shadow-sm'
                        : 'bg-slate-50 dark:bg-[#07131e] text-slate-700 dark:text-sky-300 border-slate-200 dark:border-sky-900/40'
                    }`}
                  >
                    <span>Family Vault</span>
                    <span className="text-[10px] font-normal opacity-80">Shared with family members</span>
                  </button>
                </div>
              </div>

              {/* Auto Purge Settings */}
              <div className="space-y-1.5">
                <label className="font-bold flex items-center gap-1.5 text-slate-800 dark:text-sky-200">
                  <HardDrive className="w-3.5 h-3.5 text-[#0284c7]" /> Auto-Clean Scanned Images
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={securitySettings.autoPurgeDays}
                    onChange={(e) =>
                      onUpdateSecuritySettings({
                        ...securitySettings,
                        autoPurgeDays: Number(e.target.value),
                      })
                    }
                    className="flex-1 p-2 rounded-xl border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none"
                  >
                    <option value={30}>Clean document images after 30 days</option>
                    <option value={90}>Clean document images after 90 days</option>
                    <option value={0}>Keep document images saved indefinitely</option>
                  </select>
                  <button
                    type="button"
                    onClick={handlePurgeNow}
                    className="px-3 py-2 bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold text-xs rounded-xl hover:bg-rose-200 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clean Now
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Audit Logs View */
            <div className="space-y-2">
              {allLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  <History className="w-8 h-8 mx-auto mb-1 opacity-50 text-[#0284c7]" />
                  <p>No activity recorded yet.</p>
                </div>
              ) : (
                allLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 bg-slate-50 dark:bg-[#07131e] border border-slate-200 dark:border-sky-900/40 rounded-xl text-[11px]"
                  >
                    <div className="flex items-center justify-between font-bold text-slate-800 dark:text-sky-200">
                      <span>{log.action}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-sky-300/80 mt-0.5">{log.details}</p>
                    <span className="text-[9px] text-[#0284c7] dark:text-sky-400 font-mono block mt-1">
                      By: {log.actor.replace('DocuMind System', 'DocuMind Assistant')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 dark:bg-[#07131e] border-t border-slate-200 dark:border-sky-900/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0284c7] text-white font-bold text-xs rounded-xl hover:bg-[#0369a1]"
          >
            Close Vault
          </button>
        </div>
      </div>
    </div>
  );
};
