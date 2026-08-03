import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  Calendar,
  CheckCircle2,
  Filter,
  FileText,
  AlertCircle,
  Tag,
  Download,
  Smartphone,
  Hand,
  X,
  Sparkles,
} from 'lucide-react';
import { Reminder, ReminderCategory, UserProfile } from '../types';
import { SwipeableReminderCard } from './SwipeableReminderCard';

interface AllRemindersScreenProps {
  reminders: Reminder[];
  userProfile: UserProfile;
  initialSearchQuery?: string;
  onSelectReminder: (reminder: Reminder) => void;
  onToggleComplete: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  onAddNewManual: () => void;
  onBackToHome: () => void;
}

export const AllRemindersScreen: React.FC<AllRemindersScreenProps> = ({
  reminders,
  userProfile,
  initialSearchQuery = '',
  onSelectReminder,
  onToggleComplete,
  onDeleteReminder,
  onAddNewManual,
  onBackToHome,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedPatient, setSelectedPatient] = useState<string>('All');
  const [showCompleted, setShowCompleted] = useState<boolean>(false);

  // Sync initial search query only when prop changes explicitly
  useEffect(() => {
    setSearchQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  const categories: string[] = [
    'All',
    'Medical',
    'Bills & Invoices',
    'Contracts & Legal',
    'Vehicle & Home',
    'Work & Study',
    'Subscriptions',
    'General',
  ];

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedPatient('All');
    setShowCompleted(false);
  };

  const isFiltered = searchQuery.trim() !== '' || selectedCategory !== 'All' || selectedPatient !== 'All' || showCompleted;

  const filteredReminders = reminders.filter((rem) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesCategory = selectedCategory === 'All' || rem.category === selectedCategory;
    const matchesPatient = selectedPatient === 'All' || rem.patientName === selectedPatient;
    const matchesCompletion = showCompleted ? rem.isCompleted : !rem.isCompleted;

    if (!q) return matchesCategory && matchesPatient && matchesCompletion;

    const terms = q.split(/\s+/).filter(Boolean);
    const searchableText = [
      rem.eventTitle,
      rem.hospitalName,
      rem.patientName,
      rem.patientMatch,
      rem.diagnosis,
      rem.shortNote,
      rem.fullText || '',
      rem.category,
      rem.appointmentDate,
      rem.appointmentTime,
      rem.status,
    ]
      .join(' ')
      .toLowerCase();

    const matchesSearch = terms.every((term) => searchableText.includes(term));

    return matchesSearch && matchesCategory && matchesPatient && matchesCompletion;
  });

  const exportCalendar = (rem: Reminder) => {
    const icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//DocReminder App//EN
BEGIN:VEVENT
SUMMARY:${rem.eventTitle}
DESCRIPTION:${rem.shortNote} - Hospital: ${rem.hospitalName} - Patient: ${rem.patientName}
LOCATION:${rem.hospitalName}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${rem.eventTitle.replace(/\s+/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafb] pb-28 px-4 pt-4">
      {/* Top Title & Quick Add Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#00342b] tracking-tight">
            All Reminders
          </h1>
          <p className="text-xs text-[#3f4945]">
            Manage your documents, bills, medical & life schedule
          </p>
        </div>

        <button
          onClick={onAddNewManual}
          className="bg-[#00342b] hover:bg-[#004d40] text-white p-2.5 rounded-full shadow-xs flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-[#94d3c1]"
          title="Add Manual Reminder"
          id="btn-add-manual-reminder"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="w-5 h-5 text-[#707975] absolute left-3.5 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search reminders by title, issuer, or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-[#e1e3e4] rounded-xl pl-10 pr-10 py-2.5 text-sm text-[#191c1d] focus:outline-none focus:ring-2 focus:ring-[#00342b] shadow-2xs"
            id="input-search-reminders"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-[#707975] hover:text-[#191c1d] p-0.5 rounded-full hover:bg-gray-100"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Active Filter Notice & One-click Reset */}
        {isFiltered && (
          <div className="flex items-center justify-between text-xs text-[#00342b] bg-[#afefdd]/50 px-3 py-1.5 rounded-xl border border-[#94d3c1] shadow-2xs">
            <span>
              Showing <strong>{filteredReminders.length}</strong> of <strong>{reminders.length}</strong> items
              {searchQuery && <span> for "<strong>{searchQuery}</strong>"</span>}
            </span>
            <button
              onClick={handleResetFilters}
              className="text-[11px] font-bold text-[#00342b] hover:underline bg-white/80 px-2 py-0.5 rounded-md border border-[#94d3c1]"
              id="btn-reset-filters"
            >
              Clear All Filters
            </button>
          </div>
        )}
      </div>

      {/* Patient & Status Filters Row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
          <select
            value={selectedPatient}
            onChange={(e) => setSelectedPatient(e.target.value)}
            className="bg-white border border-[#e1e3e4] text-xs font-semibold text-[#191c1d] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#00342b]"
            id="select-patient-filter"
          >
            <option value="All">All Family Members</option>
            {userProfile.familyMembers.map((fam) => (
              <option key={fam.id} value={fam.name}>
                {fam.name} ({fam.relation})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setShowCompleted(!showCompleted)}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1 shrink-0 ${
            showCompleted
              ? 'bg-[#afefdd] text-[#00342b] border-[#94d3c1]'
              : 'bg-white text-[#3f4945] border-[#e1e3e4]'
          }`}
          id="btn-toggle-completed"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{showCompleted ? 'Showing Completed' : 'Active Only'}</span>
        </button>
      </div>

      {/* Category Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`text-xs font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap transition-all ${
              selectedCategory === cat
                ? 'bg-[#00342b] text-white shadow-2xs'
                : 'bg-white text-[#3f4945] border border-[#e1e3e4] hover:bg-[#eceeef]'
            }`}
            id={`chip-category-${cat.replace(/\s+/g, '-').toLowerCase()}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Gesture Hint Banner */}
      <div className="flex items-center justify-between text-[11px] text-[#3f4945] bg-[#eceeef] rounded-xl px-3 py-2 border border-[#e1e3e4] mb-3">
        <div className="flex items-center gap-1.5 font-semibold text-[#00342b]">
          <Hand className="w-3.5 h-3.5 text-[#005faf]" />
          <span>Native Gestures:</span>
        </div>
        <span className="text-[10px] sm:text-[11px] text-[#707975]">
          Swipe right to complete • Swipe left to delete
        </span>
      </div>

      {/* List of Filtered Reminders */}
      <div className="space-y-3 flex-1">
        {filteredReminders.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-[#e1e3e4] mt-4">
            <div className="w-12 h-12 rounded-full bg-[#f2f4f5] text-[#707975] mx-auto flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-[#191c1d]">
              No reminders found
            </h3>
            <p className="text-xs text-[#707975] mt-1 max-w-xs mx-auto">
              {showCompleted
                ? 'No completed reminders found for this filter.'
                : 'No active reminders match your search criteria. Upload a document or add one manually!'}
            </p>
            <button
              onClick={onAddNewManual}
              className="mt-4 bg-[#00342b] text-white text-xs font-bold px-4 py-2 rounded-full"
            >
              + Create Reminder
            </button>
          </div>
        ) : (
          filteredReminders.map((rem) => (
            <SwipeableReminderCard
              key={rem.id}
              rem={rem}
              onSelectReminder={onSelectReminder}
              onToggleComplete={onToggleComplete}
              onDeleteReminder={onDeleteReminder}
              exportCalendar={exportCalendar}
            />
          ))
        )}
      </div>
    </div>
  );
};
