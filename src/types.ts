export type NavigationTab = 'home' | 'reminders' | 'profile' | 'preview';

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

export interface Reminder {
  id: string;
  eventTitle: string;
  hospitalName: string; // Issuer / Hospital / Provider / Organization
  patientName: string;  // Recipient / Patient / Owner Name
  patientMatch: string; // Profile Match e.g., "Matches Profile: Self"
  diagnosis: string;    // Subject / Purpose / Details
  appointmentDate: string; // e.g., "15/05/2024" or Due Date
  appointmentTime: string; // e.g., "10:00 AM" or "11:59 PM"
  shortNote: string;
  fullText?: string;
  category: ReminderCategory;
  status: ReminderStatus;
  accuracy?: number;
  createdAt: string;
  isCompleted?: boolean;
  documentUrl?: string;
  documentType?: string;
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
}

export interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  avatar?: string;
  bloodGroup?: string;
  allergies?: string[];
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
}
