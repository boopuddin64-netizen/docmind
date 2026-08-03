import { Reminder, UserProfile, ExtractedDocData } from '../types';

export const INITIAL_USER_PROFILE: UserProfile = {
  name: "User Account",
  email: "user@documind.app",
  avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
  medicalId: "DM-1001",
  primaryHospital: "Not set",
  insuranceProvider: "Not set",
  policyNumber: "Not set",
  bloodType: "Not set",
  familyMembers: [
    {
      id: "fam_1",
      name: "User Account",
      relation: "Self",
      bloodGroup: "Not set",
      allergies: [],
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    },
  ],
};

export const INITIAL_REMINDERS: Reminder[] = [];

export const SAMPLE_PRESET_DOCUMENTS: Array<{
  id: string;
  title: string;
  hospital: string;
  date: string;
  type: string;
  data: ExtractedDocData;
}> = [];

