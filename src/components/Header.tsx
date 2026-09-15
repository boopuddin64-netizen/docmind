import React from 'react';
import { FileBadge, ShieldCheck, BellRing, BellOff, Lock, Sun, Moon } from 'lucide-react';
import { UserProfile } from '../types';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  userProfile: UserProfile;
  onProfileClick?: () => void;
  doctorThumbnailUrl?: string;
  badge?: string;
  alertCount?: number;
  onOpenNotifications?: () => void;
  onOpenVault?: () => void;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  notificationsEnabled?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  onBack,
  userProfile,
  onProfileClick,
  doctorThumbnailUrl,
  badge,
  alertCount = 0,
  onOpenNotifications,
  onOpenVault,
  isDarkMode = false,
  onToggleDarkMode,
  notificationsEnabled = true,
}) => {
  return (
    <header
      className="sticky top-0 z-20 bg-[#f8fafb]/95 dark:bg-[#07131e]/95 backdrop-blur-md px-4 pb-3 border-b border-[#e1e3e4]/60 dark:border-sky-900/40"
      style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
    >
      <div className="w-full max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
        {showBack ? (
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full text-[#191c1d] dark:text-sky-100 hover:bg-[#eceeef] dark:hover:bg-sky-900/40 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0284c7]"
            aria-label="Go back"
            id="btn-header-back"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-2" id="header-brand-logo">
            <div className="w-10 h-10 rounded-xl bg-[#0284c7] dark:bg-sky-700 text-white flex items-center justify-center shadow-xs">
              <FileBadge className="w-6 h-6 text-[#bae6fd]" />
            </div>
          </div>
        )}

        {title && (
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#191c1d] dark:text-white tracking-tight">
              {title}
            </h1>
            {badge && (
              <span className="text-xs bg-[#e0f2fe] dark:bg-sky-900 text-[#0369a1] dark:text-sky-100 font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                {badge}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Dark Mode Toggle */}
        {onToggleDarkMode && (
          <button
            onClick={onToggleDarkMode}
            className="p-2 rounded-full text-[#0369a1] dark:text-sky-200 hover:bg-sky-100/60 dark:hover:bg-sky-900/50 transition-colors"
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            id="btn-toggle-darkmode"
          >
            {isDarkMode ? (
              <Sun className="w-5 h-5 text-amber-400" />
            ) : (
              <Moon className="w-5 h-5 text-[#0369a1]" />
            )}
          </button>
        )}

        {/* Security Vault Button */}
        {onOpenVault && (
          <button
            onClick={onOpenVault}
            className="p-2 rounded-full text-[#0369a1] dark:text-sky-200 hover:bg-sky-100/60 dark:hover:bg-sky-900/50 transition-colors"
            title="Open Security & Privacy Vault"
            id="btn-header-vault"
          >
            <Lock className="w-5 h-5 text-[#0369a1] dark:text-sky-200" />
          </button>
        )}

        {/* Notification Bell Button */}
        {onOpenNotifications && (
          <button
            onClick={onOpenNotifications}
            className="p-2 rounded-full text-[#0369a1] dark:text-sky-200 hover:bg-sky-100/60 dark:hover:bg-sky-900/50 transition-colors relative"
            title={notificationsEnabled ? 'Notification Center' : 'Notification Center (Muted)'}
            id="btn-header-notifications"
          >
            {notificationsEnabled ? (
              <BellRing className="w-5 h-5 text-[#0369a1] dark:text-sky-200" />
            ) : (
              <BellOff className="w-5 h-5 text-slate-400 dark:text-sky-400/50" />
            )}
            {notificationsEnabled && alertCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rose-600 text-white font-extrabold text-[9px] flex items-center justify-center border border-white">
                {alertCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={onProfileClick}
          className="relative group focus:outline-none focus:ring-2 focus:ring-[#0284c7] rounded-full p-0.5 transition-transform hover:scale-105 ml-1"
          aria-label="Open profile"
          id="btn-header-profile"
        >
          <img
            src={doctorThumbnailUrl || userProfile.avatar}
            alt={userProfile.name}
            className="w-9 h-9 rounded-full object-cover border-2 border-white dark:border-sky-800 shadow-sm"
          />
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-sky-500 border-2 border-white rounded-full" />
        </button>
      </div>
      </div>
    </header>
  );
};


