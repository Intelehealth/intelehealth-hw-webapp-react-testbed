import type { PatientState, Patient, UpdatePatientData } from '../types/patient.types';

// Patient action types
export type PatientAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: Patient[] }
  | { type: 'FETCH_FAILURE'; payload: string }
  | { type: 'ADD_PATIENT'; payload: Patient }
  | { type: 'UPDATE_PATIENT'; payload: { id: string; data: UpdatePatientData } }
  | { type: 'DELETE_PATIENT'; payload: string }
  | { type: 'SET_CURRENT_PATIENT'; payload: Patient | null }
  | { type: 'CLEAR_ERROR' };

// Patient reducer
export const patientReducer = (state: PatientState, action: PatientAction): PatientState => {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    
    case 'FETCH_SUCCESS':
      return {
        ...state,
        patients: action.payload,
        loading: false,
        error: null,
        totalCount: action.payload.length,
      };
    
    case 'FETCH_FAILURE':
      return { ...state, loading: false, error: action.payload };
    
    case 'ADD_PATIENT':
      return {
        ...state,
        patients: [...state.patients, action.payload],
        totalCount: state.totalCount + 1,
      };
    
    case 'UPDATE_PATIENT':
      return {
        ...state,
        patients: state.patients.map((patient: Patient) =>
          patient.id === action.payload.id
            ? { ...patient, ...action.payload.data }
            : patient
        ),
      };
    
    case 'DELETE_PATIENT':
      return {
        ...state,
        patients: state.patients.filter((patient: Patient) => patient.id !== action.payload),
        totalCount: state.totalCount - 1,
      };
    
    case 'SET_CURRENT_PATIENT':
      return { ...state, currentPatient: action.payload };
    
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    
    default:
      return state;
  }
};
