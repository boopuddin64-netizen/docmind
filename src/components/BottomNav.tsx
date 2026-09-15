import React from 'react';
import { Home, Calendar, User } from 'lucide-react';
import { NavigationTab } from '../types';

interface BottomNavProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  unreadCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  unreadCount = 0,
}) => {
  return (
    <nav
      className="fixed bottom-0 md:bottom-5 left-0 right-0 z-50 bg-[#f2f4f5]/95 dark:bg-[#07131e]/95 backdrop-blur-md border-t md:border border-[#e1e3e4] dark:border-sky-900/40 px-6 pt-2 flex items-center justify-around shadow-lg md:shadow-2xl max-w-md md:max-w-lg lg:max-w-xl mx-auto md:rounded-full transition-colors duration-200"
      style={{
        paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom, 0px))',
        transform: 'translateZ(0)',
      }}
    >
      {/* Home Tab */}
      <button
        onClick={() => onSelectTab('home')}
        className="flex flex-col items-center justify-center py-1 group focus:outline-none"
        id="nav-tab-home"
      >
        <div
          className={`px-5 py-1.5 rounded-full flex items-center justify-center transition-all ${
            activeTab === 'home'
              ? 'bg-[#0284c7] dark:bg-sky-600 text-white shadow-xs'
              : 'text-[#3f4945] dark:text-sky-300/80 hover:bg-[#e1e3e4]/60 dark:hover:bg-sky-900/40'
          }`}
        >
          <Home className="w-5 h-5" />
        </div>
        <span
          className={`text-xs font-semibold mt-1 transition-colors ${
            activeTab === 'home' ? 'text-[#0284c7] dark:text-sky-200' : 'text-[#3f4945] dark:text-sky-400/80'
          }`}
        >
          Home
        </span>
      </button>

      {/* Reminders Tab */}
      <button
        onClick={() => onSelectTab('reminders')}
        className="flex flex-col items-center justify-center py-1 group relative focus:outline-none"
        id="nav-tab-reminders"
      >
        <div
          className={`px-5 py-1.5 rounded-full flex items-center justify-center transition-all ${
            activeTab === 'reminders'
              ? 'bg-[#0284c7] dark:bg-sky-600 text-white shadow-xs'
              : 'text-[#3f4945] dark:text-sky-300/80 hover:bg-[#e1e3e4]/60 dark:hover:bg-sky-900/40'
          }`}
        >
          <Calendar className="w-5 h-5" />
          {unreadCount > 0 && activeTab !== 'reminders' && (
            <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-[#ba1a1a]" />
          )}
        </div>
        <span
          className={`text-xs font-semibold mt-1 transition-colors ${
            activeTab === 'reminders' ? 'text-[#0284c7] dark:text-sky-200' : 'text-[#3f4945] dark:text-sky-400/80'
          }`}
        >
          Reminders
        </span>
      </button>

      {/* Profile Tab */}
      <button
        onClick={() => onSelectTab('profile')}
        className="flex flex-col items-center justify-center py-1 group focus:outline-none"
        id="nav-tab-profile"
      >
        <div
          className={`px-5 py-1.5 rounded-full flex items-center justify-center transition-all ${
            activeTab === 'profile'
              ? 'bg-[#0284c7] dark:bg-sky-600 text-white shadow-xs'
              : 'text-[#3f4945] dark:text-sky-300/80 hover:bg-[#e1e3e4]/60 dark:hover:bg-sky-900/40'
          }`}
        >
          <User className="w-5 h-5" />
        </div>
        <span
          className={`text-xs font-semibold mt-1 transition-colors ${
            activeTab === 'profile' ? 'text-[#0284c7] dark:text-sky-200' : 'text-[#3f4945] dark:text-sky-400/80'
          }`}
        >
          Profile
        </span>
      </button>
    </nav>
  );
};
