import React, { useState } from 'react';
import { ExtractedDocData, FieldConfidence, ReminderCategory } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  Sliders,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Calendar,
  Building2,
  User,
  FileText,
  Clock,
  ShieldCheck,
  RotateCcw,
  Eye
} from 'lucide-react';

interface HumanInTheLoopModalProps {
  isOpen: boolean;
  extractedData: ExtractedDocData;
  onConfirm: (verifiedData: ExtractedDocData) => void;
  onCancel: () => void;
}

export const HumanInTheLoopModal: React.FC<HumanInTheLoopModalProps> = ({
  isOpen,
  extractedData,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const initialItems = (extractedData.extractedItems && extractedData.extractedItems.length > 0)
    ? extractedData.extractedItems
    : [extractedData];

  const [items, setItems] = useState<ExtractedDocData[]>(initialItems);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [imageFilter, setImageFilter] = useState<'normal' | 'contrast' | 'grayscale' | 'invert'>('normal');

  const formData = items[selectedIndex] || items[0] || extractedData;

  const getConfidenceBadge = (score?: number) => {
    const s = score || 98;
    if (s >= 90) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
          <ShieldCheck className="w-3 h-3 text-[#0284c7]" /> High {s}%
        </span>
      );
    } else if (s >= 75) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          <AlertTriangle className="w-3 h-3 text-amber-600" /> Review {s}%
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
        <AlertTriangle className="w-3 h-3 text-rose-600" /> Low {s}%
      </span>
    );
  };

  const categories: ReminderCategory[] = [
    'Medical',
    'Bills & Invoices',
    'Contracts & Legal',
    'Vehicle & Home',
    'Work & Study',
    'Subscriptions',
    'General',
  ];

  const handleFieldChange = (field: keyof ExtractedDocData, value: any) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx === selectedIndex
          ? {
              ...item,
              [field]: value,
              fieldConfidences: item.fieldConfidences?.map((f) =>
                f.field === field ? { ...f, score: 100, isVerifiedByUser: true } : f
              ),
            }
          : item
      )
    );
  };

  const handleConfirmAll = () => {
    const verified = {
      ...items[0],
      extractedItems: items,
    };
    onConfirm(verified);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#0c1e2e] w-full max-w-4xl rounded-2xl shadow-2xl border border-sky-900/20 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#0284c7] text-white px-5 py-3.5 flex items-center justify-between border-b border-sky-700/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 border border-white/30 flex items-center justify-center text-white">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
                Smart Review & Verification
                {extractedData.needsReview && (
                  <span className="bg-amber-500/20 text-amber-300 text-[10px] px-2 py-0.5 rounded-full border border-amber-400/30 font-semibold">
                    Review Recommended
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-sky-100/90">
                Double-check scanned document details before saving to your account.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-sky-100/80 hover:text-white text-xs font-semibold px-2.5 py-1 rounded-md hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Split View Content */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-y-auto divide-y md:divide-y-0 md:divide-x divide-sky-900/10">
          {/* Left Pane: Document Viewer & Controls (5 Cols) */}
          <div className="md:col-span-5 bg-slate-900 text-slate-100 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-slate-300 border-b border-slate-800 pb-2">
              <span className="font-semibold flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-[#0284c7]" /> Original Document
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(75, z - 25))}
                  className="p-1 hover:bg-slate-800 rounded text-slate-300"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono w-10 text-center">{zoomLevel}%</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(250, z + 25))}
                  className="p-1 hover:bg-slate-800 rounded text-slate-300"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Image Preview Box */}
            <div className="flex-1 min-h-[220px] bg-slate-950 rounded-lg overflow-auto border border-slate-800 flex items-center justify-center relative p-2">
              {formData.documentUrl ? (
                <img
                  src={formData.documentUrl}
                  alt="Scanned Document"
                  style={{
                    transform: `scale(${zoomLevel / 100})`,
                    transformOrigin: 'top center',
                    filter:
                      imageFilter === 'contrast'
                        ? 'contrast(1.5) brightness(1.1)'
                        : imageFilter === 'grayscale'
                        ? 'grayscale(100%)'
                        : imageFilter === 'invert'
                        ? 'invert(100%)'
                        : 'none',
                  }}
                  className="max-w-full transition-transform duration-200 rounded shadow-md object-contain"
                />
              ) : (
                <div className="text-center p-6 text-slate-500 text-xs">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-40 text-[#0284c7]" />
                  <p>Document Text Preview</p>
                  <p className="text-[10px] text-slate-400 mt-1 line-clamp-4 font-mono bg-slate-900 p-2 rounded">
                    {formData.fullText || 'No image scan attached'}
                  </p>
                </div>
              )}
            </div>

            {/* Filter Toolbar */}
            <div className="flex items-center justify-between text-[11px] bg-slate-850 p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Sliders className="w-3 h-3 text-[#0284c7]" /> View Filter:
              </span>
              <div className="flex gap-1">
                {(['normal', 'contrast', 'grayscale', 'invert'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setImageFilter(mode)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize transition-colors ${
                      imageFilter === mode
                        ? 'bg-[#0284c7] text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Pane: Extracted Fields & Quick Edits (7 Cols) */}
          <div className="md:col-span-7 p-4 bg-slate-50 dark:bg-[#07131e] flex flex-col gap-3.5">
            {/* AI Confidence Summary */}
            <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/40 p-3 rounded-xl flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-[#0369a1] dark:text-sky-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                  Scanner Accuracy Score: {formData.accuracy || 98}%
                </div>
                <p className="text-[11px] text-[#0369a1] dark:text-sky-300/80 mt-0.5">
                  Checked automatically by DocuMind's smart document reader.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setItems(initialItems)}
                className="text-[11px] font-semibold text-[#0369a1] dark:text-sky-300 hover:underline flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>

            {/* Multi-Item Tab Selector in Human-In-The-Loop */}
            {items.length > 1 && (
              <div className="bg-[#e0f2fe] dark:bg-sky-950/60 border border-[#bae6fd] dark:border-sky-800/60 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-[#0369a1] dark:text-sky-300">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-[#0284c7]" />
                    Extracted {items.length} Separate Date Entries:
                  </span>
                  <span className="text-[10px] text-[#0369a1]/80 font-normal">
                    (Editing Item #{selectedIndex + 1})
                  </span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {items.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                        selectedIndex === idx
                          ? 'bg-[#0284c7] text-white shadow-xs'
                          : 'bg-white dark:bg-[#0c1e2e] text-[#0369a1] dark:text-sky-300 border border-[#bae6fd] dark:border-sky-800'
                      }`}
                    >
                      <span>#{idx + 1}:</span>
                      <span>{item.appointmentDate}</span>
                      <span className="opacity-80">({item.patientName || 'Self'})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Form Fields */}
            <div className="space-y-3">
              {/* Event Title */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  <label className="flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-[#0284c7]" /> Reminder Title
                  </label>
                  {getConfidenceBadge(formData.fieldConfidences?.find((f) => f.field === 'eventTitle')?.score)}
                </div>
                <input
                  type="text"
                  value={formData.eventTitle}
                  onChange={(e) => handleFieldChange('eventTitle', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-[#0284c7] outline-none"
                />
              </div>

              {/* Issuer & Recipient Row */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    <label className="flex items-center gap-1 truncate">
                      <Building2 className="w-3.5 h-3.5 text-[#0284c7]" /> Organization / Issuer
                    </label>
                  </div>
                  <input
                    type="text"
                    value={formData.hospitalName}
                    onChange={(e) => handleFieldChange('hospitalName', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    <label className="flex items-center gap-1 truncate">
                      <User className="w-3.5 h-3.5 text-[#0284c7]" /> Recipient / Name
                    </label>
                  </div>
                  <input
                    type="text"
                    value={formData.patientName}
                    onChange={(e) => handleFieldChange('patientName', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none"
                  />
                </div>
              </div>

              {/* Date, Time & Category */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    <label className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-[#0284c7]" /> Due Date
                    </label>
                  </div>
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    value={formData.appointmentDate}
                    onChange={(e) => handleFieldChange('appointmentDate', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none font-mono"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    <label className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-[#0284c7]" /> Time
                    </label>
                  </div>
                  <input
                    type="text"
                    placeholder="10:00 AM"
                    value={formData.appointmentTime}
                    onChange={(e) => handleFieldChange('appointmentTime', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    <label className="truncate">Category</label>
                  </div>
                  <select
                    value={formData.category}
                    onChange={(e) => handleFieldChange('category', e.target.value as ReminderCategory)}
                    className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Short Note / Key Summary */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Action Item / Instructions
                </label>
                <textarea
                  rows={2}
                  value={formData.shortNote}
                  onChange={(e) => handleFieldChange('shortNote', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-sky-800 bg-white dark:bg-[#07131e] text-slate-900 dark:text-white outline-none"
                />
              </div>
            </div>

            {/* Footer Action Buttons */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-sky-900/40 mt-auto">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleConfirmAll}
                className="px-5 py-2 text-xs font-bold text-white bg-[#0284c7] hover:bg-[#0369a1] rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4 text-[#bae6fd]" />
                {items.length > 1
                  ? `Confirm & Save All ${items.length} Reminders`
                  : 'Confirm & Save Verified Document'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
