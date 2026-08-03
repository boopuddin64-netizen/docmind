import React, { useState } from 'react';
import { X, Calendar, Clock, User, Bell, Plus, Building } from 'lucide-react';
import { Reminder, ReminderCategory, UserProfile } from '../types';

interface AddManualModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  onAddReminder: (reminder: Reminder) => void;
}

export const AddManualModal: React.FC<AddManualModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  onAddReminder,
}) => {
  const [eventTitle, setEventTitle] = useState('');
  const [hospitalName, setHospitalName] = useState('St. Nicholas Hospital');
  const [patientName, setPatientName] = useState(userProfile.name);
  const [diagnosis, setDiagnosis] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('15/05/2024');
  const [appointmentTime, setAppointmentTime] = useState('10:00 AM');
  const [shortNote, setShortNote] = useState('');
  const [category, setCategory] = useState<ReminderCategory>('Checkup');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;

    const newReminder: Reminder = {
      id: `rem_${Date.now()}`,
      eventTitle,
      hospitalName,
      patientName,
      patientMatch: patientName.toLowerCase().includes('chidi')
        ? 'Matches Profile: Self'
        : 'Matches Profile: Family',
      diagnosis: diagnosis || 'Routine Medical Checkup',
      appointmentDate,
      appointmentTime,
      shortNote: shortNote || `Appointment at ${hospitalName} for ${patientName}`,
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
      <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-[#707975] hover:bg-[#eceeef] transition-colors"
          id="btn-close-add-manual"
        >
          <X className="w-5 h-5" />
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-xl bg-[#00342b] text-[#94d3c1]">
              <Plus className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-[#00342b]">
              Add New Reminder
            </h2>
          </div>
          <p className="text-xs text-[#3f4945]">
            Create a reminder for bills, contracts, vehicle maintenance, or appointments.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
              Event Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Pay Electricity Bill or Dental Review"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3.5 py-2.5 text-xs text-[#191c1d] focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1"
              id="input-manual-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2.5 text-xs text-[#191c1d] font-semibold focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1"
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
              <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
                Recipient / Member
              </label>
              <select
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-2.5 text-xs text-[#191c1d] font-semibold focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1"
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
            <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
              Issuer / Hospital / Provider / Organization
            </label>
            <input
              type="text"
              placeholder="e.g. Eko Electricity or St. Nicholas Hospital"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3.5 py-2.5 text-xs text-[#191c1d] focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1"
              id="input-manual-hospital"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
                Date (D/M/Y)
              </label>
              <input
                type="text"
                placeholder="15/05/2024"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3.5 py-2.5 text-xs text-[#191c1d] focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1"
                id="input-manual-date"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
                Time
              </label>
              <input
                type="text"
                placeholder="10:00 AM"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3.5 py-2.5 text-xs text-[#191c1d] focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1"
                id="input-manual-time"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
              Short Instructions / Notes
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Fast 8 hours before lab draw or bring previous X-rays"
              value={shortNote}
              onChange={(e) => setShortNote(e.target.value)}
              className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl p-3 text-xs text-[#191c1d] focus:outline-none focus:ring-2 focus:ring-[#00342b] mt-1 resize-none"
              id="textarea-manual-note"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#00342b] hover:bg-[#004d40] text-white py-3 rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-xs"
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
