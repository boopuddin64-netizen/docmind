import React, { useState } from 'react';
import { X, Bell, Plus } from 'lucide-react';
import { Reminder, ReminderCategory, UserProfile } from '../types';
import { selfMatchLabel } from '../lib/profileMatch';
import { validateDateField, validateTimeField } from '../lib/dateInput';
import { FIELD_LIMITS, clamp } from '../lib/formValidation';
import { useEscapeKey } from '../lib/useEscapeKey';

interface AddManualModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  onAddReminder: (reminder: Reminder) => void;
}

const LABEL = 'text-xs font-bold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider';
const FIELD =
  'w-full bg-[#f2f4f5] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-3.5 py-2.5 text-xs text-[#191c1d] dark:text-white placeholder:text-[#707975] dark:placeholder:text-sky-300/50 focus:outline-none focus:ring-2 focus:ring-[#0284c7] dark:focus:ring-sky-400 mt-1';
const FIELD_ERR = ' border-rose-500 dark:border-rose-400';

const todayDdMmYyyy = () => new Date().toLocaleDateString('en-GB');

export const AddManualModal: React.FC<AddManualModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  onAddReminder,
}) => {
  const [eventTitle, setEventTitle] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [patientName, setPatientName] = useState(userProfile.name);
  const [appointmentDate, setAppointmentDate] = useState(todayDdMmYyyy());
  const [appointmentTime, setAppointmentTime] = useState('08:00 AM');
  const [shortNote, setShortNote] = useState('');
  const [category, setCategory] = useState<ReminderCategory>('General');
  const [errors, setErrors] = useState<{ date?: string; time?: string }>({});

  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;

    const date = validateDateField(appointmentDate);
    const time = validateTimeField(appointmentTime);
    const next = {
      date: date.ok ? undefined : date.error,
      time: time.ok ? undefined : time.error,
    };
    setErrors(next);
    if (!date.ok || !time.ok) return;

    const title = clamp(eventTitle.trim(), FIELD_LIMITS.title);
    const issuer = clamp(hospitalName.trim(), FIELD_LIMITS.issuer);
    const newReminder: Reminder = {
      id: `rem_${Date.now()}`,
      eventTitle: title,
      hospitalName: issuer,
      patientName,
      patientMatch: selfMatchLabel(patientName, userProfile.name),
      diagnosis: title,
      appointmentDate: date.value,
      appointmentTime: time.value,
      shortNote: clamp(shortNote.trim(), FIELD_LIMITS.note) || (issuer ? `Reminder from ${issuer} for ${patientName}` : `Reminder for ${patientName}`),
      category,
      status: 'Confirmed',
      createdAt: new Date().toISOString(),
      isCompleted: false,
    };

    onAddReminder(newReminder);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-manual-title"
        className="bg-white dark:bg-[#0c1e2e] border border-transparent dark:border-sky-900/40 w-full max-w-md rounded-3xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close add reminder dialog"
          className="absolute top-4 right-4 p-2 rounded-full text-[#707975] dark:text-sky-300 hover:bg-[#eceeef] dark:hover:bg-sky-900/40 transition-colors"
          id="btn-close-add-manual"
        >
          <X className="w-5 h-5" />
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-xl bg-[#0284c7] text-white">
              <Plus className="w-5 h-5" />
            </div>
            <h2 id="add-manual-title" className="text-xl font-bold text-[#0284c7] dark:text-sky-300">
              Add New Reminder
            </h2>
          </div>
          <p className="text-xs text-[#3f4945] dark:text-sky-300/80">
            Create a reminder for bills, contracts, vehicle maintenance, or appointments.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          <div>
            <label htmlFor="input-manual-title" className={LABEL}>
              Event Title *
            </label>
            <input
              type="text"
              required
              maxLength={FIELD_LIMITS.title}
              placeholder="e.g. Pay electricity bill or Dental review"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              className={FIELD}
              id="input-manual-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="select-manual-category" className={LABEL}>
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                className={FIELD + ' font-semibold'}
                id="select-manual-category"
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
              <label htmlFor="select-manual-patient" className={LABEL}>
                Recipient / Member
              </label>
              <select
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className={FIELD + ' font-semibold'}
                id="select-manual-patient"
              >
                {userProfile.familyMembers.map((fam) => (
                  <option key={fam.id} value={fam.name}>
                    {fam.name} ({fam.relation})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="input-manual-hospital" className={LABEL}>
              Issuer / Provider / Organization
            </label>
            <input
              type="text"
              maxLength={FIELD_LIMITS.issuer}
              placeholder="e.g. Electricity company, clinic or landlord"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              className={FIELD}
              id="input-manual-hospital"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="input-manual-date" className={LABEL}>
                Date (D/M/Y)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={20}
                placeholder="15/05/2026"
                value={appointmentDate}
                onChange={(e) => {
                  setAppointmentDate(e.target.value);
                  if (errors.date) setErrors((p) => ({ ...p, date: undefined }));
                }}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? 'err-manual-date' : undefined}
                className={FIELD + (errors.date ? FIELD_ERR : '')}
                id="input-manual-date"
              />
              {errors.date && (
                <p id="err-manual-date" role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                  {errors.date}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="input-manual-time" className={LABEL}>
                Time
              </label>
              <input
                type="text"
                maxLength={12}
                placeholder="10:00 AM"
                value={appointmentTime}
                onChange={(e) => {
                  setAppointmentTime(e.target.value);
                  if (errors.time) setErrors((p) => ({ ...p, time: undefined }));
                }}
                aria-invalid={!!errors.time}
                aria-describedby={errors.time ? 'err-manual-time' : undefined}
                className={FIELD + (errors.time ? FIELD_ERR : '')}
                id="input-manual-time"
              />
              {errors.time && (
                <p id="err-manual-time" role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                  {errors.time}
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="textarea-manual-note" className={LABEL}>
              Short Instructions / Notes
            </label>
            <textarea
              rows={2}
              maxLength={FIELD_LIMITS.note}
              placeholder="e.g. Bring your ID card or previous receipts"
              value={shortNote}
              onChange={(e) => setShortNote(e.target.value)}
              className={FIELD + ' resize-none'}
              id="textarea-manual-note"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#0284c7] hover:bg-[#0369a1] dark:bg-sky-600 dark:hover:bg-sky-500 text-white py-3 rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
            id="btn-submit-manual-reminder"
          >
            <Bell className="w-4 h-4" />
            <span>Save Reminder</span>
          </button>
        </form>
      </div>
    </div>
  );
};
