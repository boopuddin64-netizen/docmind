import React, { useState } from 'react';
import { Reminder } from '../types';
import { PendingAlert, requestNotificationPermission } from '../lib/notifications';
import { Bell, BellRing, BellOff, CheckCircle2, Clock, Volume2, X, AlertTriangle, ShieldAlert } from 'lucide-react';

interface NotificationCenterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: PendingAlert[];
  onSnooze: (reminderId: string, hours: number) => void;
  onMarkCompleted: (reminderId: string) => void;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
}

export const NotificationCenterDrawer: React.FC<NotificationCenterDrawerProps> = ({
  isOpen,
  onClose,
  alerts,
  onSnooze,
  onMarkCompleted,
  notificationsEnabled = true,
  onToggleNotifications,
}) => {
  if (!isOpen) return null;

  const [hasPushPermission, setHasPushPermission] = useState<boolean>(
    'Notification' in window && Notification.permission === 'granted'
  );

  const handleEnablePush = async () => {
    const granted = await requestNotificationPermission();
    setHasPushPermission(granted);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="bg-white dark:bg-[#0c1e2e] w-full max-w-sm h-full shadow-2xl flex flex-col border-l border-sky-900/20 animate-in slide-in-from-right duration-250">
        {/* Drawer Header */}
        <div className="bg-[#0284c7] text-white p-4 flex items-center justify-between border-b border-sky-700/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 border border-white/30 flex items-center justify-center">
              <BellRing className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Notification Center</h3>
              <p className="text-[11px] text-sky-100/90">Upcoming Deadlines & Reminders</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-sky-100/80 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Master Notification On/Off Toggle Bar */}
        <div
          onClick={onToggleNotifications}
          className="p-3 bg-slate-50 dark:bg-[#07131e] hover:bg-slate-100 dark:hover:bg-[#10263b] border-b border-slate-200 dark:border-sky-900/40 flex items-center justify-between text-xs cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2 text-slate-800 dark:text-sky-200 font-medium">
            <Bell className={`w-4 h-4 ${notificationsEnabled ? 'text-[#0284c7]' : 'text-slate-400'}`} />
            <div>
              <span className="font-bold block text-slate-900 dark:text-white">
                Deadline Notifications
              </span>
              <span className="text-[10px] text-slate-500 dark:text-sky-300/70 block">
                {notificationsEnabled ? 'Notifications are active' : 'Notifications are muted (Tap to enable)'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleNotifications) onToggleNotifications();
            }}
            className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
              notificationsEnabled ? 'bg-[#0284c7] justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
            }`}
            id="btn-drawer-notifications-toggle"
            title="Toggle Notifications"
          >
            <div className="w-4 h-4 rounded-full bg-white shadow-md flex items-center justify-center">
              <Bell className={`w-2.5 h-2.5 ${notificationsEnabled ? 'text-[#0284c7]' : 'text-slate-400'}`} />
            </div>
          </button>
        </div>

        {/* Notifications Muted Banner */}
        {!notificationsEnabled && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <span className="text-[11px] font-medium">
                Notifications are muted. You will not receive deadline sound alerts.
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleNotifications}
              className="px-2 py-1 bg-amber-600 text-white rounded-lg text-[10px] font-bold hover:bg-amber-700 whitespace-nowrap ml-2"
            >
              Turn On
            </button>
          </div>
        )}

        {/* Browser Push Permission Banner */}
        {!hasPushPermission && notificationsEnabled && (
          <div className="p-3 bg-sky-50 dark:bg-sky-950/50 border-b border-sky-200 dark:border-sky-800/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-[#0369a1] dark:text-sky-200 font-medium">
              <Volume2 className="w-4 h-4 text-[#0284c7] dark:text-sky-400 flex-shrink-0" />
              <span>Allow Device Pop-up Alerts</span>
            </div>
            <button
              onClick={handleEnablePush}
              className="px-2.5 py-1 bg-[#0284c7] text-white rounded-lg font-bold text-[10px] hover:bg-[#0369a1]"
            >
              Allow
            </button>
          </div>
        )}

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {alerts.length === 0 ? (
            <div className="text-center py-12 text-slate-400 dark:text-sky-300/60 text-xs">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-[#0284c7] opacity-60" />
              <p className="font-semibold text-slate-700 dark:text-sky-200">All caught up!</p>
              <p className="text-[11px] mt-0.5">No overdue or pending deadline alerts.</p>
            </div>
          ) : (
            alerts.map((item) => (
              <div
                key={item.reminderId}
                className={`p-3 rounded-xl border text-xs shadow-xs transition-all ${
                  item.severity === 'urgent'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-900/60 text-rose-900 dark:text-rose-200'
                    : item.severity === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-900/60 text-amber-900 dark:text-amber-200'
                    : 'bg-sky-50/60 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/40 text-sky-900 dark:text-sky-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-bold text-sm line-clamp-1">{item.title}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                      item.severity === 'urgent'
                        ? 'bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100'
                        : item.severity === 'warning'
                        ? 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
                        : 'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100'
                    }`}
                  >
                    {item.daysRemaining < 0
                      ? 'Overdue'
                      : item.daysRemaining === 0
                      ? 'Due Today'
                      : `${item.daysRemaining}d Left`}
                  </span>
                </div>

                <p className="text-[11px] opacity-90 mb-2">{item.message}</p>

                {/* Quick Action Buttons */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-black/10 dark:border-white/10">
                  <button
                    onClick={() => onSnooze(item.reminderId, 24)}
                    className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 text-[10px] font-semibold flex items-center gap-1"
                  >
                    <Clock className="w-3 h-3" /> Snooze 24h
                  </button>
                  <button
                    onClick={() => onMarkCompleted(item.reminderId)}
                    className="px-2.5 py-1 rounded-lg bg-[#0284c7] text-white hover:bg-[#0369a1] text-[10px] font-bold flex items-center gap-1 shadow-xs"
                  >
                    <CheckCircle2 className="w-3 h-3 text-[#bae6fd]" /> Mark Paid / Done
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-3 bg-slate-50 dark:bg-[#07131e] border-t border-slate-200 dark:border-sky-900/40 text-[11px] text-slate-500 dark:text-sky-300/70 text-center">
          Alert Dispatcher active • Auto-checks every hour
        </div>
      </div>
    </div>
  );
};
