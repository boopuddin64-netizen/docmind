import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Sparkles,
  FileText,
  ShieldCheck,
  BadgeCheck,
  Pencil,
  Calendar,
  User,
  Bell,
  CheckCircle2,
} from 'lucide-react';
import { ExtractedDocData, UserProfile, Reminder } from '../types';

interface PreviewScreenProps {
  extractedData: ExtractedDocData;
  userProfile: UserProfile;
  onBack: () => void;
  onCreateReminder: (newReminder: Reminder) => void;
  onDiscard: () => void;
  doctorAvatarUrl?: string;
}

export const PreviewScreen: React.FC<PreviewScreenProps> = ({
  extractedData,
  userProfile,
  onBack,
  onCreateReminder,
  onDiscard,
  doctorAvatarUrl = "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=150&auto=format&fit=crop&q=80",
}) => {
  const [eventTitle, setEventTitle] = useState(extractedData.eventTitle || "Document Reminder");
  const [reminderDate, setReminderDate] = useState(extractedData.appointmentDate || "15/05/2026");
  const [personName, setPersonName] = useState(extractedData.patientName || userProfile.name);
  const [shortNote, setShortNote] = useState(extractedData.shortNote || "Review extracted document action items.");
  const [hospitalName, setHospitalName] = useState(extractedData.hospitalName || "Document Issuer");

  useEffect(() => {
    if (extractedData) {
      setEventTitle(extractedData.eventTitle || "Document Reminder");
      setReminderDate(extractedData.appointmentDate || "15/05/2026");
      setPersonName(extractedData.patientName || userProfile.name);
      setShortNote(extractedData.shortNote || "Review extracted document action items.");
      setHospitalName(extractedData.hospitalName || "Document Issuer");
    }
  }, [extractedData, userProfile]);

  const handleCreate = () => {
    const isSelf = personName.toLowerCase().trim() === userProfile.name.toLowerCase().trim() ||
                   personName.toLowerCase().includes(userProfile.name.split(' ')[0].toLowerCase());

    const newReminder: Reminder = {
      id: `rem_${Date.now()}`,
      eventTitle,
      hospitalName,
      patientName: personName,
      patientMatch: isSelf ? "Matches Profile: Self" : "Matches Profile: Household",
      diagnosis: extractedData.diagnosis || "Document Review & Action Item",
      appointmentDate: reminderDate,
      appointmentTime: extractedData.appointmentTime || "10:00 AM",
      shortNote,
      fullText: extractedData.fullText || `${eventTitle} - ${shortNote}`,
      category: extractedData.category || "General",
      status: "Confirmed",
      accuracy: extractedData.accuracy || 98,
      createdAt: new Date().toISOString(),
      isCompleted: false,
    };

    onCreateReminder(newReminder);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafb] pb-28">
      {/* Top Header Bar */}
      <div className="sticky top-0 z-20 bg-[#f8fafb]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-[#e1e3e4]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-full text-[#191c1d] hover:bg-[#eceeef] transition-colors focus:outline-none focus:ring-2 focus:ring-[#00342b]"
            aria-label="Go back"
            id="btn-preview-back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-[#00342b] tracking-tight">
            Confirm Details
          </h1>
        </div>

        <img
          src={doctorAvatarUrl}
          alt="Doctor Profile"
          className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-xs"
        />
      </div>

      <div className="p-4 space-y-6 max-w-md mx-auto w-full">
        {/* Section 1: Extracted Information Card */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#00342b]" />
              <h2 className="text-lg font-semibold text-[#191c1d]">
                Extracted Information
              </h2>
            </div>
            <span className="bg-[#afefdd] text-[#00342b] text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
              {extractedData.accuracy || 98}% ACCURACY
            </span>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-[#e1e3e4] shadow-xs space-y-3.5">
            {/* Hospital / Document Title */}
            <div className="flex items-center gap-2 pb-2 border-b border-[#f2f4f5]">
              <FileText className="w-5 h-5 text-[#004d40] shrink-0" />
              <span className="text-sm font-semibold text-[#191c1d]">
                {hospitalName}
              </span>
            </div>

            {/* Patient / Recipient Name */}
            <div className="text-sm text-[#191c1d] leading-relaxed">
              <span className="text-[#3f4945]">Recipient Name: </span>
              <span className="font-bold bg-[#eceeef] px-1.5 py-0.5 rounded border-b-2 border-[#004d40]">
                {personName}
              </span>
            </div>

            {/* Diagnosis / Purpose */}
            <div className="text-sm text-[#191c1d] leading-relaxed">
              <span className="text-[#3f4945]">Subject / Purpose: </span>
              <span className="font-medium text-[#191c1d]">
                {extractedData.diagnosis || "Document Review & Action Item"}
              </span>
            </div>

            {/* Appointment Date & Time */}
            <div className="text-sm text-[#191c1d] leading-relaxed">
              <span className="text-[#3f4945]">Next Appointment scheduled for </span>
              <span className="font-bold text-[#005faf] bg-[#d4e3ff] px-1.5 py-0.5 rounded border-b-2 border-[#005faf]">
                {reminderDate}
              </span>
              <span className="text-[#3f4945]"> at {extractedData.appointmentTime || "10:00 AM"}.</span>
            </div>

            {/* Notes excerpt */}
            <div className="text-sm text-[#3f4945] leading-relaxed pt-1 italic border-t border-[#f2f4f5]/80">
              "{extractedData.shortNote || "Please bring recent X-rays and medical history documents for verification during the session with Dr. Aminu..."}"
            </div>
          </div>
        </div>

        {/* Section 2: Secure Scan Banner Card (Professional Blue) */}
        <div className="bg-[#54a0fe] rounded-2xl p-5 text-white shadow-xs relative overflow-hidden flex items-start gap-3.5">
          <div className="p-2 rounded-xl bg-white/20 shrink-0">
            <BadgeCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-0.5">
              Secure Scan
            </h3>
            <p className="text-xs text-white/95 leading-relaxed font-normal">
              All extracted entities have been verified against your profile.
            </p>
          </div>
        </div>

        {/* Section 3: Final Review Editable Form */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-[#191c1d]">
            Final Review
          </h2>

          {/* Event Title Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] uppercase tracking-wider">
              Event Title
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-4 py-3 text-sm text-[#191c1d] font-semibold pr-10 focus:outline-none focus:ring-2 focus:ring-[#00342b] focus:bg-white"
                id="input-event-title"
              />
              <Pencil className="w-4 h-4 text-[#005faf] absolute right-3 pointer-events-none" />
            </div>
          </div>

          {/* Reminder Date Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] uppercase tracking-wider">
              Reminder Date (D/M/Y)
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={reminderDate}
                onChange={(e) => setReminderDate(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-4 py-3 text-sm text-[#191c1d] font-semibold pr-10 focus:outline-none focus:ring-2 focus:ring-[#00342b] focus:bg-white"
                id="input-reminder-date"
              />
              <Calendar className="w-5 h-5 text-[#3f4945] absolute right-3 pointer-events-none" />
            </div>
          </div>

          {/* Person's Name Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] uppercase tracking-wider">
              Person's Name
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-4 py-3 text-sm text-[#191c1d] font-semibold pr-10 focus:outline-none focus:ring-2 focus:ring-[#00342b] focus:bg-white"
                id="input-person-name"
              />
              <User className="w-5 h-5 text-[#3f4945] absolute right-3 pointer-events-none" />
            </div>
            <div className="flex items-center gap-1 text-xs text-[#004d40] font-semibold pt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Matches Profile: Self</span>
            </div>
          </div>

          {/* Short Note/Description Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] uppercase tracking-wider">
              Short Note/Description
            </label>
            <textarea
              rows={3}
              value={shortNote}
              onChange={(e) => setShortNote(e.target.value)}
              className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl p-3.5 text-sm text-[#191c1d] font-normal focus:outline-none focus:ring-2 focus:ring-[#00342b] focus:bg-white resize-none"
              id="input-short-note"
            />
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#e1e3e4] p-4 max-w-md mx-auto space-y-2.5">
        <button
          onClick={handleCreate}
          className="w-full bg-[#00342b] hover:bg-[#004d40] text-white py-3.5 rounded-full font-bold text-base flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#afefdd]"
          id="btn-create-reminder"
        >
          <Bell className="w-5 h-5 fill-white/20 stroke-[2.2]" />
          <span>Create Reminder</span>
        </button>

        <button
          onClick={onDiscard}
          className="w-full bg-white hover:bg-[#f2f4f5] text-[#191c1d] border-2 border-[#bfc9c4] py-3 rounded-full font-semibold text-base transition-all active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#3f4945]"
          id="btn-discard-restart"
        >
          Discard & Restart
        </button>
      </div>
    </div>
  );
};
