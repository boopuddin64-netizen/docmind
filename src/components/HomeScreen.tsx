import React, { useState } from 'react';
import { Bell, Plus, ChevronRight, Sparkles, Search, X } from 'lucide-react';
import { Reminder, UserProfile, ExtractedDocData } from '../types';

interface HomeScreenProps {
  reminders: Reminder[];
  userProfile: UserProfile;
  onSeeAll: (searchQuery?: string) => void;
  onUploadClick: () => void;
  onSelectReminder: (reminder: Reminder) => void;
  onScanPreset: (data: ExtractedDocData) => void;
}

export function isUpcomingOrToday(dateStr?: string): boolean {
  if (!dateStr) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const raw = dateStr.trim();
  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = raw.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10);
    const year = parseInt(ddmmyyyy[3], 10);
    const target = new Date(year, month - 1, day);
    target.setHours(0, 0, 0, 0);
    return target.getTime() >= today.getTime();
  }

  // YYYY-MM-DD
  const yyyymmdd = raw.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
  if (yyyymmdd) {
    const year = parseInt(yyyymmdd[1], 10);
    const month = parseInt(yyyymmdd[2], 10);
    const day = parseInt(yyyymmdd[3], 10);
    const target = new Date(year, month - 1, day);
    target.setHours(0, 0, 0, 0);
    return target.getTime() >= today.getTime();
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    parsed.setHours(0, 0, 0, 0);
    return parsed.getTime() >= today.getTime();
  }

  return true;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  reminders,
  userProfile,
  onSeeAll,
  onUploadClick,
  onSelectReminder,
  onScanPreset,
}) => {
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  
  // Exclude completed reminders AND past dates from the homepage Upcoming Schedule
  const activeUpcomingReminders = reminders.filter(
    (r) => !r.isCompleted && isUpcomingOrToday(r.appointmentDate)
  );
  const upcomingThisWeekCount = activeUpcomingReminders.length;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (homeSearchQuery.trim()) {
      onSeeAll(homeSearchQuery.trim());
    } else {
      onSeeAll();
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-140px)] pb-32 px-4 sm:px-6 pt-4 bg-[#f8fafb] dark:bg-[#07131e]">
      {/* Top Header Row with Logo and Profile */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5" id="home-logo-badge">
          <div className="w-10 h-10 rounded-xl bg-[#0284c7] text-white flex items-center justify-center shadow-xs">
            <Sparkles className="w-5 h-5 text-[#bae6fd]" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-[#0284c7] dark:text-sky-300">DocuMind</h1>
            <p className="text-[10px] font-bold text-[#707975] dark:text-sky-400/70 uppercase tracking-wider">AI Document & Life Reminders</p>
          </div>
        </div>

        <button
          onClick={() => onSeeAll()}
          className="focus:outline-none focus:ring-2 focus:ring-[#0284c7] rounded-full"
          aria-label="View Profile"
          id="btn-home-profile"
        >
          <img
            src={userProfile.avatar}
            alt={userProfile.name}
            className="w-11 h-11 rounded-full object-cover border-2 border-white dark:border-sky-800 shadow-sm"
          />
        </button>
      </div>

      {/* Top Hero Row with Search & Counter Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8 items-stretch">
        <div className="md:col-span-2 flex flex-col justify-between bg-white dark:bg-[#0c1e2e] p-5 rounded-2xl border border-[#e1e3e4] dark:border-sky-900/40 shadow-xs">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                <span className="text-[10px] font-bold text-[#0284c7] dark:text-sky-300 uppercase tracking-wider">DocuMind Assistant</span>
              </div>
              <p className="text-lg md:text-xl font-bold text-[#191c1d] dark:text-sky-100 leading-snug">
                {reminders.length > 0 ? (
                  <>You have <span className="font-extrabold text-[#0284c7] dark:text-sky-400">{upcomingThisWeekCount} upcoming</span> reminders & tasks.</>
                ) : (
                  <>Welcome! <span className="font-extrabold text-[#0284c7] dark:text-sky-400">Scan or upload</span> your first document to extract schedule reminders.</>
                )}
              </p>
            </div>
            <button
              onClick={() => onSeeAll()}
              className="text-xs font-bold text-[#0284c7] dark:text-sky-300 tracking-wider uppercase hover:underline py-1 px-2 rounded-md shrink-0 ml-2"
              id="btn-see-all-reminders"
            >
              SEE ALL
            </button>
          </div>

          {/* Global Search Bar on Home */}
          <form onSubmit={handleSearchSubmit} className="relative flex items-center mt-2">
            <Search className="w-4 h-4 text-[#707975] dark:text-sky-300/60 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search talks, schedules, bills, names, dates..."
              value={homeSearchQuery}
              onChange={(e) => setHomeSearchQuery(e.target.value)}
              className="w-full bg-[#f8fafb] dark:bg-[#07131e] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl pl-10 pr-16 py-2.5 text-xs text-[#191c1d] dark:text-white placeholder:text-[#707975] dark:placeholder:text-sky-300/50 focus:outline-none focus:ring-2 focus:ring-[#0284c7] dark:focus:ring-sky-500 shadow-2xs"
              id="input-home-search"
            />
            {homeSearchQuery ? (
              <button
                type="button"
                onClick={() => setHomeSearchQuery('')}
                className="absolute right-3 text-[#707975] dark:text-sky-300 hover:text-[#191c1d]"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                className="absolute right-2 bg-[#0284c7] text-white text-[10px] font-bold px-2.5 py-1 rounded-lg hover:bg-[#0369a1]"
              >
                Search
              </button>
            )}
          </form>
        </div>

        {/* Counter Card + Upload FAB */}
        <div className="bg-[#ffddba] dark:bg-[#2e1700] border border-[#f0c392] dark:border-amber-900/40 rounded-2xl p-5 shadow-xs flex flex-col justify-between items-start relative overflow-hidden min-h-[140px]">
          <div>
            <div className="text-[#673d00] dark:text-amber-400 mb-1">
              <Bell className="w-7 h-7 stroke-[2.2]" />
            </div>
            <span className="text-4xl font-extrabold text-[#2b1700] dark:text-amber-100 tracking-tight leading-none">
              {activeUpcomingReminders.length < 10 ? `0${activeUpcomingReminders.length}` : activeUpcomingReminders.length}
            </span>
            <span className="text-xs font-semibold text-[#673d00] dark:text-amber-300 uppercase tracking-wider mt-1 block">
              Upcoming Schedule
            </span>
          </div>

          <button
            onClick={onUploadClick}
            className="w-full mt-3 bg-[#0284c7] hover:bg-[#0369a1] text-white px-4 py-2.5 rounded-xl shadow-md flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#bae6fd]"
            id="btn-upload-document-fab"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span className="text-xs font-extrabold uppercase tracking-wider">
              UPLOAD DOCUMENT
            </span>
          </button>

          <div className="absolute -right-4 -bottom-4 w-20 h-20 rounded-full bg-[#ffb866]/30 dark:bg-amber-500/10 pointer-events-none" />
        </div>
      </div>

      {/* Upcoming Reminders Preview List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
            Upcoming Schedule
          </h2>
          <button
            onClick={onSeeAll}
            className="text-xs font-semibold text-[#0284c7] dark:text-sky-400 hover:underline"
          >
            View All ({reminders.length})
          </button>
        </div>

        <div>
          {activeUpcomingReminders.length === 0 ? (
            <div className="bg-white dark:bg-[#0c1e2e] p-6 rounded-2xl border border-dashed border-[#bae6fd] text-center flex flex-col items-center gap-3 shadow-2xs">
              <div className="w-12 h-12 rounded-full bg-[#e0f2fe] text-[#0284c7] flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-[#0284c7]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#191c1d] dark:text-white">
                  {reminders.length > 0 ? 'No Upcoming Events' : 'No Reminders Yet'}
                </h3>
                <p className="text-xs text-[#3f4945] dark:text-sky-300/80 max-w-xs mt-1">
                  {reminders.length > 0
                    ? 'All existing reminders are completed or in the past. Upload new documents to extract upcoming schedules!'
                    : 'Upload a PDF, document image, or schedule to extract reminders automatically with AI.'}
                </p>
              </div>
              <button
                onClick={onUploadClick}
                className="mt-1 bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Scan New Document</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeUpcomingReminders.slice(0, 6).map((rem) => (
                <div
                  key={rem.id}
                  onClick={() => onSelectReminder(rem)}
                  className="bg-white dark:bg-[#0c1e2e] p-4 rounded-xl border border-[#e1e3e4] dark:border-sky-900/40 hover:border-[#0284c7] dark:hover:border-sky-500 transition-all cursor-pointer shadow-2xs hover:shadow-xs flex items-start justify-between relative overflow-hidden"
                  id={`card-home-reminder-${rem.id}`}
                >
                  {/* Category Color Bar Indicator */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                      rem.category === 'Bills & Invoices'
                        ? 'bg-[#ba1a1a]'
                        : rem.category === 'Contracts & Legal'
                        ? 'bg-[#005faf]'
                        : rem.category === 'Vehicle & Home'
                        ? 'bg-[#f09e34]'
                        : rem.category === 'Work & Study'
                        ? 'bg-[#7a309f]'
                        : rem.category === 'Medical' || rem.category === 'Dental'
                        ? 'bg-[#0369a1]'
                        : 'bg-[#0284c7]'
                    }`}
                  />

                  <div className="pl-2 flex-1 pr-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#f2f4f5] dark:bg-sky-900/60 text-[#0284c7] dark:text-sky-200">
                        {rem.category}
                      </span>
                      <span className="text-xs text-[#707975] dark:text-sky-300/70">
                        {rem.appointmentDate} at {rem.appointmentTime}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-[#191c1d] dark:text-white">
                      {rem.eventTitle}
                    </h3>
                    <p className="text-xs text-[#3f4945] dark:text-sky-300/80 line-clamp-1 mt-0.5">
                      {rem.hospitalName} — {rem.patientName}
                    </p>
                  </div>

                  <ChevronRight className="w-5 h-5 text-[#707975] dark:text-sky-400 self-center" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
