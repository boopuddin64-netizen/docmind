import React from 'react';
import { ExtractedDocData, Reminder } from '../types';
import { Copy, ArrowRight, Merge, PlusCircle, Trash2, CheckCircle2, Building2, Calendar, FileText } from 'lucide-react';

interface DuplicateMergeModalProps {
  isOpen: boolean;
  newDoc: ExtractedDocData;
  existingReminder: Reminder;
  similarityScore: number;
  reason: string;
  onMerge: () => void;
  onSaveAsNew: () => void;
  onDiscard: () => void;
}

export const DuplicateMergeModal: React.FC<DuplicateMergeModalProps> = ({
  isOpen,
  newDoc,
  existingReminder,
  similarityScore,
  reason,
  onMerge,
  onSaveAsNew,
  onDiscard,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#0c1e2e] w-full max-w-lg rounded-2xl shadow-2xl border border-amber-500/30 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-600 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/30 border border-amber-300/40 flex items-center justify-center">
              <Copy className="w-4 h-4 text-amber-100" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Similar Document Found</h3>
              <p className="text-[11px] text-amber-100/90 font-medium">
                Document Match Score: {Math.round(similarityScore * 100)}%
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs text-slate-700 dark:text-slate-200">
          <p className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 p-3 rounded-xl text-amber-900 dark:text-amber-200">
            {reason}
          </p>

          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            {/* Existing Reminder */}
            <div className="bg-slate-100 dark:bg-[#07131e] p-3 rounded-xl border border-slate-200 dark:border-sky-900/40 space-y-1.5">
              <span className="font-bold text-slate-500 dark:text-slate-400 uppercase text-[10px] block">
                Existing Reminder
              </span>
              <p className="font-bold text-slate-900 dark:text-white line-clamp-1">
                {existingReminder.eventTitle}
              </p>
              <p className="text-slate-600 dark:text-sky-300 flex items-center gap-1">
                <Building2 className="w-3 h-3 text-[#0284c7]" /> {existingReminder.hospitalName}
              </p>
              <p className="text-slate-600 dark:text-sky-300 flex items-center gap-1 font-mono">
                <Calendar className="w-3 h-3 text-[#0284c7]" /> {existingReminder.appointmentDate}
              </p>
            </div>

            {/* New Upload */}
            <div className="bg-sky-50 dark:bg-[#0c1e2e] p-3 rounded-xl border border-sky-300 dark:border-sky-700/60 space-y-1.5">
              <span className="font-bold text-[#0284c7] dark:text-sky-400 uppercase text-[10px] block">
                Newly Scanned Doc
              </span>
              <p className="font-bold text-slate-900 dark:text-white line-clamp-1">
                {newDoc.eventTitle}
              </p>
              <p className="text-slate-600 dark:text-sky-200 flex items-center gap-1">
                <Building2 className="w-3 h-3 text-[#0284c7]" /> {newDoc.hospitalName}
              </p>
              <p className="text-slate-600 dark:text-sky-200 flex items-center gap-1 font-mono">
                <Calendar className="w-3 h-3 text-[#0284c7]" /> {newDoc.appointmentDate}
              </p>
            </div>
          </div>

          <p className="text-slate-500 dark:text-sky-200/70 text-[11px]">
            Choose how you wish to process this document to avoid cluttering your schedule:
          </p>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 dark:bg-[#07131e] border-t border-slate-200 dark:border-sky-900/40 flex flex-col gap-2">
          <button
            type="button"
            onClick={onMerge}
            className="w-full py-2.5 px-4 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-all"
          >
            <Merge className="w-4 h-4 text-[#bae6fd]" />
            Smart Merge & Update Notes / Attachments
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSaveAsNew}
              className="py-2 px-3 bg-white dark:bg-[#0c1e2e] border border-slate-300 dark:border-sky-800 text-slate-700 dark:text-sky-200 font-semibold text-[11px] rounded-xl hover:bg-slate-100 dark:hover:bg-sky-900/30 flex items-center justify-center gap-1.5 transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5 text-[#0284c7]" /> Save as Separate
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="py-2 px-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold text-[11px] rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/60 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Discard Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
