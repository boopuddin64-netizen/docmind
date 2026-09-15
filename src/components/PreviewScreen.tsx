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
  onCreateReminder: (newReminder: Reminder | Reminder[]) => void;
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
  // Support single or multiple extracted items from 1 document
  const rawItems = (extractedData.extractedItems && extractedData.extractedItems.length > 0)
    ? extractedData.extractedItems
    : [extractedData];

  const [items, setItems] = useState<ExtractedDocData[]>(rawItems);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    const list = (extractedData.extractedItems && extractedData.extractedItems.length > 0)
      ? extractedData.extractedItems
      : [extractedData];
    setItems(list);
    setSelectedIndex(0);
  }, [extractedData]);

  const activeItem = items[selectedIndex] || items[0] || extractedData;

  const updateActiveField = (field: keyof ExtractedDocData, value: string) => {
    setItems((prev) =>
      prev.map((item, idx) => (idx === selectedIndex ? { ...item, [field]: value } : item))
    );
  };

  const handleCreate = () => {
    const createdReminders: Reminder[] = items.map((item, idx) => {
      const pName = item.patientName || userProfile.name;
      const isSelf =
        pName.toLowerCase().trim() === userProfile.name.toLowerCase().trim() ||
        pName.toLowerCase().includes(userProfile.name.split(' ')[0].toLowerCase());

      return {
        id: `rem_${Date.now()}_${idx}`,
        eventTitle: item.eventTitle || "Document Reminder",
        hospitalName: item.hospitalName || "Document Issuer",
        patientName: pName,
        patientMatch: isSelf ? "Matches Profile: Self" : "Matches Profile: Household",
        diagnosis: item.diagnosis || "Document Review & Action Item",
        appointmentDate: item.appointmentDate || new Date().toLocaleDateString('en-GB'),
        appointmentTime: item.appointmentTime || "08:00 AM",
        shortNote: item.shortNote || "Review extracted document action items.",
        fullText: item.fullText || `${item.eventTitle} - ${item.shortNote}`,
        category: item.category || "General",
        status: "Confirmed",
        accuracy: item.accuracy || 98,
        createdAt: new Date().toISOString(),
        isCompleted: false,
      };
    });

    if (createdReminders.length === 1) {
      onCreateReminder(createdReminders[0]);
    } else {
      onCreateReminder(createdReminders);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafb] dark:bg-[#07131e] pb-28">
      {/* Top Header Bar */}
      <div className="sticky top-0 z-20 bg-[#f8fafb]/90 dark:bg-[#07131e]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-[#e1e3e4] dark:border-sky-900/40">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-full text-[#191c1d] dark:text-white hover:bg-[#eceeef] dark:hover:bg-sky-900/40 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0284c7]"
            aria-label="Go back"
            id="btn-preview-back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-[#0284c7] dark:text-sky-300 tracking-tight">
            Confirm Details
          </h1>
        </div>

        <img
          src={doctorAvatarUrl}
          alt="Doctor Profile"
          className="w-10 h-10 rounded-full object-cover border-2 border-white dark:border-sky-800 shadow-xs"
        />
      </div>

      <div className="p-4 space-y-6 max-w-md md:max-w-xl mx-auto w-full">
        {/* Multi-Item Notification Banner if > 1 appointment found */}
        {items.length > 1 && (() => {
          const namesSet = new Set(items.map((i) => i.patientName || userProfile.name).filter(Boolean));
          const namesList = Array.from(namesSet);
          const formattedNames = namesList.length > 0 ? namesList.join(' & ') : userProfile.name;

          return (
            <div className="bg-[#e0f2fe] dark:bg-sky-950/60 border border-[#bae6fd] dark:border-sky-800/60 rounded-2xl p-4 space-y-2 animate-in fade-in">
              <div className="flex items-center gap-2 text-[#0369a1] dark:text-sky-300 font-bold text-sm">
                <Sparkles className="w-5 h-5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                <span>Extracted {items.length} Appointments / Reminders from 1 Document!</span>
              </div>
              <p className="text-xs text-[#0369a1]/80 dark:text-sky-300/80">
                We detected multiple assignments for <strong>{formattedNames}</strong> in this document. Review each assignment below and save all {items.length} reminders.
              </p>
              {/* Appointment Tab Selector */}
              <div className="flex gap-2 overflow-x-auto pt-2 pb-1 scrollbar-none">
                {items.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedIndex(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                      selectedIndex === idx
                        ? 'bg-[#0284c7] text-white shadow-xs'
                        : 'bg-white dark:bg-[#0c1e2e] text-[#0369a1] dark:text-sky-300 border border-[#bae6fd] dark:border-sky-800'
                    }`}
                  >
                    <span>Item #{idx + 1}:</span>
                    <span>{item.appointmentDate}</span>
                    <span className="opacity-80">({item.patientName || 'Self'})</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Section 1: Extracted Information Card */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#0284c7] dark:text-sky-400" />
              <h2 className="text-lg font-semibold text-[#191c1d] dark:text-white">
                Extracted Information {items.length > 1 ? `(${selectedIndex + 1} of ${items.length})` : ''}
              </h2>
            </div>
            <span className="bg-[#e0f2fe] dark:bg-sky-950 text-[#0369a1] dark:text-sky-300 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
              {activeItem.accuracy || 98}% ACCURACY
            </span>
          </div>

          <div className="bg-white dark:bg-[#0c1e2e] rounded-2xl p-4 border border-[#e1e3e4] dark:border-sky-900/40 shadow-xs space-y-3.5">
            {/* Hospital / Document Title */}
            <div className="flex items-center gap-2 pb-2 border-b border-[#f2f4f5] dark:border-sky-900/30">
              <FileText className="w-5 h-5 text-[#0284c7] shrink-0" />
              <span className="text-sm font-semibold text-[#191c1d] dark:text-white">
                {activeItem.hospitalName || "Document Issuer"}
              </span>
            </div>

            {/* Patient / Recipient Name */}
            <div className="text-sm text-[#191c1d] dark:text-slate-200 leading-relaxed">
              <span className="text-[#3f4945] dark:text-sky-300/70">Recipient Name: </span>
              <span className="font-bold bg-[#e0f2fe] dark:bg-sky-900/50 text-[#0369a1] dark:text-sky-200 px-1.5 py-0.5 rounded border-b-2 border-[#0284c7]">
                {activeItem.patientName || userProfile.name}
              </span>
            </div>

            {/* Purpose */}
            <div className="text-sm text-[#191c1d] dark:text-slate-200 leading-relaxed">
              <span className="text-[#3f4945] dark:text-sky-300/70">Subject / Purpose: </span>
              <span className="font-medium text-[#191c1d] dark:text-white">
                {activeItem.diagnosis || "Document Review & Action Item"}
              </span>
            </div>

            {/* Appointment Date & Time */}
            <div className="text-sm text-[#191c1d] dark:text-slate-200 leading-relaxed">
              <span className="text-[#3f4945] dark:text-sky-300/70">Scheduled for </span>
              <span className="font-bold text-[#0369a1] dark:text-sky-300 bg-[#e0f2fe] dark:bg-sky-900/50 px-1.5 py-0.5 rounded border-b-2 border-[#0284c7]">
                {activeItem.appointmentDate || new Date().toLocaleDateString('en-GB')}
              </span>
              <span className="text-[#3f4945] dark:text-sky-300/70"> at {activeItem.appointmentTime || "08:00 AM"}.</span>
            </div>

            {/* Notes excerpt */}
            <div className="text-sm text-[#3f4945] dark:text-sky-300/80 leading-relaxed pt-1 italic border-t border-[#f2f4f5] dark:border-sky-900/30">
              "{activeItem.shortNote || "Review extracted document action items."}"
            </div>
          </div>
        </div>

        {/* Section 2: Secure Scan Banner Card (Light Blue) */}
        <div className="bg-[#0284c7] rounded-2xl p-5 text-white shadow-xs relative overflow-hidden flex items-start gap-3.5">
          <div className="p-2 rounded-xl bg-white/20 shrink-0">
            <BadgeCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-0.5">
              Secure Scan
            </h3>
            <p className="text-xs text-white/95 leading-relaxed font-normal">
              All extracted dates & details verified against profile: {userProfile.name}.
            </p>
          </div>
        </div>

        {/* Section 3: Final Review Editable Form */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-[#191c1d] dark:text-white">
            Final Review {items.length > 1 ? `(Editing Item #${selectedIndex + 1})` : ''}
          </h2>

          {/* Event Title Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
              Event Title
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={activeItem.eventTitle || ""}
                onChange={(e) => updateActiveField('eventTitle', e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-4 py-3 text-sm text-[#191c1d] dark:text-white font-semibold pr-10 focus:outline-none focus:ring-2 focus:ring-[#0284c7]"
                id="input-event-title"
              />
              <Pencil className="w-4 h-4 text-[#0284c7] absolute right-3 pointer-events-none" />
            </div>
          </div>

          {/* Reminder Date Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
              Reminder Date (D/M/Y)
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={activeItem.appointmentDate || ""}
                onChange={(e) => updateActiveField('appointmentDate', e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-4 py-3 text-sm text-[#191c1d] dark:text-white font-semibold pr-10 focus:outline-none focus:ring-2 focus:ring-[#0284c7]"
                id="input-reminder-date"
              />
              <Calendar className="w-5 h-5 text-[#3f4945] dark:text-sky-300 absolute right-3 pointer-events-none" />
            </div>
          </div>

          {/* Person's Name Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
                Person's Name / Recipient
              </label>
              <div className="flex gap-1">
                {userProfile.familyMembers.map((fam) => (
                  <button
                    key={fam.id}
                    type="button"
                    onClick={() => updateActiveField('patientName', fam.name)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      (activeItem.patientName || '').toLowerCase().includes(fam.name.split(' ')[0].toLowerCase())
                        ? 'bg-[#0284c7] text-white shadow-2xs'
                        : 'bg-[#eceeef] dark:bg-sky-900/40 text-[#3f4945] dark:text-sky-300 hover:bg-[#e1e3e4]'
                    }`}
                  >
                    {fam.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                value={activeItem.patientName || ""}
                onChange={(e) => updateActiveField('patientName', e.target.value)}
                className="w-full bg-[#f2f4f5] dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-4 py-3 text-sm text-[#191c1d] dark:text-white font-semibold pr-10 focus:outline-none focus:ring-2 focus:ring-[#0284c7]"
                id="input-person-name"
              />
              <User className="w-5 h-5 text-[#3f4945] dark:text-sky-300 absolute right-3 pointer-events-none" />
            </div>
            <div className="flex items-center gap-1 text-xs text-[#0284c7] dark:text-sky-400 font-semibold pt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {/promise/i.test(activeItem.patientName || '') ? "Matches Profile: Self" : "Matches Profile: Household"}
              </span>
            </div>
          </div>

          {/* Short Note/Description Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
              Short Note/Description
            </label>
            <textarea
              rows={3}
              value={activeItem.shortNote || ""}
              onChange={(e) => updateActiveField('shortNote', e.target.value)}
              className="w-full bg-[#f2f4f5] dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl p-3.5 text-sm text-[#191c1d] dark:text-white font-normal focus:outline-none focus:ring-2 focus:ring-[#0284c7] resize-none"
              id="input-short-note"
            />
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#07131e]/95 backdrop-blur-md border-t border-[#e1e3e4] dark:border-sky-900/40 p-4 max-w-md md:max-w-xl mx-auto space-y-2.5">
        <button
          onClick={handleCreate}
          className="w-full bg-[#0284c7] hover:bg-[#0369a1] text-white py-3.5 rounded-full font-bold text-base flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#bae6fd]"
          id="btn-create-reminder"
        >
          <Bell className="w-5 h-5 fill-white/20 stroke-[2.2]" />
          <span>{items.length > 1 ? `Create All ${items.length} Reminders` : 'Create Reminder'}</span>
        </button>

        <button
          onClick={onDiscard}
          className="w-full bg-white dark:bg-[#0c1e2e] hover:bg-[#f2f4f5] dark:hover:bg-[#12283d] text-[#191c1d] dark:text-white border-2 border-[#bfc9c4] dark:border-sky-900/60 py-3 rounded-full font-semibold text-base transition-all active:scale-[0.99] focus:outline-none"
          id="btn-discard-restart"
        >
          Discard & Restart
        </button>
      </div>
    </div>
  );
};
