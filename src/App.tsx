import React, { useState, useEffect } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { AllRemindersScreen } from './components/AllRemindersScreen';
import { PreviewScreen } from './components/PreviewScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { BottomNav } from './components/BottomNav';
import { UploadModal } from './components/UploadModal';
import { AddManualModal } from './components/AddManualModal';
import { ReminderDetailModal } from './components/ReminderDetailModal';
import {
  NavigationTab,
  Reminder,
  UserProfile,
  ExtractedDocData,
} from './types';
import { INITIAL_REMINDERS, INITIAL_USER_PROFILE } from './data/mockData';
import { CheckCircle2, BellRing } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('home');

  // Load state from local storage or defaults (purging legacy mock items)
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const saved = localStorage.getItem('docreminder_items');
    if (!saved) return INITIAL_REMINDERS;
    try {
      const parsed: Reminder[] = JSON.parse(saved);
      // Remove legacy sample items if present
      const clean = parsed.filter((r) => 
        !['rem_1', 'rem_2', 'rem_3', 'rem_4', 'rem_5'].includes(r.id) &&
        !r.patientName?.toLowerCase().includes('pagbara') &&
        !r.hospitalName?.toLowerCase().includes('nicholas')
      );
      return clean;
    } catch {
      return [];
    }
  });

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('docreminder_profile');
    if (!saved) return INITIAL_USER_PROFILE;
    try {
      const parsed: UserProfile = JSON.parse(saved);
      const str = JSON.stringify(parsed).toLowerCase();
      if (str.includes('pagbara') || str.includes('promise') || str.includes('nicholas') || str.includes('leadway')) {
        localStorage.removeItem('docreminder_profile');
        return INITIAL_USER_PROFILE;
      }
      return parsed;
    } catch {
      return INITIAL_USER_PROFILE;
    }
  });

  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');
  const [pendingExtractedDoc, setPendingExtractedDoc] = useState<ExtractedDocData | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isAddManualOpen, setIsAddManualOpen] = useState<boolean>(false);
  const [selectedDetailReminder, setSelectedDetailReminder] = useState<Reminder | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync state to local storage
  useEffect(() => {
    localStorage.setItem('docreminder_items', JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    localStorage.setItem('docreminder_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  const handleNavigateToReminders = (searchQuery?: string) => {
    if (typeof searchQuery === 'string') {
      setActiveSearchQuery(searchQuery);
    } else {
      setActiveSearchQuery('');
    }
    setCurrentTab('reminders');
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleExtractedDoc = (extractedData: ExtractedDocData) => {
    setPendingExtractedDoc(extractedData);
    setCurrentTab('preview');
  };

  const handleCreateReminderFromPreview = (newReminder: Reminder) => {
    setReminders((prev) => [newReminder, ...prev]);
    setPendingExtractedDoc(null);
    setCurrentTab('home');
    showToast(`Reminder created for ${newReminder.eventTitle}!`);
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
          return { ...r, isCompleted: updated };
        }
        return r;
      })
    );
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

  return (
    <div className="min-h-screen bg-[#f8fafb] text-[#191c1d] font-sans antialiased selection:bg-[#afefdd] selection:text-[#00342b]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#00342b] text-white px-5 py-2.5 rounded-full shadow-xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-4 duration-200 border border-[#94d3c1]">
          <BellRing className="w-4 h-4 text-[#94d3c1]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-md mx-auto min-h-screen bg-[#f8fafb] shadow-xs relative">
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
                appointmentTime: "09:00 AM",
                eventTitle: "New Reminder",
                shortNote: "Extracted details from uploaded document.",
                fullText: "Extracted document content.",
                accuracy: 95,
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
            onUpdateProfile={(updated) => setUserProfile(updated)}
          />
        )}

        {/* Persistent Bottom Navigation (Hidden on Preview screen to allow sticky action buttons) */}
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
      />
    </div>
  );
}
