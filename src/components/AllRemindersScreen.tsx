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
import { downloadIcsCalendar } from '../lib/icalHelper';

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

  const mainUserName = userProfile?.name || 'Promise Ledum';
  const registeredFamily = (userProfile?.familyMembers || []).map((f) => f.name).filter(Boolean);
  const allRegisteredProfileNames = Array.from(new Set([mainUserName, ...registeredFamily]));

  const isMainUser = (nameStr: string) => {
    const n = (nameStr || '').toLowerCase().trim();
    const mainFirst = mainUserName.split(' ')[0].toLowerCase();
    return n.includes(mainFirst) || n === 'self' || n === 'primary';
  };

  const isRegisteredFamilyMember = (nameStr: string) => {
    const n = (nameStr || '').toLowerCase().trim();
    return registeredFamily.some((famName) => {
      const fn = famName.toLowerCase().trim();
      return n.includes(fn) || fn.includes(n);
    });
  };

  const matchesFamilyMember = (remPatient: string, selPatient: string) => {
    if (!selPatient || selPatient === 'All') return true;

    if (selPatient === 'Self' || isMainUser(selPatient)) {
      return isMainUser(remPatient);
    }

    const r = (remPatient || '').toLowerCase().trim();
    const s = (selPatient || '').toLowerCase().trim();
    return r === s || r.includes(s) || s.includes(r);
  };

  const filteredReminders = reminders.filter((rem) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesCategory = selectedCategory === 'All' || rem.category === selectedCategory;
    const matchesPatient = matchesFamilyMember(rem.patientName, selectedPatient);
    const matchesCompletion = showCompleted ? rem.isCompleted : !rem.isCompleted;

    if (!matchesCategory || !matchesPatient || !matchesCompletion) return false;
    if (!q) return true;

    const terms = q.split(/\s+/).filter(Boolean);

    // Strict person-query guard:
    const isSearchingSelf = terms.includes('self') || terms.includes('primary');
    const isSearchingHousehold = terms.includes('household') || terms.includes('family');

    const remIsMainUser = isMainUser(rem.patientName);
    const remIsRegisteredFamily = isRegisteredFamilyMember(rem.patientName);

    if (isSearchingSelf && !remIsMainUser) {
      return false; // Prevent non-primary reminders from appearing in "self" search
    }

    if (isSearchingHousehold && !remIsRegisteredFamily) {
      return false; // Only allow registered household members in household search
    }

    // Guard: If user searches for a specific household name term, verify it is registered in profile!
    const namesInQuery = terms.filter((term) =>
      ['pagbara', 'ledum', 'sarah', 'john', 'chidi', 'david'].includes(term) && !mainUserName.toLowerCase().includes(term)
    );
    if (namesInQuery.length > 0) {
      const hasRegisteredMatchInQuery = namesInQuery.some((term) =>
        allRegisteredProfileNames.some((regName) => regName.toLowerCase().includes(term))
      );
      if (!hasRegisteredMatchInQuery) {
        return false; // Reject search for unregistered household names
      }
    }

    // Date expansion helper
    const monthNames = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];
    const shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];

    let expandedDateText = rem.appointmentDate || '';
    const dateParts = (rem.appointmentDate || '').split(/[\/\.-]/);
    if (dateParts.length === 3) {
      const dayNum = parseInt(dateParts[0], 10);
      const monthNum = parseInt(dateParts[1], 10);
      const yearNum = parseInt(dateParts[2], 10);
      if (!isNaN(dayNum) && !isNaN(monthNum) && !isNaN(yearNum) && monthNum >= 1 && monthNum <= 12) {
        const fullM = monthNames[monthNum - 1];
        const shortM = shortMonths[monthNum - 1];
        expandedDateText += ` ${fullM} ${shortM} ${dayNum} ${dayNum}th ${shortM} ${dayNum} ${fullM} ${dayNum} ${monthNum}/${dayNum} ${dayNum}/${monthNum} ${yearNum}`;
      }
    }

    let expandedNameText = rem.patientName || '';
    const effectivePatientMatch = remIsMainUser
      ? 'Matches Profile: Self'
      : (remIsRegisteredFamily ? 'Matches Profile: Household' : rem.patientMatch);

    if (remIsMainUser) {
      expandedNameText += ' self primary account ' + mainUserName.toLowerCase();
    } else if (remIsRegisteredFamily) {
      expandedNameText += ' household family member ' + registeredFamily.join(' ').toLowerCase();
    }

    const searchableText = [
      rem.eventTitle,
      rem.hospitalName,
      rem.patientName,
      expandedNameText,
      effectivePatientMatch,
      rem.diagnosis,
      rem.shortNote,
      rem.category,
      rem.appointmentDate,
      expandedDateText,
      rem.appointmentTime,
      rem.status,
      ...(isSearchingSelf || isSearchingHousehold ? [] : [rem.fullText || '']),
    ]
      .join(' ')
      .toLowerCase();

    const matchedCount = terms.filter((term) => searchableText.includes(term)).length;

    return matchedCount === terms.length || (terms.length >= 3 && matchedCount >= Math.ceil(terms.length * 0.75));
  });

  const exportCalendar = (rem: Reminder) => {
    downloadIcsCalendar(rem);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafb] dark:bg-[#07131e] pb-36 px-4 sm:px-6 pt-4">
      {/* Top Title & Quick Add Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0284c7] dark:text-sky-300 tracking-tight">
            All Reminders
          </h1>
          <p className="text-xs text-[#3f4945] dark:text-sky-400/70">
            Manage your documents, bills, medical & life schedule
          </p>
        </div>

        <button
          onClick={onAddNewManual}
          className="bg-[#0284c7] hover:bg-[#0369a1] text-white p-2.5 rounded-full shadow-xs flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-[#bae6fd]"
          title="Add Manual Reminder"
          id="btn-add-manual-reminder"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="w-5 h-5 text-[#707975] dark:text-sky-300/60 absolute left-3.5 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search reminders by title, issuer, or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/40 rounded-xl pl-10 pr-10 py-2.5 text-sm text-[#191c1d] dark:text-white placeholder:text-[#707975] dark:placeholder:text-sky-300/50 focus:outline-none focus:ring-2 focus:ring-[#0284c7] shadow-2xs"
            id="input-search-reminders"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-[#707975] dark:text-sky-300 hover:text-[#191c1d] p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-sky-900"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Active Filter Notice & One-click Reset */}
        {isFiltered && (
          <div className="flex items-center justify-between text-xs text-[#0369a1] dark:text-sky-200 bg-[#e0f2fe]/60 dark:bg-sky-950/60 px-3 py-1.5 rounded-xl border border-[#bae6fd] dark:border-sky-800 shadow-2xs">
            <span>
              Showing <strong>{filteredReminders.length}</strong> of <strong>{reminders.length}</strong> items
              {searchQuery && <span> for "<strong>{searchQuery}</strong>"</span>}
            </span>
            <button
              onClick={handleResetFilters}
              className="text-[11px] font-bold text-[#0369a1] dark:text-sky-300 hover:underline bg-white/80 dark:bg-sky-900/80 px-2 py-0.5 rounded-md border border-[#bae6fd] dark:border-sky-700"
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
            className="bg-white dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/40 text-xs font-semibold text-[#191c1d] dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0284c7]"
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
              ? 'bg-[#e0f2fe] dark:bg-sky-900 text-[#0369a1] dark:text-sky-200 border-[#bae6fd] dark:border-sky-700'
              : 'bg-white dark:bg-[#0c1e2e] text-[#3f4945] dark:text-sky-300 border-[#e1e3e4] dark:border-sky-900/40'
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
                ? 'bg-[#0284c7] dark:bg-sky-600 text-white shadow-2xs'
                : 'bg-white dark:bg-[#0c1e2e] text-[#3f4945] dark:text-sky-300 border border-[#e1e3e4] dark:border-sky-900/40 hover:bg-[#eceeef] dark:hover:bg-sky-900/40'
            }`}
            id={`chip-category-${cat.replace(/\s+/g, '-').toLowerCase()}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Gesture Hint Banner */}
      <div className="flex items-center justify-between text-[11px] text-[#3f4945] dark:text-sky-300/80 bg-[#eceeef] dark:bg-[#0c1e2e] rounded-xl px-3 py-2 border border-[#e1e3e4] dark:border-sky-900/40 mb-3">
        <div className="flex items-center gap-1.5 font-semibold text-[#0284c7] dark:text-sky-300">
          <Hand className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
          <span>Native Gestures:</span>
        </div>
        <span className="text-[10px] sm:text-[11px] text-[#707975] dark:text-sky-300/60">
          Swipe right to complete • Swipe left to delete
        </span>
      </div>

      {/* List of Filtered Reminders */}
      <div className="flex-1">
        {filteredReminders.length === 0 ? (
          <div className="bg-white dark:bg-[#0c1e2e] rounded-2xl p-8 text-center border border-[#e1e3e4] dark:border-sky-900/40 mt-4">
            <div className="w-12 h-12 rounded-full bg-[#f2f4f5] dark:bg-sky-900/40 text-[#707975] dark:text-sky-400 mx-auto flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-[#191c1d] dark:text-white">
              No reminders found
            </h3>
            <p className="text-xs text-[#707975] dark:text-sky-300/70 mt-1 max-w-xs mx-auto">
              {showCompleted
                ? 'No completed reminders found for this filter.'
                : 'No active reminders match your search criteria. Upload a document or add one manually!'}
            </p>
            <button
              onClick={onAddNewManual}
              className="mt-4 bg-[#0284c7] text-white text-xs font-bold px-4 py-2 rounded-full"
            >
              + Create Reminder
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReminders.map((rem) => (
              <SwipeableReminderCard
                key={rem.id}
                rem={rem}
                onSelectReminder={onSelectReminder}
                onToggleComplete={onToggleComplete}
                onDeleteReminder={onDeleteReminder}
                exportCalendar={exportCalendar}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
