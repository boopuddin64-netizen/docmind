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
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-[#f2f4f5]/95 backdrop-blur-md border-t border-[#e1e3e4] px-4 py-2 flex items-center justify-around shadow-lg max-w-md mx-auto">
      {/* Home Tab */}
      <button
        onClick={() => onSelectTab('home')}
        className="flex flex-col items-center justify-center py-1 group focus:outline-none"
        id="nav-tab-home"
      >
        <div
          className={`px-5 py-1.5 rounded-full flex items-center justify-center transition-all ${
            activeTab === 'home'
              ? 'bg-[#54a0fe] text-white shadow-xs'
              : 'text-[#3f4945] hover:bg-[#e1e3e4]/60'
          }`}
        >
          <Home className="w-5 h-5" />
        </div>
        <span
          className={`text-xs font-semibold mt-1 transition-colors ${
            activeTab === 'home' ? 'text-[#003567]' : 'text-[#3f4945]'
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
              ? 'bg-[#54a0fe] text-white shadow-xs'
              : 'text-[#3f4945] hover:bg-[#e1e3e4]/60'
          }`}
        >
          <Calendar className="w-5 h-5" />
          {unreadCount > 0 && activeTab !== 'reminders' && (
            <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-[#ba1a1a]" />
          )}
        </div>
        <span
          className={`text-xs font-semibold mt-1 transition-colors ${
            activeTab === 'reminders' ? 'text-[#003567]' : 'text-[#3f4945]'
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
              ? 'bg-[#54a0fe] text-white shadow-xs'
              : 'text-[#3f4945] hover:bg-[#e1e3e4]/60'
          }`}
        >
          <User className="w-5 h-5" />
        </div>
        <span
          className={`text-xs font-semibold mt-1 transition-colors ${
            activeTab === 'profile' ? 'text-[#003567]' : 'text-[#3f4945]'
          }`}
        >
          Profile
        </span>
      </button>
    </nav>
  );
};
