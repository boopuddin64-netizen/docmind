import React, { useState, useEffect, useRef } from 'react';
import { AnimatedAppIntro } from './components/AnimatedAppIntro';
import { HomeScreen } from './components/HomeScreen';
import { AllRemindersScreen } from './components/AllRemindersScreen';
import { PreviewScreen } from './components/PreviewScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { BottomNav } from './components/BottomNav';
import { UploadModal } from './components/UploadModal';
import { AddManualModal } from './components/AddManualModal';
import { ReminderDetailModal } from './components/ReminderDetailModal';
import { HumanInTheLoopModal } from './components/HumanInTheLoopModal';
import { DuplicateMergeModal } from './components/DuplicateMergeModal';
import { NotificationCenterDrawer } from './components/NotificationCenterDrawer';
import { DeviceAlertPopupModal } from './components/DeviceAlertPopupModal';
import { SecurityVaultModal } from './components/SecurityVaultModal';
import { Header } from './components/Header';
import {
  NavigationTab,
  Reminder,
  UserProfile,
  ExtractedDocData,
  SecuritySettings,
} from './types';
import { INITIAL_REMINDERS, INITIAL_USER_PROFILE } from './data/mockData';
import { sanitizeAndValidateDocData } from './lib/sanitizer';
import { checkForDuplicateReminder, generateCompositeDedupHash } from './lib/deduplication';
import { checkUpcomingAlerts, dispatchNativeNotification, requestNotificationPermission } from './lib/notifications';
import { FIRED_STORAGE_KEY, loadPushFiredKeys, nextEventDelay, planAlerts, type FiredMap } from './lib/alertScheduler';
import { disablePush, enablePush, pushSupported } from './lib/pushClient';
import { DEFAULT_SECURITY_SETTINGS, createAuditLog } from './lib/securityVault';
import { CheckCircle2, BellRing } from 'lucide-react';

export default function App() {
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [currentTab, setCurrentTab] = useState<NavigationTab>('home');

  // Load state from local storage or defaults
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const saved = localStorage.getItem('docreminder_items');
    if (!saved) return INITIAL_REMINDERS;
    try {
      const parsed: Reminder[] = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : INITIAL_REMINDERS;
    } catch {
      return INITIAL_REMINDERS;
    }
  });

  const remindersRef = useRef<Reminder[]>([]);
  remindersRef.current = reminders;

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('docreminder_profile');
    if (!saved) return INITIAL_USER_PROFILE;
    try {
      const parsed: UserProfile = JSON.parse(saved);
      return parsed && typeof parsed === 'object' ? parsed : INITIAL_USER_PROFILE;
    } catch {
      return INITIAL_USER_PROFILE;
    }
  });

  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>(
    userProfile.securitySettings || DEFAULT_SECURITY_SETTINGS
  );

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('docreminder_darkmode');
    if (saved !== null) return JSON.parse(saved);
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('docreminder_notifications');
    if (saved === null) return true;
    try {
      return Boolean(JSON.parse(saved));
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem('docreminder_darkmode', JSON.stringify(isDarkMode));
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('docreminder_notifications', JSON.stringify(notificationsEnabled));
  }, [notificationsEnabled]);

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
    showToast(!isDarkMode ? 'Dark Mode Enabled' : 'Light Mode Enabled');
  };

  const toggleNotifications = async () => {
    const nextState = !notificationsEnabled;
    setNotificationsEnabled(nextState);
    if (nextState) {
      showToast('Notifications Enabled');
      const granted = await requestNotificationPermission();
      if (granted) {
        void dispatchNativeNotification(
          'DocuMind Device Pop-Up Alerts Active',
          'Device notifications are enabled. You will receive real-time alerts for appointments and deadlines!'
        );
        void enablePush(remindersRef.current);
      } else {
        showToast('Browser notifications are blocked - alerts will show inside the app only');
      }
      if (activeAlerts.length > 0) {
        setIsDeviceAlertPopupOpen(true);
      }
    } else {
      showToast('Notifications Muted');
      void disablePush();
    }
  };

  const handleTestDeviceAlert = async () => {
    setNotificationsEnabled(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      void dispatchNativeNotification(
        'DocuMind Device Pop-Up Alert Test',
        'Device notification pop-up system working successfully on this device!',
        undefined,
        'docmind-test'
      );
      void enablePush(remindersRef.current);
    }
    setIsDeviceAlertPopupOpen(true);
    showToast('Testing Device Pop-Up Alert...');
  };

  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');
  const [pendingExtractedDoc, setPendingExtractedDoc] = useState<ExtractedDocData | null>(null);
  
  // Modals & Drawers States
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isAddManualOpen, setIsAddManualOpen] = useState<boolean>(false);
  const [isHumanReviewOpen, setIsHumanReviewOpen] = useState<boolean>(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState<boolean>(false);
  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] = useState<boolean>(false);
  const [isDeviceAlertPopupOpen, setIsDeviceAlertPopupOpen] = useState<boolean>(false);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState<boolean>(false);
  const [hasAutoPromptedAlerts, setHasAutoPromptedAlerts] = useState<boolean>(false);
  
  // Duplicate Intercept Data
  const [duplicateMatch, setDuplicateMatch] = useState<{
    newDoc: ExtractedDocData;
    existingReminder: Reminder;
    similarityScore: number;
    reason: string;
  } | null>(null);

  const [selectedDetailReminder, setSelectedDetailReminder] = useState<Reminder | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Compute live alerts
  const activeAlerts = checkUpcomingAlerts(reminders);

  // Auto-trigger device alert pop-up modal on app load if urgent alerts exist
  useEffect(() => {
    if (notificationsEnabled && activeAlerts.length > 0 && !hasAutoPromptedAlerts) {
      const urgentItems = activeAlerts.filter((a) => a.severity === 'urgent');
      if (urgentItems.length > 0) {
        // In-app popup only. System notifications are fired (once per event) by the alert scheduler below.
        setIsDeviceAlertPopupOpen(true);
        setHasAutoPromptedAlerts(true);
      }
    }
  }, [notificationsEnabled, activeAlerts, hasAutoPromptedAlerts]);

  // Sync state to local storage
  useEffect(() => {
    localStorage.setItem('docreminder_items', JSON.stringify(reminders));
  }, [reminders]);

  // ── Alert scheduler: fires each due / heads-up event exactly once, also catches ones missed while the app was closed ──
  useEffect(() => {
    if (!notificationsEnabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const readFired = (): FiredMap => {
      try {
        const v = JSON.parse(localStorage.getItem(FIRED_STORAGE_KEY) || '{}');
        return v && typeof v === 'object' ? v : {};
      } catch {
        return {};
      }
    };

    const run = async () => {
      const now = Date.now();
      const pushKeys = await loadPushFiredKeys(); // alerts the service worker already showed via Web Push
      if (cancelled) return;
      const fired = readFired();
      for (const k of pushKeys) if (!(k in fired)) fired[k] = now;
      const plan = planAlerts(remindersRef.current, fired, now);
      localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(plan.fired));
      if (plan.notifications.length === 0) return;
      const granted = 'Notification' in window && Notification.permission === 'granted';
      if (granted) {
        for (const n of plan.notifications) {
          await dispatchNativeNotification(n.title, n.body, undefined, n.tag, n.reminderId);
        }
      } else {
        // Permission denied / unsupported: fall back to in-app UI so the alert is never silently lost.
        showToastRef.current(`${plan.notifications[0].title}: ${plan.notifications[0].body}`);
        setIsDeviceAlertPopupOpen(true);
      }
    };

    const loop = async () => {
      try {
        await run();
      } catch (e) {
        console.warn('Alert scheduler error:', e);
      }
      if (cancelled) return;
      const delay = nextEventDelay(remindersRef.current, {}, Date.now());
      timer = setTimeout(loop, Math.max(1000, Math.min(30000, delay === null ? 30000 : delay + 250)));
    };
    loop();

    const wake = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        loop();
      }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
    };
  }, [notificationsEnabled, reminders]);

  // ── Web Push: (re)subscribe when permission is granted, keep the server copy of the reminders in sync ──
  useEffect(() => {
    if (!notificationsEnabled || !pushSupported() || Notification.permission !== 'granted') return;
    const t = setTimeout(() => {
      void enablePush(remindersRef.current);
    }, 800);
    return () => clearTimeout(t);
  }, [notificationsEnabled, reminders]);

  useEffect(() => {
    const onPerm = () => {
      if (notificationsEnabled) void enablePush(remindersRef.current);
    };
    window.addEventListener('docmind:permission-changed', onPerm);
    return () => window.removeEventListener('docmind:permission-changed', onPerm);
  }, [notificationsEnabled]);

  // ── Notification action buttons (Snooze / Mark done) coming from the service worker ──
  useEffect(() => {
    const apply = (action: string, id: string) => {
      if (!id) return;
      if (action === 'snooze') handleSnoozeRef.current(id, 1);
      if (action === 'done') handleMarkDoneRef.current(id);
      if (action === 'open') {
        const found = remindersRef.current.find((r) => r.id === id);
        if (found) setSelectedDetailReminder(found);
      }
    };
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'docmind-notification-action') apply(e.data.action, e.data.reminderId);
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    // App was closed when the button was tapped: the SW opened us with ?dm_action=...&dm_id=...
    const params = new URLSearchParams(window.location.search);
    const a = params.get('dm_action');
    const id = params.get('dm_id');
    if (a && id) {
      apply(a, id);
      params.delete('dm_action');
      params.delete('dm_id');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    localStorage.setItem('docreminder_profile', JSON.stringify({ ...userProfile, securitySettings }));
  }, [userProfile, securitySettings]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleNavigateToReminders = (searchQuery?: string) => {
    if (typeof searchQuery === 'string') {
      setActiveSearchQuery(searchQuery);
    } else {
      setActiveSearchQuery('');
    }
    setCurrentTab('reminders');
  };

  /**
   * Main Document Extraction Pipeline Handler
   * Triggers Layer 3 Sanitization, Layer 4 Deduplication, and Layer 5 Human Review
   */
  const handleExtractedDoc = (rawExtracted: ExtractedDocData) => {
    // Layer 3: Data Sanitization & Normalization
    const sanitized = sanitizeAndValidateDocData(rawExtracted, userProfile);

    // Layer 4: Deduplication Check
    const dupCheck = checkForDuplicateReminder(sanitized, reminders);
    if (dupCheck.isDuplicate && dupCheck.matchingReminder) {
      setDuplicateMatch({
        newDoc: sanitized,
        existingReminder: dupCheck.matchingReminder,
        similarityScore: dupCheck.similarityScore,
        reason: dupCheck.reason,
      });
      setIsDuplicateModalOpen(true);
      return;
    }

    // Layer 5: Human-in-the-Loop Review
    if (sanitized.needsReview || (sanitized.accuracy && sanitized.accuracy < 92)) {
      setPendingExtractedDoc(sanitized);
      setIsHumanReviewOpen(true);
    } else {
      setPendingExtractedDoc(sanitized);
      setCurrentTab('preview');
    }
  };

  // Handle Human-in-the-loop confirmation
  const handleConfirmHumanReview = (verifiedData: ExtractedDocData) => {
    setIsHumanReviewOpen(false);
    setPendingExtractedDoc(verifiedData);
    setCurrentTab('preview');
  };

  // Duplicate Merge Handlers
  const handleMergeDuplicate = () => {
    if (!duplicateMatch) return;
    const { newDoc, existingReminder } = duplicateMatch;
    
    const updated: Reminder = {
      ...existingReminder,
      shortNote: `${existingReminder.shortNote}\n\n[Merged Scan Update]: ${newDoc.shortNote}`,
      fullText: `${existingReminder.fullText || ''}\n\n[Scan Version 2]: ${newDoc.fullText || ''}`,
      auditLogs: [
        ...(existingReminder.auditLogs || []),
        createAuditLog('Smart Merge', `Merged duplicate scan from ${newDoc.hospitalName}.`, userProfile.name),
      ],
    };

    setReminders((prev) => prev.map((r) => (r.id === existingReminder.id ? updated : r)));
    setIsDuplicateModalOpen(false);
    setDuplicateMatch(null);
    showToast(`Merged duplicate with existing record "${existingReminder.eventTitle}"`);
  };

  const handleSaveAsSeparateDuplicate = () => {
    if (!duplicateMatch) return;
    setPendingExtractedDoc(duplicateMatch.newDoc);
    setIsDuplicateModalOpen(false);
    setDuplicateMatch(null);
    setCurrentTab('preview');
  };

  const handleDiscardDuplicate = () => {
    setIsDuplicateModalOpen(false);
    setDuplicateMatch(null);
    showToast('Duplicate document upload discarded');
  };

  const handleCreateReminderFromPreview = (newReminders: Reminder | Reminder[]) => {
    const list = Array.isArray(newReminders) ? newReminders : [newReminders];
    const enrichedList: Reminder[] = list.map((item, idx) => ({
      ...item,
      id: item.id || `rem_${Date.now()}_${idx}`,
      dedupHash: generateCompositeDedupHash(
        item.hospitalName,
        item.appointmentDate,
        item.eventTitle
      ),
      securityVaultEncrypted: securitySettings.endToEndEncryption,
      vaultId: securitySettings.activeVault,
      auditLogs: [
        ...(item.auditLogs || []),
        createAuditLog('Document Created', `Verified & encrypted in ${securitySettings.activeVault} vault.`, userProfile.name),
      ],
    }));

    setReminders((prev) => [...enrichedList, ...prev]);
    setPendingExtractedDoc(null);
    setCurrentTab('home');
    showToast(
      enrichedList.length > 1
        ? `${enrichedList.length} Reminders created from document!`
        : `Reminder created for ${enrichedList[0].eventTitle}!`
    );
  };

  const handleDiscardPreview = () => {
    setPendingExtractedDoc(null);
    setCurrentTab('home');
  };

  const handleToggleComplete = (id: string) => {
    setReminders((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const updated = !r.isCompleted;
          showToast(updated ? 'Reminder marked as completed!' : 'Reminder reactivated');
          return {
            ...r,
            isCompleted: updated,
            auditLogs: [
              ...(r.auditLogs || []),
              createAuditLog(updated ? 'Mark Completed' : 'Reactivated', `Status set to ${updated ? 'Completed' : 'Active'}`, userProfile.name),
            ],
          };
        }
        return r;
      })
    );
  };

  /** Idempotent "mark done" (used by notification actions; unlike the toggle it never re-opens a finished reminder). */
  const handleMarkDone = (id: string) => {
    const target = remindersRef.current.find((r) => r.id === id);
    if (!target || target.isCompleted) return;
    handleToggleComplete(id);
  };

  const handleDeleteReminder = (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    showToast('Reminder deleted');
  };

  const handleUpdateReminder = (updated: Reminder) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
    setSelectedDetailReminder(updated);
    showToast(`Updated "${updated.eventTitle}"`);
  };

  const handleAddManualReminder = (newReminder: Reminder) => {
    setReminders((prev) => [newReminder, ...prev]);
    showToast(`Added ${newReminder.eventTitle}`);
  };

  const handleSnoozeAlert = (reminderId: string, hours: number) => {
    const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    setReminders((prev) =>
      prev.map((r) => {
        if (r.id === reminderId) {
          return {
            ...r,
            notificationSchedule: {
              ...r.notificationSchedule,
              snoozedUntil: snoozeUntil,
            },
          };
        }
        return r;
      })
    );
    showToast(`Snoozed alert for ${hours} hours`);
  };

  const handleRestoreBackup = (restoredReminders: Reminder[], restoredProfile?: UserProfile) => {
    setReminders(restoredReminders);
    localStorage.setItem('docreminder_items', JSON.stringify(restoredReminders));
    if (restoredProfile) {
      setUserProfile(restoredProfile);
      localStorage.setItem('docreminder_profile', JSON.stringify(restoredProfile));
    }
    showToast('Encrypted backup restored successfully!');
  };

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const handleSnoozeRef = useRef(handleSnoozeAlert);
  handleSnoozeRef.current = handleSnoozeAlert;
  const handleMarkDoneRef = useRef(handleMarkDone);
  handleMarkDoneRef.current = handleMarkDone;

  return (
    <div className="min-h-screen bg-[#f8fafb] dark:bg-[#07131e] text-[#191c1d] dark:text-sky-100 font-sans antialiased selection:bg-[#e0f2fe] selection:text-[#0369a1] transition-colors duration-200">
      {/* Animated Startup Intro Loading Screen */}
      {showIntro && <AnimatedAppIntro onComplete={() => setShowIntro(false)} />}

      {/* Global Header */}
      {currentTab !== 'preview' && (
        <Header
          userProfile={userProfile}
          onProfileClick={() => setCurrentTab('profile')}
          alertCount={activeAlerts.length}
          onOpenNotifications={() => setIsNotificationDrawerOpen(true)}
          onOpenVault={() => setIsVaultModalOpen(true)}
          isDarkMode={isDarkMode}
          onToggleDarkMode={toggleDarkMode}
          notificationsEnabled={notificationsEnabled}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#0284c7] text-white px-5 py-2.5 rounded-full shadow-xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-4 duration-200 border border-[#bae6fd]">
          <BellRing className="w-4 h-4 text-[#bae6fd]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="w-full max-w-7xl mx-auto min-h-[calc(100vh-60px)] bg-[#f8fafb] dark:bg-[#07131e] relative transition-all duration-300">
        {/* Screen 1: DocReminder Home */}
        {currentTab === 'home' && (
          <HomeScreen
            reminders={reminders}
            userProfile={userProfile}
            onSeeAll={(q) => handleNavigateToReminders(q)}
            onUploadClick={() => setIsUploadModalOpen(true)}
            onSelectReminder={(rem) => setSelectedDetailReminder(rem)}
            onScanPreset={(data) => handleExtractedDoc(data)}
          />
        )}

        {/* Screen 2: All Reminders */}
        {currentTab === 'reminders' && (
          <AllRemindersScreen
            reminders={reminders}
            userProfile={userProfile}
            initialSearchQuery={activeSearchQuery}
            onSelectReminder={(rem) => setSelectedDetailReminder(rem)}
            onToggleComplete={handleToggleComplete}
            onDeleteReminder={handleDeleteReminder}
            onAddNewManual={() => setIsAddManualOpen(true)}
            onBackToHome={() => setCurrentTab('home')}
          />
        )}

        {/* Screen 3: Preview / Confirm Details */}
        {currentTab === 'preview' && (
          <PreviewScreen
            extractedData={
              pendingExtractedDoc || {
                hospitalName: "Extracted Document",
                patientName: userProfile.name,
                patientMatch: "Matches Profile: Self",
                diagnosis: "Extracted action item",
                appointmentDate: new Date().toLocaleDateString('en-GB'),
                appointmentTime: "08:00 AM",
                eventTitle: "New Reminder",
                shortNote: "Extracted details from uploaded document.",
                fullText: "Extracted document content.",
                accuracy: 98,
                category: "General",
              }
            }
            userProfile={userProfile}
            onBack={() => setCurrentTab('home')}
            onCreateReminder={handleCreateReminderFromPreview}
            onDiscard={handleDiscardPreview}
          />
        )}

        {/* Screen 4: User Profile */}
        {currentTab === 'profile' && (
          <ProfileScreen
            userProfile={userProfile}
            reminders={reminders}
            onUpdateProfile={(updated) => setUserProfile(updated)}
            isDarkMode={isDarkMode}
            onToggleDarkMode={toggleDarkMode}
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={toggleNotifications}
            onRestoreBackup={handleRestoreBackup}
            onTestDeviceAlert={handleTestDeviceAlert}
          />
        )}

        {/* Persistent Bottom Navigation */}
        {currentTab !== 'preview' && (
          <BottomNav
            activeTab={currentTab}
            onSelectTab={(tab) => setCurrentTab(tab)}
            unreadCount={reminders.filter((r) => !r.isCompleted).length}
          />
        )}
      </main>

      {/* Modals & Drawers */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onExtracted={(data) => handleExtractedDoc(data)}
        userProfile={userProfile}
      />

      <AddManualModal
        isOpen={isAddManualOpen}
        onClose={() => setIsAddManualOpen(false)}
        userProfile={userProfile}
        onAddReminder={handleAddManualReminder}
      />

      <ReminderDetailModal
        reminder={selectedDetailReminder}
        onClose={() => setSelectedDetailReminder(null)}
        onToggleComplete={handleToggleComplete}
        onDelete={handleDeleteReminder}
        onUpdateReminder={handleUpdateReminder}
        userProfile={userProfile}
      />

      {/* Layer 5: Human in the loop review modal */}
      {pendingExtractedDoc && (
        <HumanInTheLoopModal
          isOpen={isHumanReviewOpen}
          extractedData={pendingExtractedDoc}
          onConfirm={handleConfirmHumanReview}
          onCancel={() => setIsHumanReviewOpen(false)}
        />
      )}

      {/* Layer 4: Deduplication merge modal */}
      {duplicateMatch && (
        <DuplicateMergeModal
          isOpen={isDuplicateModalOpen}
          newDoc={duplicateMatch.newDoc}
          existingReminder={duplicateMatch.existingReminder}
          similarityScore={duplicateMatch.similarityScore}
          reason={duplicateMatch.reason}
          onMerge={handleMergeDuplicate}
          onSaveAsNew={handleSaveAsSeparateDuplicate}
          onDiscard={handleDiscardDuplicate}
        />
      )}

      {/* Layer 6: Notification center drawer */}
      <NotificationCenterDrawer
        isOpen={isNotificationDrawerOpen}
        onClose={() => setIsNotificationDrawerOpen(false)}
        alerts={activeAlerts}
        onSnooze={handleSnoozeAlert}
        onMarkCompleted={handleToggleComplete}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={toggleNotifications}
      />

      {/* Layer 6.5: Device Pop-up Alert Modal */}
      <DeviceAlertPopupModal
        isOpen={isDeviceAlertPopupOpen}
        onClose={() => setIsDeviceAlertPopupOpen(false)}
        alerts={activeAlerts}
        onSelectReminder={(id) => {
          const found = reminders.find((r) => r.id === id);
          if (found) {
            setSelectedDetailReminder(found);
          }
        }}
        onSnoozeAlert={handleSnoozeAlert}
        onMarkCompleted={(id) => {
          handleToggleComplete(id);
          showToast('Reminder marked completed');
        }}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={toggleNotifications}
      />

      {/* Layer 7: Security vault modal */}
      <SecurityVaultModal
        isOpen={isVaultModalOpen}
        onClose={() => setIsVaultModalOpen(false)}
        securitySettings={securitySettings}
        onUpdateSecuritySettings={(updated) => setSecuritySettings(updated)}
        reminders={reminders}
        onPurgeOldScans={(cleaned, count) => {
          setReminders(cleaned);
          showToast(`Purged ${count} expired scan images for privacy`);
        }}
      />
    </div>
  );
}

