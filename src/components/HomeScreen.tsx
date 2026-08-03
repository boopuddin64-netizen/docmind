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

export const HomeScreen: React.FC<HomeScreenProps> = ({
  reminders,
  userProfile,
  onSeeAll,
  onUploadClick,
  onSelectReminder,
  onScanPreset,
}) => {
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const activeReminders = reminders.filter((r) => !r.isCompleted);
  const upcomingThisWeekCount = activeReminders.length > 0 ? Math.min(3, activeReminders.length) : 3;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (homeSearchQuery.trim()) {
      onSeeAll(homeSearchQuery.trim());
    } else {
      onSeeAll();
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-140px)] pb-24 px-4 pt-4 bg-[#f8fafb]">
      {/* Top Header Row with Logo and Profile */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5" id="home-logo-badge">
          <div className="w-10 h-10 rounded-xl bg-[#00342b] text-white flex items-center justify-center shadow-xs">
            <Sparkles className="w-5 h-5 text-[#94d3c1]" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-[#00342b]">DocuMind</h1>
            <p className="text-[10px] font-bold text-[#707975] uppercase tracking-wider">AI Document & Life Reminders</p>
          </div>
        </div>

        <button
          onClick={() => onSeeAll()}
          className="focus:outline-none focus:ring-2 focus:ring-[#004d40] rounded-full"
          aria-label="View Profile"
          id="btn-home-profile"
        >
          <img
            src={userProfile.avatar}
            alt={userProfile.name}
            className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-sm"
          />
        </button>
      </div>

      {/* Global Search Bar on Home */}
      <div className="mb-5">
        <form onSubmit={handleSearchSubmit} className="relative flex items-center">
          <Search className="w-4 h-4 text-[#707975] absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Search talks, schedules, bills, names, dates..."
            value={homeSearchQuery}
            onChange={(e) => setHomeSearchQuery(e.target.value)}
            className="w-full bg-white border border-[#e1e3e4] rounded-2xl pl-10 pr-10 py-2.5 text-xs text-[#191c1d] placeholder:text-[#707975] focus:outline-none focus:ring-2 focus:ring-[#00342b] shadow-2xs"
            id="input-home-search"
          />
          {homeSearchQuery ? (
            <button
              type="button"
              onClick={() => setHomeSearchQuery('')}
              className="absolute right-3 text-[#707975] hover:text-[#191c1d]"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              className="absolute right-2 bg-[#00342b] text-white text-[10px] font-bold px-2.5 py-1 rounded-xl hover:bg-[#004d40]"
            >
              Search
            </button>
          )}
        </form>
      </div>

      {/* Greeting / Weekly Update Banner */}
      <div className="flex items-start justify-between mb-8">
        <p className="text-lg md:text-xl font-medium text-[#191c1d] max-w-[280px] leading-snug">
          {reminders.length > 0 ? (
            <>You have <span className="font-semibold text-[#00342b]">{upcomingThisWeekCount} upcoming</span> reminders & tasks.</>
          ) : (
            <>Welcome! <span className="font-semibold text-[#00342b]">Scan or upload</span> your first document to extract schedule reminders.</>
          )}
        </p>
        <button
          onClick={() => onSeeAll()}
          className="text-xs font-bold text-[#005faf] tracking-wider uppercase hover:underline py-1 px-2 rounded-md focus:outline-none focus:ring-2 focus:ring-[#005faf]"
          id="btn-see-all-reminders"
        >
          SEE ALL
        </button>
      </div>

      {/* Floating Counter Card + UPLOAD DOCUMENT Button (Image 1 Layout) */}
      <div className="relative mb-12 mt-4 flex flex-col items-end">
        <div className="w-48 bg-[#ffddba] rounded-2xl p-5 shadow-xs flex flex-col items-start gap-1 relative overflow-hidden">
          <div className="text-[#673d00] mb-1">
            <Bell className="w-7 h-7 stroke-[2.2]" />
          </div>
          <span className="text-4xl font-extrabold text-[#2b1700] tracking-tight leading-none">
            {reminders.length < 10 ? `0${reminders.length}` : reminders.length}
          </span>
          <span className="text-xs font-semibold text-[#673d00] uppercase tracking-wider mt-1">
            Active Reminders
          </span>

          {/* Decorative subtle background ring */}
          <div className="absolute -right-4 -bottom-4 w-20 h-20 rounded-full bg-[#ffb866]/30 pointer-events-none" />
        </div>

        {/* Floating Action Pill "+ UPLOAD DOCUMENT" Overlapping Button */}
        <button
          onClick={onUploadClick}
          className="mt-[-22px] mr-2 bg-[#00342b] hover:bg-[#004d40] text-white px-5 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all transform hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#94d3c1] z-10"
          id="btn-upload-document-fab"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span className="text-xs font-extrabold uppercase tracking-wider">
            UPLOAD DOCUMENT
          </span>
        </button>
      </div>

      {/* Upcoming Reminders Preview List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-[#3f4945] uppercase tracking-wider">
            Upcoming Schedule
          </h2>
          <button
            onClick={onSeeAll}
            className="text-xs font-semibold text-[#005faf] hover:underline"
          >
            View All ({reminders.length})
          </button>
        </div>

        <div className="space-y-3">
          {reminders.length === 0 ? (
            <div className="bg-white p-6 rounded-2xl border border-dashed border-[#94d3c1] text-center flex flex-col items-center gap-3 shadow-2xs">
              <div className="w-12 h-12 rounded-full bg-[#afefdd]/50 text-[#00342b] flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-[#00342b]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#191c1d]">No Reminders Yet</h3>
                <p className="text-xs text-[#3f4945] max-w-xs mt-1">
                  Upload a PDF, document image, or schedule to extract reminders automatically with AI.
                </p>
              </div>
              <button
                onClick={onUploadClick}
                className="mt-1 bg-[#00342b] hover:bg-[#004d40] text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Scan Your First Document</span>
              </button>
            </div>
          ) : (
            reminders.slice(0, 3).map((rem) => (
            <div
              key={rem.id}
              onClick={() => onSelectReminder(rem)}
              className="bg-white p-4 rounded-xl border border-[#e1e3e4] hover:border-[#00342b] transition-all cursor-pointer shadow-2xs hover:shadow-xs flex items-start justify-between relative overflow-hidden"
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
                    ? 'bg-[#004d40]'
                    : 'bg-[#00342b]'
                }`}
              />

              <div className="pl-2 flex-1 pr-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#f2f4f5] text-[#00342b]">
                    {rem.category}
                  </span>
                  <span className="text-xs text-[#707975]">
                    {rem.appointmentDate} at {rem.appointmentTime}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-[#191c1d]">
                  {rem.eventTitle}
                </h3>
                <p className="text-xs text-[#3f4945] line-clamp-1 mt-0.5">
                  {rem.hospitalName} — {rem.patientName}
                </p>
              </div>

              <ChevronRight className="w-5 h-5 text-[#707975] self-center" />
            </div>
          )))}
        </div>
      </div>
    </div>
  );
};
