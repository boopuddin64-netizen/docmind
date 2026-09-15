export type NavigationTab = 'home' | 'reminders' | 'profile' | 'preview' | 'vault';

export type ReminderCategory =
  | 'Medical'
  | 'Bills & Invoices'
  | 'Contracts & Legal'
  | 'Vehicle & Home'
  | 'Work & Study'
  | 'Subscriptions'
  | 'General'
  | 'Dental'
  | 'Checkup'
  | 'Prescription'
  | 'Lab Tests'
  | 'Specialist';

export type ReminderStatus = 'Confirmed' | 'Pending' | 'Completed' | 'Urgent';

export interface FieldConfidence {
  field: string;
  score: number; // 0 - 100
  isVerifiedByUser?: boolean;
}

export interface SecurityAuditLog {
  id: string;
  timestamp: string;
  action: string;
  details: string;
  actor: string;
}

export interface Reminder {
  id: string;
  eventTitle: string;
  hospitalName: string; // Issuer / Hospital / Provider / Organization
  patientName: string;  // Recipient / Patient / Owner Name
  patientMatch: string; // Profile Match e.g., "Matches Profile: Self"
  diagnosis: string;    // Subject / Purpose / Details
  appointmentDate: string; // e.g., "15/05/2026" or Due Date (DD/MM/YYYY or YYYY-MM-DD)
  appointmentTime: string; // e.g., "10:00 AM" or "11:59 PM"
  shortNote: string;
  fullText?: string;
  category: ReminderCategory;
  status: ReminderStatus;
  accuracy?: number; // Overall AI extraction confidence score 0-100
  createdAt: string;
  isCompleted?: boolean;
  documentUrl?: string;
  documentType?: string;
  
  // Advanced Upgrade Fields
  dedupHash?: string; // Composite key hash for deduplication
  fieldConfidences?: FieldConfidence[];
  needsReview?: boolean;
  securityVaultEncrypted?: boolean;
  vaultId?: 'personal' | 'household';
  auditLogs?: SecurityAuditLog[];
  notificationSchedule?: {
    sevenDaysBefore?: boolean;
    threeDaysBefore?: boolean;
    oneDayBefore?: boolean;
    dayOfEvent?: boolean;
    snoozedUntil?: string | null;
  };
}

export interface ExtractedDocData {
  hospitalName: string;
  patientName: string;
  patientMatch: string;
  diagnosis: string;
  appointmentDate: string;
  appointmentTime: string;
  eventTitle: string;
  shortNote: string;
  fullText: string;
  accuracy: number;
  category: ReminderCategory;
  documentUrl?: string;
  
  // Enhanced extraction metadata
  extractedItems?: ExtractedDocData[];
  dedupHash?: string;
  fieldConfidences?: FieldConfidence[];
  needsReview?: boolean;
  rawJson?: any;
}

export interface PreprocessorSettings {
  autoDeskew: boolean;
  contrastBoost: number; // 1.0 to 2.5
  grayscale: boolean;
  brightness: number; // 0.8 to 1.5
  noiseReduction: boolean;
  thresholding: boolean;
}

export interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  avatar?: string;
  bloodGroup?: string;
  allergies?: string[];
}

export interface SecuritySettings {
  endToEndEncryption: boolean;
  autoPurgeDays: number; // 0 = Never, 30, 90
  activeVault: 'personal' | 'household';
  requirePasscode: boolean;
  passcodeHash?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  avatar: string;
  medicalId: string;
  primaryHospital: string;
  insuranceProvider: string;
  policyNumber: string;
  bloodType: string;
  familyMembers: FamilyMember[];
  securitySettings?: SecuritySettings;
}

