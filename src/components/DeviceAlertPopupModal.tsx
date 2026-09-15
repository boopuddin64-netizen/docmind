import React, { useEffect, useState } from 'react';
import {
  BellRing,
  AlertTriangle,
  Clock,
  CheckCircle2,
  X,
  ExternalLink,
  Volume2,
  VolumeX,
  ShieldAlert,
  Bell,
  Sparkles,
} from 'lucide-react';
import { PendingAlert, requestNotificationPermission, dispatchNativeNotification } from '../lib/notifications';

interface DeviceAlertPopupModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: PendingAlert[];
  onSelectReminder: (reminderId: string) => void;
  onSnoozeAlert: (reminderId: string, hours: number) => void;
  onMarkCompleted: (reminderId: string) => void;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
}

export const DeviceAlertPopupModal: React.FC<DeviceAlertPopupModalProps> = ({
  isOpen,
  onClose,
  alerts,
  onSelectReminder,
  onSnoozeAlert,
  onMarkCompleted,
  notificationsEnabled,
  onToggleNotifications,
}) => {
  const [soundMuted, setSoundMuted] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean>(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );

  useEffect(() => {
    if (isOpen && !soundMuted && notificationsEnabled) {
      // Play a gentle audio chime for device alert
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } catch {
        // Audio context fallback
      }
    }
  }, [isOpen, soundMuted, notificationsEnabled]);

  if (!isOpen || alerts.length === 0) return null;

  const urgentAlerts = alerts.filter((a) => a.severity === 'urgent');
  const primaryAlert = urgentAlerts.length > 0 ? urgentAlerts[0] : alerts[0];

  const handleRequestPushPermission = async () => {
    const granted = await requestNotificationPermission();
    setHasPermission(granted);
    if (granted) {
      dispatchNativeNotification(
        'DocuMind Device Pop-Up Alerts Active',
        'Device notifications are enabled. You will receive live pop-up alerts for appointments and deadlines!'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#0c1e2e] border-2 border-amber-500/80 dark:border-amber-500/60 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Urgent Header Banner */}
        <div className="p-4 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center animate-bounce">
              <BellRing className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold bg-white/30 px-2 py-0.5 rounded-full uppercase tracking-wider text-amber-50">
                  Device Alert
                </span>
                <span className="text-xs font-bold opacity-90">
                  {urgentAlerts.length} Urgent Item{urgentAlerts.length > 1 ? 's' : ''}
                </span>
              </div>
              <h2 className="text-base font-extrabold text-white leading-tight mt-0.5">
                Appointment & Deadline Notice
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSoundMuted(!soundMuted)}
              className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
              title={soundMuted ? 'Unmute Alert Chime' : 'Mute Alert Chime'}
            >
              {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
              title="Dismiss Popup"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Primary Alert Highlight Box */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-4 rounded-2xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                  {primaryAlert.issuer || 'Healthcare & Document Alert'}
                </span>
                <h3 className="text-base font-extrabold text-[#191c1d] dark:text-white leading-snug">
                  {primaryAlert.title}
                </h3>
              </div>
              <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-red-600 text-white shadow-xs">
                {primaryAlert.daysRemaining < 0
                  ? 'OVERDUE'
                  : primaryAlert.daysRemaining === 0
                  ? 'DUE TODAY'
                  : `In ${primaryAlert.daysRemaining} Days`}
              </span>
            </div>

            <p className="text-xs text-[#3f4945] dark:text-amber-100/90 font-medium leading-relaxed">
              {primaryAlert.message}
            </p>

            <div className="flex items-center gap-3 text-xs text-amber-900 dark:text-amber-200 font-semibold pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>{primaryAlert.dueDate} at {primaryAlert.dueTime || '08:00 AM'}</span>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons for Primary Alert */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                onClose();
                onSelectReminder(primaryAlert.reminderId);
              }}
              className="py-2.5 px-3 bg-[#0284c7] hover:bg-[#0369a1] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>View Details</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onMarkCompleted(primaryAlert.reminderId);
              }}
              className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
              <span>Mark Done</span>
            </button>
          </div>

          {/* Snooze Options */}
          <div className="bg-[#f8fafb] dark:bg-[#07131e] p-3 rounded-2xl border border-[#e1e3e4] dark:border-sky-900/40 space-y-2">
            <span className="text-[10px] font-bold text-[#707975] dark:text-sky-300/70 uppercase tracking-wider block">
              Snooze Alert Notification
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onSnoozeAlert(primaryAlert.reminderId, 1)}
                className="py-1.5 px-2 bg-white dark:bg-[#0c1e2e] border border-slate-200 dark:border-sky-900/50 hover:bg-slate-100 text-xs font-bold rounded-xl text-[#3f4945] dark:text-sky-200 text-center transition-colors"
              >
                1 Hour
              </button>
              <button
                type="button"
                onClick={() => onSnoozeAlert(primaryAlert.reminderId, 4)}
                className="py-1.5 px-2 bg-white dark:bg-[#0c1e2e] border border-slate-200 dark:border-sky-900/50 hover:bg-slate-100 text-xs font-bold rounded-xl text-[#3f4945] dark:text-sky-200 text-center transition-colors"
              >
                4 Hours
              </button>
              <button
                type="button"
                onClick={() => onSnoozeAlert(primaryAlert.reminderId, 24)}
                className="py-1.5 px-2 bg-white dark:bg-[#0c1e2e] border border-slate-200 dark:border-sky-900/50 hover:bg-slate-100 text-xs font-bold rounded-xl text-[#3f4945] dark:text-sky-200 text-center transition-colors"
              >
                24 Hours
              </button>
            </div>
          </div>

          {/* Additional Pending Alerts List if > 1 */}
          {alerts.length > 1 && (
            <div className="space-y-2 pt-1">
              <span className="text-[10px] font-bold text-[#707975] dark:text-sky-300/70 uppercase tracking-wider block">
                Other Pending Alerts ({alerts.length - 1})
              </span>
              <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                {alerts.slice(1).map((item) => (
                  <div
                    key={item.reminderId}
                    className="p-2.5 bg-white dark:bg-[#0c1e2e] border border-[#e1e3e4] dark:border-sky-900/40 rounded-xl flex items-center justify-between text-xs"
                  >
                    <div className="truncate pr-2">
                      <p className="font-bold text-[#191c1d] dark:text-white truncate">{item.title}</p>
                      <p className="text-[10px] text-[#707975] dark:text-sky-300/70">{item.dueDate}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectReminder(item.reminderId);
                      }}
                      className="text-[10px] font-bold text-[#0284c7] hover:underline shrink-0"
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Browser Native Device Push Banner */}
          {!hasPermission && (
            <div className="p-3 bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800/40 rounded-2xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-[#0369a1] dark:text-sky-200 font-medium">
                <Bell className="w-4 h-4 text-[#0284c7] shrink-0" />
                <span>Enable System Pop-Up Notifications</span>
              </div>
              <button
                type="button"
                onClick={handleRequestPushPermission}
                className="px-3 py-1.5 bg-[#0284c7] hover:bg-[#0369a1] text-white rounded-xl font-bold text-[10px] shrink-0"
              >
                Allow
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#f8fafb] dark:bg-[#07131e] border-t border-[#e1e3e4] dark:border-sky-900/40 flex items-center justify-between">
          <span className="text-[11px] text-[#707975] dark:text-sky-300/70 font-medium">
            DocuMind Alert System Active
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 dark:bg-sky-100 hover:bg-black dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-colors"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
};
