import React from 'react';
import { FileBadge, ShieldCheck } from 'lucide-react';
import { UserProfile } from '../types';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  userProfile: UserProfile;
  onProfileClick?: () => void;
  doctorThumbnailUrl?: string;
  badge?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  onBack,
  userProfile,
  onProfileClick,
  doctorThumbnailUrl,
  badge,
}) => {
  return (
    <header className="sticky top-0 z-20 bg-[#f8fafb]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-[#e1e3e4]/60">
      <div className="flex items-center gap-3">
        {showBack ? (
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full text-[#191c1d] hover:bg-[#eceeef] transition-colors focus:outline-none focus:ring-2 focus:ring-[#004d40]"
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
            <div className="w-10 h-10 rounded-xl bg-[#00342b] text-white flex items-center justify-center shadow-xs">
              <FileBadge className="w-6 h-6 text-[#94d3c1]" />
            </div>
          </div>
        )}

        {title && (
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#191c1d] tracking-tight">
              {title}
            </h1>
            {badge && (
              <span className="text-xs bg-[#afefdd] text-[#00342b] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                {badge}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onProfileClick}
          className="relative group focus:outline-none focus:ring-2 focus:ring-[#004d40] rounded-full p-0.5 transition-transform hover:scale-105"
          aria-label="Open profile"
          id="btn-header-profile"
        >
          <img
            src={doctorThumbnailUrl || userProfile.avatar}
            alt={userProfile.name}
            className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm"
          />
          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full" />
        </button>
      </div>
    </header>
  );
};
