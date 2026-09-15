import React, { useState, useRef } from 'react';
import {
  ShieldAlert,
  Download,
  Upload,
  RotateCcw,
  X,
  CheckCircle2,
  Lock,
  FileCheck,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Database,
} from 'lucide-react';
import { Reminder, UserProfile } from '../types';
import { encryptVaultData, decryptVaultData } from '../lib/securityVault';

interface ResetAndBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  reminders: Reminder[];
  userProfile: UserProfile;
  onConfirmReset: () => void;
  onRestoreBackup?: (restoredReminders: Reminder[], restoredProfile?: UserProfile) => void;
}

export const ResetAndBackupModal: React.FC<ResetAndBackupModalProps> = ({
  isOpen,
  onClose,
  reminders,
  userProfile,
  onConfirmReset,
  onRestoreBackup,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [isRestoreSuccess, setIsRestoreSuccess] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Encrypted Backup Download Handler
  const handleDownloadEncryptedBackup = () => {
    try {
      const backupPayload = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        reminders,
        userProfile,
      };

      const jsonStr = JSON.stringify(backupPayload);
      const encryptedData = encryptVaultData(jsonStr, 'DOCMIND-VAULT-256');

      const blob = new Blob([encryptedData], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const formattedDate = new Date().toISOString().split('T')[0];
      const filename = `DocuMind_Encrypted_Backup_${formattedDate}.dmback.json`;

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setBackupDownloaded(true);
    } catch (err: any) {
      alert(`Failed to generate encrypted backup: ${err.message}`);
    }
  };

  // Encrypted Backup Import/Restore Handler
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreError(null);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        let rawContent = (event.target?.result as string) || '';
        // Remove UTF-8 BOM if present
        if (rawContent.charCodeAt(0) === 0xFEFF) {
          rawContent = rawContent.slice(1);
        }
        rawContent = rawContent.trim();

        if (!rawContent) throw new Error("Empty backup file");

        let decryptedJson = '';
        try {
          // Attempt vault decryption
          decryptedJson = decryptVaultData(rawContent, 'DOCMIND-VAULT-256');
        } catch {
          // Fallback if unencrypted raw json
          decryptedJson = rawContent;
        }

        const cleanJson = decryptedJson.trim();
        const data = JSON.parse(cleanJson);

        let targetReminders: Reminder[] = [];
        let targetProfile: UserProfile | undefined = undefined;

        if (Array.isArray(data)) {
          targetReminders = data;
        } else if (data && typeof data === 'object') {
          if (Array.isArray(data.reminders)) {
            targetReminders = data.reminders;
            targetProfile = data.userProfile;
          } else if (Array.isArray(data.items)) {
            targetReminders = data.items;
            targetProfile = data.profile;
          }
        }

        if (targetReminders && onRestoreBackup) {
          onRestoreBackup(targetReminders, targetProfile);
          setIsRestoreSuccess(true);
          setTimeout(() => {
            onClose();
            window.location.reload();
          }, 1200);
        } else {
          throw new Error("Invalid backup structure");
        }
      } catch (err: any) {
        console.error("Mobile backup import failed:", err);
        setRestoreError("Unable to read backup file. Please select a valid DocuMind backup (.dmback or .json).");
      } finally {
        e.target.value = '';
      }
    };

    reader.onerror = () => {
      setRestoreError("Error reading backup file on this device.");
      e.target.value = '';
    };

    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 bg-[#f8fafb] dark:bg-[#07131e] border-b border-[#e1e3e4] dark:border-sky-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#191c1d] dark:text-white">
                Data Protection & Reset Center
              </h2>
              <p className="text-[11px] text-[#707975] dark:text-sky-300/70">
                Step {step} of 2 — {step === 1 ? 'Encrypted Backup Option' : 'Final Authorization'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-sky-900/40 text-slate-500 hover:text-slate-800 dark:text-sky-300 flex items-center justify-center transition-colors"
            id="btn-close-reset-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Indicator Bar */}
        <div className="w-full bg-slate-100 dark:bg-sky-950 h-1.5 flex">
          <div
            className="bg-[#0284c7] h-full transition-all duration-300"
            style={{ width: step === 1 ? '50%' : '100%' }}
          />
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {step === 1 ? (
            /* STEP 1: ENCRYPTED BACKUP & RESTORE */
            <div key="reset-step-1" className="space-y-5 animate-in fade-in duration-150">
              <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-100 dark:border-sky-900/60 p-4 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#0284c7] dark:text-sky-300 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h3 className="font-bold text-[#0284c7] dark:text-sky-200">
                    AES-256 Encrypted Local Backup
                  </h3>
                  <p className="text-[#3f4945] dark:text-sky-300/80 leading-relaxed">
                    Protecting your healthcare & life data is our top priority. Before resetting your local database, download an encrypted backup file to safely restore your data later.
                  </p>
                </div>
              </div>

              {/* Data Summary Card */}
              <div className="bg-[#f8fafb] dark:bg-[#07131e] p-4 rounded-2xl border border-[#e1e3e4] dark:border-sky-900/40 space-y-2">
                <span className="text-[10px] font-bold text-[#707975] dark:text-sky-300/70 uppercase tracking-wider block">
                  Current Data Summary
                </span>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-white dark:bg-[#0c1e2e] p-2.5 rounded-xl border border-[#e1e3e4] dark:border-sky-900/30 flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#0284c7]" />
                    <div>
                      <span className="font-bold block text-[#191c1d] dark:text-white">
                        {reminders.length} Items
                      </span>
                      <span className="text-[10px] text-[#707975] dark:text-sky-300/70">
                        Reminders & Documents
                      </span>
                    </div>
                  </div>
                  <div className="bg-white dark:bg-[#0c1e2e] p-2.5 rounded-xl border border-[#e1e3e4] dark:border-sky-900/30 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-600" />
                    <div>
                      <span className="font-bold block text-[#191c1d] dark:text-white">
                        AES-256
                      </span>
                      <span className="text-[10px] text-[#707975] dark:text-sky-300/70">
                        Vault Encrypted
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons for Step 1 */}
              <div className="space-y-3 pt-1">
                <button
                  onClick={handleDownloadEncryptedBackup}
                  className={`w-full py-3 px-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all ${
                    backupDownloaded
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#0284c7] hover:bg-[#0369a1] text-white'
                  }`}
                  id="btn-[#0284c7]-download-encrypted-backup"
                >
                  {backupDownloaded ? (
                    <React.Fragment key="backup-done">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Encrypted Backup Saved (.dmback)</span>
                    </React.Fragment>
                  ) : (
                    <React.Fragment key="backup-[#0284c7]">
                      <Download className="w-4 h-4" />
                      <span>Download Encrypted Backup File</span>
                    </React.Fragment>
                  )}
                </button>

                {/* Restore / Import Backup Option */}
                <div className="pt-2 border-t border-[#f2f4f5] dark:border-sky-900/30 flex items-center justify-between">
                  <span className="text-xs text-[#707975] dark:text-sky-300/70 font-semibold">
                    Have an existing backup?
                  </span>
                  <label className="relative overflow-hidden cursor-pointer px-3 py-1.5 bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs">
                    <Upload className="w-3.5 h-3.5 text-white" />
                    <span>Import Backup File</span>
                    <input
                      type="file"
                      onChange={handleImportBackup}
                      accept="*/*,.dmback,.dmback.json,.json,.txt,text/plain,application/json"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </label>
                </div>

                {isRestoreSuccess && (
                  <p className="text-xs font-bold text-emerald-600 text-center animate-bounce">
                    ✓ Encrypted backup imported successfully! Reloading...
                  </p>
                )}

                {restoreError && (
                  <p className="text-xs font-bold text-red-600 text-center">
                    {restoreError}
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* STEP 2: SECOND SECTION - FINAL ACCEPT OR REJECT AUTHORIZATION */
            <div key="reset-step-2" className="space-y-5 animate-in fade-in duration-150">
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-4 rounded-2xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h3 className="font-bold text-red-700 dark:text-red-300">
                    Final Section: Confirm Permanent Erase
                  </h3>
                  <p className="text-red-900/80 dark:text-red-200/80 leading-relaxed">
                    This second confirmation step protects your healthcare records from accidental deletion. Once wiped, all reminders, extracted documents, and profiles will be removed from this browser.
                  </p>
                </div>
              </div>

              {/* Explicit Consent Checkbox */}
              <label className="flex items-start gap-3 p-3 bg-[#f8fafb] dark:bg-[#07131e] rounded-xl border border-[#e1e3e4] dark:border-sky-900/40 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-[#ba1a1a] focus:ring-[#ba1a1a]"
                  id="chk-accept-reset-terms"
                />
                <span className="text-xs text-[#191c1d] dark:text-sky-100 font-medium leading-tight">
                  I understand that this action will wipe all active local reminders and reset my profile back to the default setup.
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer Navigation Controls */}
        <div className="p-5 bg-[#f8fafb] dark:bg-[#07131e] border-t border-[#e1e3e4] dark:border-sky-900/40 flex items-center justify-between gap-3">
          {step === 1 ? (
            <React.Fragment key="footer-controls-step-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-[#e1e3e4] dark:border-sky-900/40 text-xs font-bold text-[#3f4945] dark:text-sky-300 hover:bg-slate-100 dark:hover:bg-sky-900/30 transition-colors"
                id="btn-cancel-reset-step1"
              >
                Cancel & Keep Data
              </button>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-sky-100 hover:bg-black dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                id="btn-proceed-to-step2"
              >
                <span>Proceed to Step 2</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment key="footer-controls-step-2">
              {/* Reject / Cancel Option */}
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 text-xs font-extrabold text-[#0284c7] dark:text-sky-300 hover:bg-sky-100 transition-colors"
                id="btn-reject-reset"
              >
                Reject & Back
              </button>

              {/* Final Confirm Reset Option */}
              <button
                type="button"
                disabled={!acceptTerms}
                onClick={onConfirmReset}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all ${
                  acceptTerms
                    ? 'bg-[#ba1a1a] hover:bg-red-700 text-white cursor-pointer'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                }`}
                id="btn-final-confirm-reset"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Accept & Reset All App Data</span>
              </button>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
};
