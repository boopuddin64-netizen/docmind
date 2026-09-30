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
import { downscaleImage } from '../lib/scanClient';
import { ScanError, classifyScanFailure, requestScan, type ScanFailure } from '../lib/scanErrors';
import { PayloadTooLargeError, fitImageToBudget } from '../lib/largeFile';
import { PrepareError, prepareLargeFile, type PreparedScan } from '../lib/prepareUpload';
import { useEscapeKey } from '../lib/useEscapeKey';
import { loadDraft, pickStrings } from '../lib/persistedState';
import { useDraftSaver } from '../lib/useUiState';
import { FILE_INPUT_ACCEPT, checkUploadFile, toDataUrl } from '../lib/uploadFormats';
import { LARGE_FILE_THRESHOLD_BYTES } from '../lib/largeFile';

/** What one scan needs. `pageImages` + `notice` come from large-file preparation in the browser. */
type ScanPayload = Pick<PreparedScan, 'documentText' | 'imageBase64' | 'mimeType' | 'pageImages' | 'notice' | 'previewUrl'>;

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtracted: (data: ExtractedDocData) => void;
  /** Opens the manual-entry form (offered when a scan fails). */
  onAddManually: () => void;
  /** Optional heads-up shown after a successful scan (e.g. only the first pages of a large scanned PDF were read). */
  onNotice?: (message: string) => void;
  userProfile: UserProfile;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onExtracted,
  onAddManually,
  onNotice,
  userProfile,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [inputText, setInputText] = useState(() => pickStrings(loadDraft('uploadText'), ['t'] as const, 2000).t ?? '');
  const [preprocessedStats, setPreprocessedStats] = useState<string | null>(null);
  const [scanError, setScanErrorText] = useState<string | null>(null);
  const [scanFailure, setScanFailure] = useState<ScanFailure | null>(null);
  // What "Retry" repeats: the last request payload, or (large files, which are read in the browser first) the whole file flow.
  const retryRef = useRef<(() => void) | null>(null);
  const setScanError = (message: string | null, failure: ScanFailure | null = null) => { setScanErrorText(message); setScanFailure(failure); };
  const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const lastPayloadRef = useRef<ScanPayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(isOpen, onClose);
  useDraftSaver('uploadText', { t: inputText }, inputText.trim().length > 0);

  if (!isOpen) return null;

  const processScan = async (payload: ScanPayload) => {
    lastPayloadRef.current = payload;
    retryRef.current = () => { void processScan(payload); };
    setScanError(null);
    setScanStatus(null);
    // Offline: say so straight away instead of resizing a photo and then waiting for a request that cannot succeed.
    if (!isOnline()) {
      const failure = classifyScanFailure(new ScanError('offline', undefined, 'network', 'offline'), { online: false });
      setScanError(failure.message, failure);
      setIsScanning(false);
      return;
    }
    setIsScanning(true);

    try {
      let finalBase64 = payload.imageBase64;
      let mimeType = payload.mimeType;

      // Only images are preprocessed / downscaled. PDF, Word, Excel, CSV and TXT are sent untouched (the server reads them).
      const isImage = !!payload.imageBase64 && (mimeType || '').startsWith('image/');
      if (payload.imageBase64 && isImage) {
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
        // Downscale so phone photos (10+ MB) stay far below the 4.5 MB Vercel request-body limit. A corrupt image fails here.
        try {
          finalBase64 = await fitImageToBudget((o) => downscaleImage(finalBase64 as string, o.maxDimension, o.quality));
          mimeType = 'image/jpeg';
        } catch (e) {
          if (e instanceof PayloadTooLargeError) throw new ScanError(e.message);
          throw new ScanError('That image looks invalid or corrupt. Please choose another photo.');
        }
      }

      // One request guarded by a timeout (AbortController); every failure comes back as a classified ScanError.
      const data = await requestScan({
        documentText: payload.documentText,
        imageBase64: finalBase64,
        mimeType,
        pageImages: payload.pageImages,
        userName: userProfile.name,
        familyMembers: userProfile.familyMembers.map((f) => ({ name: f.name })),
      });
      onExtracted({
        ...data,
        // Images (and the first page of a scanned PDF) can be previewed as <img>; other formats fall back to the extracted-text preview.
        documentUrl: (isImage && finalBase64) || payload.previewUrl || data.documentUrl,
      });
      if (payload.notice) onNotice?.(payload.notice);
      setIsScanning(false);
      setScanStatus(null);
      onClose();
    } catch (err) {
      console.error('Scan failed:', err);
      const failure = classifyScanFailure(err, { online: isOnline() });
      setScanError(failure.message, failure);
      setIsScanning(false); // stay open: honest error state with Retry / Add manually
      setScanStatus(null);
    }
  };

  const handleFileUpload = async (file: File) => {
    const check = checkUploadFile(file);
    if ('error' in check) {
      setScanError(check.error);
      return;
    }

    // Large PDF / Word / Excel / CSV / TXT: read it here in the browser and upload only text (or a few page images).
    retryRef.current = () => { void handleFileUpload(file); };
    if (check.kind !== 'image' && file.size > LARGE_FILE_THRESHOLD_BYTES) {
      lastPayloadRef.current = null;
      setScanError(null);
      if (!isOnline()) {
        // Reading happens on the device, but the result still has to be uploaded (and the reader libraries may need downloading).
        const failure = classifyScanFailure(new ScanError('offline', undefined, 'network', 'offline'), { online: false });
        setScanError(failure.message, failure);
        return;
      }
      setIsScanning(true);
      setScanStatus('Reading this large file on your device first…');
      try {
        const prepared = await prepareLargeFile(file, { kind: check.kind, mime: check.mime });
        if (prepared) {
          setScanStatus(null);
          await processScan(prepared);
          return;
        }
      } catch (err) {
        console.error('Large file preparation failed:', err);
        // A lazy reader chunk that could not be downloaded is a network problem (Retry helps); a bad file is not.
        const failure = classifyScanFailure(err, { online: isOnline() });
        setScanError(failure.kind === 'unknown' ? 'That file could not be read. Please choose another one.' : failure.message, failure);
        setIsScanning(false);
        setScanStatus(null);
        return;
      }
    }

    const reader = new FileReader();
    reader.onerror = () => setScanError('That file could not be read. Please choose another one.');
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result !== 'string') {
        setScanError('That file could not be read. Please choose another one.');
        return;
      }
      processScan({
        // The resolved MIME type wins over the browser's (which is often empty/wrong for .doc, .xls, .csv).
        imageBase64: toDataUrl(result, check.mime),
        documentText: file.name,
        mimeType: check.mime,
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
              {scanStatus && (
                <p className="text-xs font-semibold text-[#0284c7] dark:text-sky-300 mt-2 max-w-xs" role="status" id="scan-status">{scanStatus}</p>
              )}
            </div>
          </div>
        ) : scanError ? (
          <div className="py-6 flex flex-col items-center text-center space-y-4" role="alert" id="scan-error-state">
            <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#191c1d] dark:text-white" id="scan-error-title">
                {scanFailure?.kind === 'network' ? 'Connection problem' : scanFailure?.kind === 'too-large' ? 'File too large' : scanFailure?.kind === 'unsupported' ? 'Cannot read this file' : 'Scan failed'}
              </h3>
              <p className="text-xs text-[#3f4945] dark:text-sky-300/80 mt-1 max-w-xs">{scanError}</p>
              <p className="text-[11px] text-[#707975] dark:text-sky-300/60 mt-2 max-w-xs">
                {scanFailure?.kind === 'network'
                  ? 'Your document was not lost. Reconnect, then tap Retry, or enter the reminder yourself.'
                  : 'Nothing was saved. You can try again or enter the reminder yourself.'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <button
                type="button"
                onClick={() => (retryRef.current && (scanFailure ? scanFailure.retryable : true) ? retryRef.current() : setScanError(null))}
                className="flex-1 bg-[#0284c7] dark:bg-sky-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-[#0369a1] dark:hover:bg-sky-500 flex items-center justify-center gap-1.5"
                id="btn-scan-retry"
              >
                <RotateCcw className="w-4 h-4" /> {scanFailure && !scanFailure.retryable ? 'Choose another file' : 'Retry'}
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
                accept={FILE_INPUT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                  e.target.value = ''; // allow re-picking the same file after an error
                }}
              />
              <div className="w-12 h-12 rounded-full bg-[#f2f4f5] dark:bg-sky-900/40 text-[#0284c7] dark:text-sky-300 mx-auto flex items-center justify-center mb-3">
                <Camera className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-[#191c1d] dark:text-white">
                Click or drag & drop an image or document
              </p>
              <p className="text-xs text-[#707975] dark:text-sky-300/70 mt-1">
                Supports JPG, PNG, WebP, PDF, Word, Excel, CSV and TXT (large files are read on your device, up to 50 MB)
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
