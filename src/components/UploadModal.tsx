import React, { useState, useRef } from 'react';
import {
  X,
  AlertTriangle,
  RotateCcw,
  PencilLine,
  UploadCloud,
  Sparkles,
  Camera,
  Sliders,
  CheckCircle2,
  FileCheck2,
} from 'lucide-react';
import { ExtractedDocData, UserProfile } from '../types';
import { preprocessDocumentImage } from '../lib/preprocessor';
import { ScanError, downscaleImage, readScanResponse } from '../lib/scanClient';
import { useEscapeKey } from '../lib/useEscapeKey';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtracted: (data: ExtractedDocData) => void;
  /** Opens the manual-entry form (offered when a scan fails). */
  onAddManually: () => void;
  userProfile: UserProfile;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onExtracted,
  onAddManually,
  userProfile,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [inputText, setInputText] = useState('');
  const [preprocessedStats, setPreprocessedStats] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const lastPayloadRef = useRef<{ documentText?: string; imageBase64?: string; mimeType?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const processScan = async (payload: {
    documentText?: string;
    imageBase64?: string;
    mimeType?: string;
  }) => {
    lastPayloadRef.current = payload;
    setScanError(null);
    setIsScanning(true);

    try {
      let finalBase64 = payload.imageBase64;
      let mimeType = payload.mimeType;

      if (payload.imageBase64) {
        if (!payload.imageBase64.startsWith('data:image')) {
          throw new ScanError('Only image files (JPG, PNG, WebP) can be scanned. Use "Add manually instead" for other files.');
        }
        // Layer 1 preprocessing (deskew / contrast) is best-effort; a decode failure here is a REAL failure below.
        try {
          const { processedDataUrl, stats } = await preprocessDocumentImage(payload.imageBase64, {
            autoDeskew: true,
            contrastBoost: 1.35,
            brightness: 1.05,
          });
          finalBase64 = processedDataUrl;
          setPreprocessedStats(`Preprocessed: Auto-Deskewed (${stats.skewAngle}°) + Contrast Boosted`);
        } catch (e) {
          console.warn('Preprocessor skipped:', e);
        }
        // Downscale so phone photos stay far below the 4.5 MB Vercel request-body limit. A corrupt image fails here.
        try {
          finalBase64 = await downscaleImage(finalBase64 as string);
          mimeType = 'image/jpeg';
        } catch (e) {
          throw new ScanError('That image looks invalid or corrupt. Please choose another photo.');
        }
      }

      const response = await fetch('/api/scan-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText: payload.documentText,
          imageBase64: finalBase64,
          mimeType,
          userName: userProfile.name,
          familyMembers: userProfile.familyMembers.map((f) => ({ name: f.name })),
        }),
      });

      const data = await readScanResponse(response);
      onExtracted({
        ...data,
        documentUrl: finalBase64 || data.documentUrl,
      });
      setIsScanning(false);
      onClose();
    } catch (err) {
      console.error('Scan failed:', err);
      setScanError(
        err instanceof ScanError
          ? err.message
          : 'Could not reach the scanner. Check your connection and try again.',
      );
      setIsScanning(false); // stay open: honest error state with Retry / Add manually
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setScanError('Only image files (JPG, PNG, WebP) can be scanned. Use "Add manually instead" for other files.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setScanError('That file could not be read. Please choose another one.');
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      processScan({
        imageBase64: base64,
        documentText: file.name,
        mimeType: file.type || 'image/jpeg',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="upload-modal-title" className="bg-white dark:bg-[#0c1e2e] border border-transparent dark:border-sky-900/40 w-full max-w-md md:max-w-lg rounded-3xl p-6 shadow-2xl relative overflow-hidden space-y-5 animate-in fade-in zoom-in duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-[#707975] dark:text-sky-300 hover:bg-[#eceeef] dark:hover:bg-sky-900/40 transition-colors"
          aria-label="Close upload dialog"
          id="btn-close-upload-modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-xl bg-[#0284c7] text-[#bae6fd]">
              <UploadCloud className="w-5 h-5" />
            </div>
            <h2 id="upload-modal-title" className="text-xl font-bold text-[#0284c7] dark:text-sky-300">
              Upload Any Document
            </h2>
          </div>
          <p className="text-xs text-[#3f4945] dark:text-sky-300/80">
            Scan bills, contracts, vehicle notices, prescriptions, or notes with AI extraction.
          </p>
        </div>

        {isScanning ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-[#0284c7]/20 dark:border-sky-500/20 border-t-[#0284c7] dark:border-t-sky-400 animate-spin" />
              <Sparkles className="w-6 h-6 text-[#0284c7] dark:text-sky-400 absolute inset-0 m-auto animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#191c1d] dark:text-white">
                Scanning Document...
              </h3>
              <p className="text-xs text-[#707975] dark:text-sky-300/80 mt-1 max-w-xs">
                Extracting recipient, due dates, action items, and issuer notes with Gemini AI.
              </p>
            </div>
          </div>
        ) : scanError ? (
          <div className="py-6 flex flex-col items-center text-center space-y-4" role="alert" id="scan-error-state">
            <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#191c1d] dark:text-white">Scan failed</h3>
              <p className="text-xs text-[#3f4945] dark:text-sky-300/80 mt-1 max-w-xs">{scanError}</p>
              <p className="text-[11px] text-[#707975] dark:text-sky-300/60 mt-2 max-w-xs">
                Nothing was saved. You can try again or enter the reminder yourself.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <button
                type="button"
                onClick={() => lastPayloadRef.current ? processScan(lastPayloadRef.current) : setScanError(null)}
                className="flex-1 bg-[#0284c7] dark:bg-sky-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-[#0369a1] dark:hover:bg-sky-500 flex items-center justify-center gap-1.5"
                id="btn-scan-retry"
              >
                <RotateCcw className="w-4 h-4" /> Retry
              </button>
              <button
                type="button"
                onClick={() => {
                  setScanError(null);
                  onClose();
                  onAddManually();
                }}
                className="flex-1 border border-[#0284c7] dark:border-sky-500 text-[#0284c7] dark:text-sky-300 text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-sky-50 dark:hover:bg-sky-900/30 flex items-center justify-center gap-1.5"
                id="btn-scan-add-manually"
              >
                <PencilLine className="w-4 h-4" /> Add manually instead
              </button>
              <button
                type="button"
                onClick={() => setScanError(null)}
                className="text-xs font-semibold text-[#707975] dark:text-sky-300/70 px-3 py-2.5 rounded-xl hover:bg-[#eceeef] dark:hover:bg-sky-900/40"
              >
                Choose another file
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                dragActive
                  ? 'border-[#0284c7] dark:border-sky-400 bg-[#e0f2fe]/50'
                  : 'border-[#bfc9c4] dark:border-sky-900/60 hover:border-[#0284c7] dark:hover:border-sky-400 bg-[#f8fafb] dark:bg-[#07131e]'
              }`}
              id="dropzone-upload-document"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <div className="w-12 h-12 rounded-full bg-[#f2f4f5] dark:bg-sky-900/40 text-[#0284c7] dark:text-sky-300 mx-auto flex items-center justify-center mb-3">
                <Camera className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-[#191c1d] dark:text-white">
                Click or drag & drop image or document
              </p>
              <p className="text-xs text-[#707975] dark:text-sky-300/70 mt-1">
                Supports JPG, PNG, WebP, receipts, or photos from camera
              </p>
            </div>

            {/* Quick Text Input Option */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
                Or Paste Note / Document Text
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Electric bill due 18/05/2026 or Dental review..."
                  value={inputText}
                  maxLength={2000}
                  aria-label="Document text to scan"
                  onChange={(e) => setInputText(e.target.value)}
                  className="flex-1 bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-3.5 py-2.5 text-xs text-[#191c1d] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] dark:focus:ring-sky-400"
                  id="input-text-scan"
                />
                <button
                  onClick={() => {
                    if (inputText.trim()) {
                      processScan({ documentText: inputText });
                    }
                  }}
                  className="bg-[#0284c7] dark:bg-sky-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-[#0369a1] dark:hover:bg-sky-500"
                  id="btn-scan-text"
                >
                  Scan Text
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
