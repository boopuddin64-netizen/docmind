import React, { useState, useRef } from 'react';
import {
  User,
  Heart,
  Shield,
  Phone,
  Plus,
  Trash2,
  CheckCircle2,
  Building,
  Bell,
  BellRing,
  Mail,
  FileCheck,
  Smartphone,
  Download,
  Share2,
  Copy,
  Pencil,
  Save,
  Camera,
  Upload,
  Image as ImageIcon,
  Check,
  RotateCcw,
  Moon,
  Sun,
  ChevronDown,
  Sliders,
  ShieldCheck,
} from 'lucide-react';
import { UserProfile, FamilyMember, Reminder } from '../types';
import { ResetAndBackupModal } from './ResetAndBackupModal';

interface ProfileScreenProps {
  userProfile: UserProfile;
  reminders?: Reminder[];
  onUpdateProfile: (updated: UserProfile) => void;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
  onRestoreBackup?: (restoredReminders: Reminder[], restoredProfile?: UserProfile) => void;
  onTestDeviceAlert?: () => void;
}

const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&auto=format&fit=crop&q=80',
];

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  userProfile,
  reminders = [],
  onUpdateProfile,
  isDarkMode = false,
  onToggleDarkMode,
  notificationsEnabled = true,
  onToggleNotifications,
  onRestoreBackup,
  onTestDeviceAlert,
}) => {
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(true);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [profileName, setProfileName] = useState(userProfile.name);
  const [profileEmail, setProfileEmail] = useState(userProfile.email);
  const [profileAvatar, setProfileAvatar] = useState(userProfile.avatar);
  const [primaryHospital, setPrimaryHospital] = useState(userProfile.primaryHospital);
  const [insuranceProvider, setInsuranceProvider] = useState(userProfile.insuranceProvider);
  const [policyNumber, setPolicyNumber] = useState(userProfile.policyNumber);

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newFamName, setNewFamName] = useState('');
  const [newFamRelation, setNewFamRelation] = useState('Son');
  const [showAddFam, setShowAddFam] = useState(false);

  // Keep edit state synced if userProfile changes
  React.useEffect(() => {
    setProfileName(userProfile.name);
    setProfileEmail(userProfile.email);
    setProfileAvatar(userProfile.avatar);
    setPrimaryHospital(userProfile.primaryHospital);
    setInsuranceProvider(userProfile.insuranceProvider);
    setPolicyNumber(userProfile.policyNumber);
  }, [userProfile]);

  const handleSaveProfileEdits = () => {
    // Automatically update 'Self' household member to match updated profile name & avatar!
    const updatedFamilyMembers = userProfile.familyMembers.map((fam) => {
      if (fam.relation === 'Self') {
        return {
          ...fam,
          name: profileName,
          avatar: profileAvatar,
        };
      }
      return fam;
    });

    onUpdateProfile({
      ...userProfile,
      name: profileName,
      email: profileEmail,
      avatar: profileAvatar,
      primaryHospital,
      insuranceProvider,
      policyNumber,
      familyMembers: updatedFamilyMembers,
    });
    setIsEditingProfile(false);
    setShowAvatarPicker(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setProfileAvatar(reader.result);
          setShowAvatarPicker(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddFamilyMember = () => {
    if (!newFamName.trim()) return;

    const newMember: FamilyMember = {
      id: `fam_${Date.now()}`,
      name: newFamName,
      relation: newFamRelation,
      avatar: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
    };

    onUpdateProfile({
      ...userProfile,
      familyMembers: [...userProfile.familyMembers, newMember],
    });

    setNewFamName('');
    setShowAddFam(false);
  };

  const handleRemoveFamily = (id: string) => {
    if (userProfile.familyMembers.length <= 1) return;
    onUpdateProfile({
      ...userProfile,
      familyMembers: userProfile.familyMembers.filter((f) => f.id !== id),
    });
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafb] dark:bg-[#0f172a] pb-28 px-4 sm:px-6 pt-4 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Header Profile Card */}
          <div className="bg-white dark:bg-[#1e293b] rounded-3xl p-5 border border-[#e1e3e4] dark:border-sky-900/40 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Avatar image with Edit trigger */}
            <div
              className="relative group cursor-pointer"
              onClick={() => {
                setIsEditingProfile(true);
                setShowAvatarPicker(true);
              }}
            >
              <img
                src={isEditingProfile ? profileAvatar : userProfile.avatar}
                alt={userProfile.name}
                className="w-16 h-16 rounded-full object-cover border-2 border-[#0284c7] shadow-xs group-hover:opacity-90 transition-opacity"
              />
              <button
                type="button"
                className="absolute bottom-0 right-0 bg-[#0284c7] text-white p-1.5 rounded-full shadow-md hover:bg-[#0369a1] transition-transform active:scale-90"
                title="Change Profile Photo"
                id="btn-change-avatar"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#005faf] bg-[#d4e3ff] px-2 py-0.5 rounded">
                Primary Account
              </span>
              <h1 className="text-lg font-bold text-[#191c1d] dark:text-white mt-0.5">
                {userProfile.name}
              </h1>
              <p className="text-xs text-[#3f4945] dark:text-slate-300 flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-[#707975]" />
                {userProfile.email}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setIsEditingProfile(!isEditingProfile);
              setShowAvatarPicker(false);
            }}
            className="text-xs font-bold text-[#005faf] bg-[#d4e3ff] hover:bg-[#54a0fe]/30 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
            id="btn-edit-profile-toggle"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{isEditingProfile ? 'Cancel' : 'Edit Profile'}</span>
          </button>
        </div>

        {/* Profile Picture Chooser Modal / Inline Panel */}
        {isEditingProfile && showAvatarPicker && (
          <div className="bg-[#f2f4f5] p-3.5 rounded-2xl border border-[#e1e3e4] space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#0284c7] uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" />
                Select Profile Picture
              </h3>
              <button
                onClick={() => setShowAvatarPicker(false)}
                className="text-[11px] text-[#707975] hover:underline font-semibold"
              >
                Close
              </button>
            </div>

            {/* Presets Grid */}
            <div>
              <p className="text-[10px] text-[#3f4945] font-semibold mb-1.5">Choose Preset Photo:</p>
              <div className="grid grid-cols-6 gap-2">
                {PRESET_AVATARS.map((url, idx) => (
                  <button
                    key={idx}
                    onClick={() => setProfileAvatar(url)}
                    className={`relative rounded-full overflow-hidden border-2 transition-all ${
                      profileAvatar === url
                        ? 'border-[#0284c7] scale-105 ring-2 ring-sky-300'
                        : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                  >
                    <img src={url} alt={`Preset ${idx}`} className="w-10 h-10 object-cover" />
                    {profileAvatar === url && (
                      <div className="absolute inset-0 bg-[#0284c7]/40 flex items-center justify-center">
                        <Check className="w-4 h-4 text-white stroke-[3]" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload File or URL */}
            <div className="pt-2 border-t border-[#e1e3e4] flex items-center justify-between gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-white border border-[#e1e3e4] hover:bg-[#eceeef] text-[#0284c7] text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow-2xs"
                id="btn-upload-photo"
              >
                <Upload className="w-3.5 h-3.5 text-[#005faf]" />
                <span>Upload From Device</span>
              </button>
            </div>
          </div>
        )}

        {/* Editable Profile Inputs */}
        {isEditingProfile && (
          <div className="pt-3 border-t border-[#e1e3e4] space-y-3 animate-in fade-in">
            <h3 className="text-xs font-bold text-[#0284c7] uppercase tracking-wider">
              Edit Account & Personal Details
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-[#3f4945] uppercase">Full Name</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-1.5 text-xs font-semibold text-[#191c1d]"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[#3f4945] uppercase">Email</label>
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-1.5 text-xs font-semibold text-[#191c1d]"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#3f4945] uppercase">Account / Member ID</label>
              <input
                type="text"
                value={insuranceProvider}
                onChange={(e) => setInsuranceProvider(e.target.value)}
                className="w-full bg-[#f2f4f5] border border-[#e1e3e4] rounded-xl px-3 py-1.5 text-xs font-semibold text-[#191c1d]"
              />
            </div>

            <button
              onClick={handleSaveProfileEdits}
              className="w-full py-2.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold text-xs rounded-full flex items-center justify-center gap-2 shadow-xs transition-colors"
              id="btn-save-profile-edits"
            >
              <Save className="w-4 h-4" />
              <span>Save Profile Changes</span>
            </button>
          </div>
        )}
      </div>

      {/* Account Pass Card */}
      <div className="bg-[#0284c7] rounded-2xl p-5 text-white shadow-xs space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-sky-200" />
            <span className="text-xs font-bold uppercase tracking-wider text-sky-200">
              DocuMind Account Card
            </span>
          </div>
          <span className="text-xs bg-[#0369a1] px-2.5 py-1 rounded-full text-white font-mono">
            {userProfile.medicalId}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs pt-2 text-sky-200 border-t border-sky-600/50">
          <span>Account Holder: <strong className="text-white">{userProfile.name}</strong></span>
          <span>Contact: <strong className="text-white">{userProfile.email}</strong></span>
        </div>
      </div>

      {/* Family Members / Household Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Heart className="w-4 h-4 text-[#005faf] dark:text-sky-400" />
            <h2 className="text-xs font-bold text-[#3f4945] dark:text-sky-300 uppercase tracking-wider">
              Family Members & Household ({userProfile.familyMembers.length})
            </h2>
          </div>
          <button
            onClick={() => setShowAddFam(!showAddFam)}
            className="text-xs font-bold text-[#005faf] dark:text-sky-400 hover:underline flex items-center gap-1"
            id="btn-add-family"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Member</span>
          </button>
        </div>

        {showAddFam && (
          <div className="bg-white dark:bg-[#1e293b] p-4 rounded-2xl border border-[#0284c7] dark:border-sky-600 space-y-3 animate-in fade-in">
            <h3 className="text-xs font-bold text-[#191c1d] dark:text-white">
              Add Family Member Profile
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Full Name (e.g., Kemi Okafor)"
                value={newFamName}
                onChange={(e) => setNewFamName(e.target.value)}
                className="flex-1 bg-[#f2f4f5] dark:bg-[#0f172a] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-3 py-2 text-xs text-[#191c1d] dark:text-white"
                id="input-family-name"
              />
              <select
                value={newFamRelation}
                onChange={(e) => setNewFamRelation(e.target.value)}
                className="bg-[#f2f4f5] dark:bg-[#0f172a] border border-[#e1e3e4] dark:border-sky-900/50 rounded-xl px-2 py-2 text-xs font-semibold text-[#191c1d] dark:text-white"
                id="select-family-relation"
              >
                <option value="Son">Son</option>
                <option value="Daughter">Daughter</option>
                <option value="Spouse">Spouse</option>
                <option value="Parent">Parent</option>
                <option value="Sister">Sister</option>
                <option value="Brother">Brother</option>
                <option value="Friend">Friend</option>
                <option value="Dependent">Dependent</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddFam(false)}
                className="text-xs text-[#707975] dark:text-sky-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleAddFamilyMember}
                className="bg-[#0284c7] text-white text-xs font-bold px-4 py-1.5 rounded-full"
                id="btn-save-family-member"
              >
                Save Member
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2.5">
          {userProfile.familyMembers.map((fam) => {
            const isSelf = fam.relation === 'Self';
            const displayName = isSelf ? userProfile.name : fam.name;
            const displayAvatar = isSelf ? userProfile.avatar : fam.avatar;

            return (
              <div
                key={fam.id}
                className="bg-white dark:bg-[#1e293b] p-3.5 rounded-2xl border border-[#e1e3e4] dark:border-sky-900/40 flex items-center justify-between shadow-2xs"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={
                      displayAvatar ||
                      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
                    }
                    alt={displayName}
                    className="w-10 h-10 rounded-full object-cover border border-[#e1e3e4] dark:border-sky-800"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-[#191c1d] dark:text-white">
                      {displayName}
                    </h3>
                    <p className="text-xs text-[#3f4945] dark:text-sky-300/80">
                      {fam.relation} • {isSelf ? 'Primary Account' : 'Household Member'}
                    </p>
                  </div>
                </div>

                {!isSelf && (
                  <button
                    onClick={() => handleRemoveFamily(fam.id)}
                    className="p-1.5 text-[#707975] dark:text-sky-400 hover:text-[#ba1a1a] rounded-lg"
                    title="Remove family member"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {/* Right Column */}
      <div className="space-y-6">
        {/* App & Preferences Card (Collapsible Accordion Dropdown) */}
        <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-[#e1e3e4] dark:border-sky-900/40 overflow-hidden shadow-xs transition-all">
        <button
          onClick={() => setIsPreferencesOpen((prev) => !prev)}
          className="w-full p-4 flex items-center justify-between bg-slate-50/80 dark:bg-[#0f172a] hover:bg-slate-100/80 transition-colors text-left"
          id="btn-toggle-preferences-accordion"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-900/60 text-[#0284c7] dark:text-sky-300 flex items-center justify-center">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-[#191c1d] dark:text-white uppercase tracking-wider">
                Preferences & Security
              </h2>
              <p className="text-[11px] text-[#707975] dark:text-sky-300/70">
                Notification alerts, dark mode, and privacy controls
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#0284c7] dark:text-sky-300 bg-sky-100 dark:bg-sky-900/60 px-2 py-0.5 rounded-full">
              {isPreferencesOpen ? 'Tap to Collapse' : 'Expand Controls'}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isPreferencesOpen ? 'rotate-180' : 'rotate-0'}`} />
          </div>
        </button>

        {/* Accordion Content */}
        {isPreferencesOpen && (
          <div className="p-4 space-y-3.5 border-t border-[#e1e3e4] dark:border-sky-900/40 animate-in fade-in duration-150">
            {/* Notifications Toggle Row */}
            <div className="py-2 border-b border-[#f2f4f5] dark:border-sky-900/30 space-y-2">
              <div
                onClick={onToggleNotifications}
                className="flex items-center justify-between cursor-pointer group hover:bg-slate-50/80 dark:hover:bg-sky-900/20 px-1 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Bell className={`w-4 h-4 ${notificationsEnabled ? 'text-[#0284c7]' : 'text-slate-400'}`} />
                  <div>
                    <span className="text-xs font-semibold text-[#191c1d] dark:text-white block group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                      Notifications & Reminders
                    </span>
                    <span className="text-[10px] text-[#707975] dark:text-sky-300/70 block">
                      {notificationsEnabled ? 'Active: Receive alerts for upcoming deadlines' : 'Off: Deadline alerts paused'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleNotifications) onToggleNotifications();
                  }}
                  className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                    notificationsEnabled ? 'bg-[#0284c7] justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
                  }`}
                  id="btn-profile-notifications-toggle"
                  title="Toggle Notifications"
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md flex items-center justify-center">
                    <Bell className={`w-2.5 h-2.5 ${notificationsEnabled ? 'text-[#0284c7]' : 'text-slate-400'}`} />
                  </div>
                </button>
              </div>

              {onTestDeviceAlert && (
                <div className="flex items-center justify-between pl-7 pr-1 pt-1">
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70">
                    Verify pop-up alerts on this device
                  </span>
                  <button
                    type="button"
                    onClick={onTestDeviceAlert}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                    id="btn-test-device-alert"
                  >
                    <BellRing className="w-3 h-3 text-amber-100" />
                    <span>Test Pop-Up Alert</span>
                  </button>
                </div>
              )}
            </div>

            {/* Dark Mode Row */}
            <div
              onClick={onToggleDarkMode}
              className="flex items-center justify-between py-2 border-b border-[#f2f4f5] dark:border-sky-900/30 cursor-pointer group hover:bg-slate-50/80 dark:hover:bg-sky-900/20 px-1 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {isDarkMode ? (
                  <Moon className="w-4 h-4 text-amber-500" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-600" />
                )}
                <div>
                  <span className="text-xs font-semibold text-[#191c1d] dark:text-white block group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                    Appearance (Dark Mode)
                  </span>
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70 block">
                    {isDarkMode ? 'Eye-soothing dark theme active' : 'Clean high-contrast light theme'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleDarkMode) onToggleDarkMode();
                }}
                className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                  isDarkMode ? 'bg-[#0284c7] justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
                }`}
                id="btn-profile-darkmode-toggle"
                title="Toggle Dark Mode"
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-md flex items-center justify-center">
                  {isDarkMode ? (
                    <Moon className="w-2.5 h-2.5 text-[#0284c7]" />
                  ) : (
                    <Sun className="w-2.5 h-2.5 text-amber-500" />
                  )}
                </div>
              </button>
            </div>

            {/* Privacy Protection Summary */}
            <div className="flex items-center justify-between py-1 border-b border-[#f2f4f5] dark:border-sky-900/30">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                <div>
                  <span className="text-xs font-semibold text-[#191c1d] dark:text-white block">
                    Private & Secure Storage
                  </span>
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70 block">
                    Your documents stay safely locked on your own device
                  </span>
                </div>
              </div>
              <span className="text-xs text-[#0284c7] dark:text-sky-300 font-bold bg-sky-100 dark:bg-sky-900/60 px-2 py-0.5 rounded-full">
                Protected
              </span>
            </div>

            {/* Smart Document Reader */}
            <div className="flex items-center justify-between py-1 border-b border-[#f2f4f5] dark:border-sky-900/30">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                <div>
                  <span className="text-xs font-semibold text-[#191c1d] dark:text-white block">
                    Smart Document Reader
                  </span>
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70 block">
                    Automatically scans dates, titles & details
                  </span>
                </div>
              </div>
              <span className="text-xs text-[#0284c7] dark:text-sky-300 font-bold">Active</span>
            </div>

            {/* Backup & Restore Data Option */}
            <div className="flex items-center justify-between py-1 border-b border-[#f2f4f5] dark:border-sky-900/30">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                <div>
                  <span className="text-xs font-semibold text-[#191c1d] dark:text-white block">
                    Backup & Restore Data
                  </span>
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70 block">
                    Export encrypted .dmback file or import existing backup
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsResetModalOpen(true)}
                className="text-xs font-bold text-[#0284c7] dark:text-sky-300 hover:underline bg-sky-50 dark:bg-sky-900/40 px-3 py-1 rounded-xl transition-colors"
                id="btn-backup-restore-direct"
              >
                Backup & Restore
              </button>
            </div>

            {/* Reset App Option */}
            <div className="pt-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[#ba1a1a]" />
                <div>
                  <span className="text-xs font-bold text-[#191c1d] dark:text-white block">
                    Reset App Data
                  </span>
                  <span className="text-[10px] text-[#707975] dark:text-sky-300/70 block">
                    Clear all scanned documents & start fresh
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsResetModalOpen(true)}
                className="text-xs font-bold text-[#ba1a1a] bg-[#ffdad6] hover:bg-[#ba1a1a] hover:text-white px-3.5 py-1.5 rounded-xl transition-colors border border-[#ffb4ab] cursor-pointer"
                id="btn-reset-app-data"
              >
                Reset App Data
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Security & Reset Confirmation Modal */}
      <ResetAndBackupModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        reminders={reminders}
        userProfile={userProfile}
        onConfirmReset={() => {
          localStorage.removeItem('docreminder_items');
          localStorage.removeItem('docreminder_profile');
          window.location.reload();
        }}
        onRestoreBackup={onRestoreBackup}
      />

      {/* Native Mobile App & PWA Card */}
      <div className="bg-[#0284c7] rounded-2xl p-4 text-white space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-sky-200" />
            <h2 className="text-sm font-bold tracking-tight text-white">
              Native Mobile App Experience
            </h2>
          </div>
          <span className="text-[10px] font-bold bg-[#0369a1] text-sky-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
            PWA Ready
          </span>
        </div>

        <p className="text-xs text-sky-100/90 leading-relaxed">
          DocuMind is built with a mobile-first native PWA architecture. You can install it directly to your iOS or Android home screen without needing an app store!
        </p>

        <div className="bg-[#0369a1] p-3 rounded-xl space-y-2 text-xs">
          <div className="flex items-start gap-2">
            <span className="font-bold text-sky-200">iOS (Safari):</span>
            <span className="text-white/90">Tap Share <Share2 className="w-3 h-3 inline text-sky-200" /> → 'Add to Home Screen'</span>
          </div>
          <div className="flex items-start gap-2 border-t border-white/10 pt-2">
            <span className="font-bold text-sky-200">Android (Chrome):</span>
            <span className="text-white/90">Tap Menu ⋮ → 'Install App' or 'Add to Home Screen'</span>
          </div>
        </div>

        <div className="pt-1 flex items-center justify-between">
          <button
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
                alert("App link copied to clipboard! Open in Safari or Chrome to install as Native App.");
              }
            }}
            className="bg-white text-[#0284c7] text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 hover:bg-sky-50 transition-colors shadow-sm"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy App Link for Mobile</span>
          </button>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
};
