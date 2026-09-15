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
import { Reminder, ReminderCategory } from '../types';
import { downloadIcsCalendar } from '../lib/icalHelper';

interface ReminderDetailModalProps {
  reminder: Reminder | null;
  onClose: () => void;
  onToggleComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateReminder?: (updated: Reminder) => void;
}

export const ReminderDetailModal: React.FC<ReminderDetailModalProps> = ({
  reminder,
  onClose,
  onToggleComplete,
  onDelete,
  onUpdateReminder,
}) => {
  if (!reminder) return null;

  const [isEditing, setIsEditing] = React.useState<boolean>(false);
  const [eventTitle, setEventTitle] = React.useState<string>(reminder.eventTitle);
  const [category, setCategory] = React.useState<ReminderCategory>(reminder.category);
  const [patientName, setPatientName] = React.useState<string>(reminder.patientName);
  const [hospitalName, setHospitalName] = React.useState<string>(reminder.hospitalName);
  const [appointmentDate, setAppointmentDate] = React.useState<string>(reminder.appointmentDate);
  const [appointmentTime, setAppointmentTime] = React.useState<string>(reminder.appointmentTime);
  const [diagnosis, setDiagnosis] = React.useState<string>(reminder.diagnosis);
  const [shortNote, setShortNote] = React.useState<string>(reminder.shortNote);

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
    }
  }, [reminder]);

  const handleSave = () => {
    if (!onUpdateReminder) return;
    const updated: Reminder = {
      ...reminder,
      eventTitle,
      category,
      patientName,
      patientMatch: (/promise/i.test(patientName) || patientName.toLowerCase() === 'self')
        ? 'Matches Profile: Self'
        : 'Matches Profile: Household',
      hospitalName,
      appointmentDate,
      appointmentTime,
      diagnosis,
      shortNote,
    };
    onUpdateReminder(updated);
    setIsEditing(false);
  };

  const exportCalendar = () => {
    if (!reminder) return;
    downloadIcsCalendar(reminder);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-[#707975] hover:bg-[#eceeef] transition-colors"
          id="btn-close-detail-modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Close & Edit Header Buttons */}
        <div className="flex items-center justify-between border-b border-[#e1e3e4] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#0284c7] text-white">
              {category}
            </span>
            <span className="text-xs font-bold text-[#005faf] bg-[#d4e3ff] px-2.5 py-1 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              {reminder.status}
            </span>
          </div>

          <div className="flex items-center gap-2 pr-8">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs font-bold text-[#005faf] bg-[#d4e3ff] hover:bg-[#54a0fe]/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
              id="btn-toggle-edit-reminder"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Cancel Edit' : 'Edit Details'}</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full text-[#707975] hover:bg-[#eceeef] transition-colors"
            id="btn-close-detail-modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Edit Form OR View Mode */}
        {isEditing ? (
          <div className="space-y-3 pt-1">
            <h3 className="text-sm font-bold text-[#0284c7] uppercase tracking-wider">
              Edit Reminder Details
            </h3>

            <div>
              <label className="text-[11px] font-bold text-[#3f4945] uppercase">Event Title</label>
              <input
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2 text-xs font-bold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-[#3f4945] uppercase">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                  className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-2.5 py-2 text-xs font-bold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
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
                <label className="text-[11px] font-bold text-[#3f4945] uppercase">Recipient Name</label>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-[#3f4945] uppercase">Issuer / Provider / Hospital</label>
              <input
                type="text"
                value={hospitalName}
                onChange={(e) => setHospitalName(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-[#3f4945] uppercase">Due / Appt Date</label>
                <input
                  type="text"
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                  className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#3f4945] uppercase">Time</label>
                <input
                  type="text"
                  value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)}
                  className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-[#3f4945] uppercase">Subject / Diagnosis / Purpose</label>
              <input
                type="text"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2 text-xs font-semibold text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-[#3f4945] uppercase">Notes & Instructions</label>
              <textarea
                rows={2}
                value={shortNote}
                onChange={(e) => setShortNote(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl p-3 text-xs font-normal text-[#191c1d] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0284c7] mt-0.5 resize-none"
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
              <h2 className="text-xl font-extrabold text-[#191c1d] leading-snug">
                {reminder.eventTitle}
              </h2>
              <p className="text-xs font-semibold text-[#005faf] mt-1 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 shrink-0" />
                {reminder.hospitalName}
              </p>
            </div>

            {/* Key Info Grid */}
            <div className="bg-[#f8fafb] rounded-2xl p-4 border border-[#e1e3e4] space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#e1e3e4]">
                <span className="text-[#707975] flex items-center gap-1.5">
                  <User className="w-4 h-4 text-[#0284c7]" /> Recipient:
                </span>
                <span className="font-bold text-[#191c1d]">
                  {reminder.patientName}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#e1e3e4]">
                <span className="text-[#707975] flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#005faf]" /> Date & Time:
                </span>
                <span className="font-bold text-[#005faf]">
                  {reminder.appointmentDate} at {reminder.appointmentTime}
                </span>
              </div>

              <div className="text-xs space-y-1">
                <span className="text-[#707975] flex items-center gap-1.5 font-medium">
                  <FileText className="w-4 h-4 text-[#0284c7]" /> Subject / Purpose:
                </span>
                <p className="font-semibold text-[#191c1d] pl-5">
                  {reminder.diagnosis}
                </p>
              </div>
            </div>

            {/* Short Note */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
                Preparation & Instructions:
              </label>
              <div className="bg-[#f2f4f5] p-3.5 rounded-xl border border-[#e1e3e4] text-xs text-[#191c1d] leading-relaxed">
                {reminder.shortNote}
              </div>
            </div>

            {/* Original Document Extracted Snippet */}
            {reminder.fullText && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-[#005faf]" /> Original Scan
                    Text
                  </label>
                  <span className="text-[10px] text-[#707975]">Verified</span>
                </div>
                <pre className="bg-[#0f172a] text-[#bae6fd] p-3.5 rounded-xl text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {reminder.fullText}
                </pre>
              </div>
            )}
          </>
        )}

        {/* Modal Action Buttons */}
        <div className="pt-2 border-t border-[#e1e3e4] space-y-2">
          <button
            onClick={() => {
              onToggleComplete(reminder.id);
              onClose();
            }}
            className={`w-full py-3 rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors ${
              reminder.isCompleted
                ? 'bg-[#f2f4f5] text-[#3f4945] hover:bg-[#e1e3e4]'
                : 'bg-[#0284c7] text-white hover:bg-[#0369a1]'
            }`}
            id="btn-modal-toggle-complete"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{reminder.isCompleted ? 'Mark as Active' : 'Mark as Completed'}</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={exportCalendar}
              className="bg-white border border-[#005faf] text-[#005faf] hover:bg-[#54a0fe]/10 py-2.5 rounded-full font-bold text-xs flex items-center justify-center gap-1.5"
              id="btn-modal-export-ical"
            >
              <Download className="w-4 h-4" />
              <span>Export iCal</span>
            </button>

            <button
              onClick={() => {
                onDelete(reminder.id);
                onClose();
              }}
              className="bg-white border border-[#ba1a1a] text-[#ba1a1a] hover:bg-[#ffdad6]/20 py-2.5 rounded-full font-bold text-xs flex items-center justify-center gap-1.5"
              id="btn-modal-delete-reminder"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
