// Common patient types
export interface Patient {
  id: string;
  name: string;
  email?: string;
  age?: number;
  gender?: string;
  phone?: string;
  address?: string;
}

export interface PatientState {
  patients: Patient[];
  currentPatient: Patient | null;
  loading: boolean;
  error: string | null;
  totalCount: number;
}

export interface CreatePatientData {
  name: string;
  email?: string;
  age?: number;
  gender?: string;
  phone?: string;
  address?: string;
}

export interface UpdatePatientData {
  name?: string;
  email?: string;
  age?: number;
  gender?: string;
  phone?: string;
  address?: string;
}
