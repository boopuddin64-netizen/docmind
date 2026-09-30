import React from 'react';
import {
  X,
  Calendar,
  Clock,
  User,
  Building2,
  FileText,
  Download,
  CheckCircle2,
  Trash2,
  ShieldCheck,
  Stethoscope,
  Sparkles,
  Pencil,
  Save,
} from 'lucide-react';
import { Reminder, ReminderCategory, UserProfile } from '../types';
import { selfMatchLabel } from '../lib/profileMatch';
import { CalendarExportSheet } from './CalendarExportSheet';
import { validateDateField, validateTimeField } from '../lib/dateInput';
import { FIELD_LIMITS, clamp } from '../lib/formValidation';
import { useEscapeKey } from '../lib/useEscapeKey';
import { SnoozeOptions } from './SnoozeOptions';

interface ReminderDetailModalProps {
  reminder: Reminder | null;
  onClose: () => void;
  onToggleComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateReminder?: (updated: Reminder) => void;
  /** Snooze the reminder's alerts for one of the six allowed durations (minutes). */
  onSnooze?: (reminderId: string, minutes: number) => void;
  userProfile?: UserProfile;
  /** App-level toast (success / failure feedback for exports). */
  onShowToast?: (message: string) => void;
}

export const ReminderDetailModal: React.FC<ReminderDetailModalProps> = ({
  reminder,
  onClose,
  onToggleComplete,
  onDelete,
  onUpdateReminder,
  onSnooze,
  userProfile,
  onShowToast,
}) => {
  const [isEditing, setIsEditing] = React.useState<boolean>(false);
  const [eventTitle, setEventTitle] = React.useState<string>(reminder?.eventTitle ?? '');
  const [category, setCategory] = React.useState<ReminderCategory>(reminder?.category ?? 'General');
  const [patientName, setPatientName] = React.useState<string>(reminder?.patientName ?? '');
  const [hospitalName, setHospitalName] = React.useState<string>(reminder?.hospitalName ?? '');
  const [appointmentDate, setAppointmentDate] = React.useState<string>(reminder?.appointmentDate ?? '');
  const [appointmentTime, setAppointmentTime] = React.useState<string>(reminder?.appointmentTime ?? '');
  const [diagnosis, setDiagnosis] = React.useState<string>(reminder?.diagnosis ?? '');
  const [shortNote, setShortNote] = React.useState<string>(reminder?.shortNote ?? '');

  const [confirmingDelete, setConfirmingDelete] = React.useState<boolean>(false);
  const [showExportSheet, setShowExportSheet] = React.useState<boolean>(false);
  const [errors, setErrors] = React.useState<{ date?: string; time?: string; title?: string; export?: string }>({});

  // Escape closes the delete confirmation first, then the dialog.
  useEscapeKey(!!reminder && !showExportSheet, () => (confirmingDelete ? setConfirmingDelete(false) : onClose()));

  // Sync edit state if reminder prop changes
  React.useEffect(() => {
    if (reminder) {
      setEventTitle(reminder.eventTitle);
      setCategory(reminder.category);
      setPatientName(reminder.patientName);
      setHospitalName(reminder.hospitalName);
      setAppointmentDate(reminder.appointmentDate);
      setAppointmentTime(reminder.appointmentTime);
      setDiagnosis(reminder.diagnosis);
      setShortNote(reminder.shortNote);
      setIsEditing(false);
      setConfirmingDelete(false);
      setErrors({});
    }
  }, [reminder]);

  // Hooks must run on every render, so the null guard lives after them (Rules of Hooks).
  if (!reminder) return null;

  const handleSave = () => {
    if (!onUpdateReminder) return;
    const date = validateDateField(appointmentDate);
    const time = validateTimeField(appointmentTime);
    const next = {
      title: eventTitle.trim() ? undefined : 'Enter a title.',
      date: date.ok ? undefined : date.error,
      time: time.ok ? undefined : time.error,
    };
    setErrors(next);
    if (next.title || !date.ok || !time.ok) return;
    const updated: Reminder = {
      ...reminder,
      eventTitle: clamp(eventTitle.trim(), FIELD_LIMITS.title),
      category,
      patientName: clamp(patientName, FIELD_LIMITS.recipient),
      patientMatch: selfMatchLabel(patientName, userProfile?.name),
      hospitalName: clamp(hospitalName.trim(), FIELD_LIMITS.issuer),
      appointmentDate: date.value,
      appointmentTime: time.value,
      diagnosis: clamp(diagnosis, FIELD_LIMITS.subject),
      shortNote: clamp(shortNote, FIELD_LIMITS.note),
    };
    onUpdateReminder(updated);
    setIsEditing(false);
  };

  const exportCalendar = () => {
    if (!reminder) return;
    setErrors((p) => ({ ...p, export: undefined }));
    setShowExportSheet(true);
  };

  return (
    <>
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reminder details"
        className="bg-white dark:bg-[#0c1e2e] border border-transparent dark:border-sky-900/40 w-full max-w-md rounded-3xl p-6 shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reminder details"
          className="absolute top-4 right-4 p-2 rounded-full text-[#707975] dark:text-sky-300 hover:bg-[#eceeef] dark:hover:bg-sky-900/40 transition-colors"
          id="btn-close-detail-modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Close & Edit Header Buttons */}
        <div className="flex items-center justify-between border-b border-[#e1e3e4] dark:border-sky-900/40 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#0284c7] text-white">
              {category}
            </span>
            <span className="text-xs font-bold text-[#005faf] dark:text-sky-200 bg-[#d4e3ff] dark:bg-sky-900/50 px-2.5 py-1 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              {reminder.status}
            </span>
          </div>

          <div className="flex items-center gap-2 pr-8">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs font-bold text-[#005faf] dark:text-sky-200 bg-[#d4e3ff] dark:bg-sky-900/50 hover:bg-[#54a0fe]/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
              id="btn-toggle-edit-reminder"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Cancel Edit' : 'Edit Details'}</span>
            </button>
          </div>

        </div>

        {/* Edit Form OR View Mode */}
        {isEditing ? (
          <div className="space-y-3 pt-1">
            <h3 className="text-sm font-bold text-[#0284c7] dark:text-sky-300 uppercase tracking-wider">
              Edit Reminder Details
            </h3>

            <div>
              <label htmlFor="edit-title" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Event Title</label>
              <input
                type="text"
                value={eventTitle}
                id="edit-title"
                maxLength={FIELD_LIMITS.title}
                aria-invalid={!!errors.title}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-3 py-2 text-xs font-bold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
              />
              {errors.title && <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">{errors.title}</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="edit-category" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Category</label>
                <select
                  id="edit-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                  className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-2.5 py-2 text-xs font-bold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                >
                  <option value="Medical">Medical</option>
                  <option value="Bills & Invoices">Bills & Invoices</option>
                  <option value="Contracts & Legal">Contracts & Legal</option>
                  <option value="Vehicle & Home">Vehicle & Home</option>
                  <option value="Work & Study">Work & Study</option>
                  <option value="Subscriptions">Subscriptions</option>
                  <option value="General">General</option>
                  <option value="Checkup">Checkup</option>
                  <option value="Prescription">Prescription</option>
                </select>
              </div>

              <div>
                <label htmlFor="edit-recipient" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Recipient Name</label>
                <input
                  type="text"
                  value={patientName}
                id="edit-recipient"
                maxLength={FIELD_LIMITS.recipient}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                />
              </div>
            </div>

            <div>
              <label htmlFor="edit-issuer" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Issuer / Provider / Hospital</label>
              <input
                type="text"
                value={hospitalName}
                id="edit-issuer"
                maxLength={FIELD_LIMITS.issuer}
                onChange={(e) => setHospitalName(e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="edit-date" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Due / Appt Date</label>
                <input
                  type="text"
                  value={appointmentDate}
                id="edit-date"
                maxLength={20} 
                aria-invalid={!!errors.date}
                placeholder="DD/MM/YYYY"
                  onChange={(e) => setAppointmentDate(e.target.value)}
                  className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                />
              {errors.date && <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">{errors.date}</p>}
              </div>

              <div>
                <label htmlFor="edit-time" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Time</label>
                <input
                  type="text"
                  value={appointmentTime}
                id="edit-time"
                maxLength={12} 
                aria-invalid={!!errors.time}
                placeholder="10:00 AM"
                  onChange={(e) => setAppointmentTime(e.target.value)}
                  className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                />
              {errors.time && <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">{errors.time}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="edit-subject" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Subject / Diagnosis / Purpose</label>
              <input
                type="text"
                value={diagnosis}
                id="edit-subject"
                maxLength={FIELD_LIMITS.subject}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
              />
            </div>

            <div>
              <label htmlFor="edit-note" className="text-[11px] font-bold text-[#3f4945] dark:text-sky-300 uppercase">Notes & Instructions</label>
              <textarea
                rows={2}
                value={shortNote}
                id="edit-note"
                maxLength={FIELD_LIMITS.note}
                onChange={(e) => setShortNote(e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 dark:text-white rounded-xl p-3 text-xs font-normal text-[#191c1d] dark:text-white focus:bg-white dark:focus:bg-[#0c1e2e] focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5 resize-none"
              />
            </div>

            <button
              onClick={handleSave}
              className="w-full py-3 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold text-xs rounded-full flex items-center justify-center gap-2 shadow-sm transition-colors mt-2"
              id="btn-save-reminder-edits"
            >
              <Save className="w-4 h-4" />
              <span>Save Changes</span>
            </button>
          </div>
        ) : (
          <>
            {/* Title & Hospital */}
            <div>
              <h2 className="text-xl font-extrabold text-[#191c1d] dark:text-white break-words line-clamp-3 leading-snug">
                {reminder.eventTitle}
              </h2>
              <p className="text-xs font-semibold text-[#005faf] dark:text-sky-300 mt-1 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 shrink-0" />
                {reminder.hospitalName}
              </p>
            </div>

            {/* Key Info Grid */}
            <div className="bg-[#f8fafb] dark:bg-[#07131e] rounded-2xl p-4 border border-[#e1e3e4] dark:border-sky-900/40 space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#e1e3e4] dark:border-sky-900/40">
                <span className="text-[#707975] dark:text-sky-300/70 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-[#0284c7]" /> Recipient:
                </span>
                <span className="font-bold text-[#191c1d] dark:text-white break-words text-right">
                  {reminder.patientName}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#e1e3e4] dark:border-sky-900/40">
                <span className="text-[#707975] dark:text-sky-300/70 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#005faf]" /> Date & Time:
                </span>
                <span className="font-bold text-[#005faf] dark:text-sky-300">
                  {reminder.appointmentDate} at {reminder.appointmentTime}
                </span>
              </div>

              <div className="text-xs space-y-1">
                <span className="text-[#707975] dark:text-sky-300/70 flex items-center gap-1.5 font-medium">
                  <FileText className="w-4 h-4 text-[#0284c7]" /> Subject / Purpose:
                </span>
                <p className="font-semibold text-[#191c1d] dark:text-white pl-5 break-words">
                  {reminder.diagnosis}
                </p>
              </div>
            </div>

            {/* Short Note */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
                Preparation & Instructions:
              </label>
              <div className="bg-[#f2f4f5] dark:bg-[#07131e] p-3.5 rounded-xl border border-[#e1e3e4] dark:border-sky-900/40 text-xs text-[#191c1d] dark:text-sky-100 leading-relaxed break-words whitespace-pre-wrap">
                {reminder.shortNote}
              </div>
            </div>

            {/* Original Document Extracted Snippet */}
            {reminder.fullText && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-[#005faf]" /> Original Scan
                    Text
                  </label>
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70">Verified</span>
                </div>
                <pre className="bg-[#0f172a] text-[#bae6fd] p-3.5 rounded-xl text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {reminder.fullText}
                </pre>
              </div>
            )}
          </>
        )}

        {confirmingDelete && (
          <div
            role="alertdialog"
            aria-label="Confirm delete"
            className="rounded-2xl border border-[#ffb4ab] dark:border-rose-900/60 bg-[#fff8f7] dark:bg-rose-950/30 p-4 space-y-3"
          >
            <p className="text-xs font-semibold text-[#93000a] dark:text-rose-200 break-words">
              Delete "{reminder.eventTitle}"? You can undo this for a few seconds afterwards.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmingDelete(false)}
                className="py-2 rounded-full text-xs font-bold bg-white dark:bg-[#0c1e2e] border border-[#bfc9c4] dark:border-sky-800 text-[#191c1d] dark:text-white"
                id="btn-cancel-delete-reminder"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(reminder.id);
                  setConfirmingDelete(false);
                  onClose();
                }}
                className="py-2 rounded-full text-xs font-bold bg-[#ba1a1a] hover:bg-red-700 text-white"
                id="btn-confirm-delete-reminder"
              >
                Yes, delete
              </button>
            </div>
          </div>
        )}

        {/* Modal Action Buttons */}
        <div className="pt-2 border-t border-[#e1e3e4] dark:border-sky-900/40 space-y-2">
          {onSnooze && !reminder.isCompleted && (
            <div className="bg-[#f8fafb] dark:bg-[#07131e] p-3 rounded-2xl border border-[#e1e3e4] dark:border-sky-900/40 space-y-2">
              <span className="text-[10px] font-bold text-[#707975] dark:text-sky-300/70 uppercase tracking-wider block">
                Snooze alerts
              </span>
              <SnoozeOptions idPrefix="detail-snooze" onPick={(m) => onSnooze(reminder.id, m)} />
              {reminder.notificationSchedule?.snoozedUntil && new Date(reminder.notificationSchedule.snoozedUntil).getTime() > Date.now() && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  Snoozed until {new Date(reminder.notificationSchedule.snoozedUntil).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </div>
          )}
          <button
            onClick={() => {
              onToggleComplete(reminder.id);
              onClose();
            }}
            className={`w-full py-3 rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors ${
              reminder.isCompleted
                ? 'bg-[#f2f4f5] dark:bg-sky-900/40 text-[#3f4945] dark:text-sky-100 hover:bg-[#e1e3e4] dark:hover:bg-sky-900/60'
                : 'bg-[#0284c7] text-white hover:bg-[#0369a1]'
            }`}
            id="btn-modal-toggle-complete"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{reminder.isCompleted ? 'Mark as Active' : 'Mark as Completed'}</span>
          </button>

          {errors.export && (
            <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 text-center">{errors.export}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={exportCalendar}
              aria-haspopup="dialog"
              className="bg-white dark:bg-transparent border border-[#005faf] dark:border-sky-500 text-[#005faf] dark:text-sky-300 hover:bg-[#54a0fe]/10 py-2.5 rounded-full font-bold text-xs flex items-center justify-center gap-1.5"
              id="btn-modal-export-ical"
            >
              <Download className="w-4 h-4" />
              <span>Add to calendar</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="bg-white dark:bg-transparent border border-[#ba1a1a] dark:border-rose-400 text-[#ba1a1a] dark:text-rose-300 hover:bg-[#ffdad6]/20 dark:hover:bg-rose-950/40 py-2.5 rounded-full font-bold text-xs flex items-center justify-center gap-1.5"
              id="btn-modal-delete-reminder"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <CalendarExportSheet reminder={showExportSheet ? reminder : null} onClose={() => setShowExportSheet(false)} onShowToast={onShowToast} />
    </>
  );
};
