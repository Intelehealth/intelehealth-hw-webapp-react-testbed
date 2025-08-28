import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  trackApiError,
  trackCriticalOperation,
  trackDataAccess,
  trackFormSubmission,
  trackHealthWorkerAction,
  trackPatientInteraction,
  trackReactError,
  trackUserLogin,
} from './sentry';

// Mock the Sentry functions
vi.mock('../config/sentry', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

describe('Sentry Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('trackHealthWorkerAction', () => {
    it('should track health worker action with proper tags and context', async () => {
      const { setTag, setContext, captureMessage } = await import(
        '../config/sentry'
      );

      trackHealthWorkerAction('patient_view', {
        patientId: '123',
        timestamp: '2024-01-01',
      });

      expect(setTag).toHaveBeenCalledWith('action_type', 'patient_view');
      expect(setTag).toHaveBeenCalledWith('user_role', 'health_worker');
      expect(setContext).toHaveBeenCalledWith('action_details', {
        patientId: '123',
        timestamp: '2024-01-01',
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'Health worker performed action: patient_view',
        'info'
      );
    });
  });

  describe('trackPatientInteraction', () => {
    it('should track patient interaction with proper tags and context', async () => {
      const { setTag, setContext, captureMessage } = await import(
        '../config/sentry'
      );

      trackPatientInteraction('consultation', 'patient_123', {
        duration: 30,
        notes: 'Follow-up',
      });

      expect(setTag).toHaveBeenCalledWith('interaction_type', 'consultation');
      expect(setTag).toHaveBeenCalledWith('patient_id', 'patient_123');
      expect(setTag).toHaveBeenCalledWith('user_role', 'health_worker');
      expect(setContext).toHaveBeenCalledWith('interaction_details', {
        duration: 30,
        notes: 'Follow-up',
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'Patient interaction: consultation',
        'info'
      );
    });
  });

  describe('trackFormSubmission', () => {
    it('should track successful form submission', async () => {
      const { setTag, setContext, captureMessage } = await import(
        '../config/sentry'
      );

      trackFormSubmission('patient_registration', true, {
        patientId: '123',
        formData: { name: 'John' },
      });

      expect(setTag).toHaveBeenCalledWith('form_name', 'patient_registration');
      expect(setTag).toHaveBeenCalledWith('submission_success', 'true');
      expect(setContext).toHaveBeenCalledWith('form_details', {
        patientId: '123',
        formData: { name: 'John' },
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'Form submitted successfully: patient_registration',
        'info'
      );
    });

    it('should track failed form submission', async () => {
      const { setTag, setContext, captureMessage } = await import(
        '../config/sentry'
      );

      trackFormSubmission('patient_registration', false, {
        patientId: '123',
        error: 'Validation failed',
      });

      expect(setTag).toHaveBeenCalledWith('form_name', 'patient_registration');
      expect(setTag).toHaveBeenCalledWith('submission_success', 'false');
      expect(setContext).toHaveBeenCalledWith('form_details', {
        patientId: '123',
        error: 'Validation failed',
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'Form submission failed: patient_registration',
        'error'
      );
    });
  });

  describe('trackApiError', () => {
    it('should track API error with proper tags and context', async () => {
      const { setTag, setContext, captureException } = await import(
        '../config/sentry'
      );
      const error = new Error('API timeout');

      trackApiError('/api/patients', error, {
        userId: '123',
        requestId: 'req_456',
      });

      expect(setTag).toHaveBeenCalledWith('endpoint', '/api/patients');
      expect(setTag).toHaveBeenCalledWith('error_type', 'api_error');
      expect(setContext).toHaveBeenCalledWith('api_context', {
        userId: '123',
        requestId: 'req_456',
      });
      expect(captureException).toHaveBeenCalledWith(error);
    });
  });

  describe('trackCriticalOperation', () => {
    it('should track successful critical operation', async () => {
      const { setTag, setContext, captureMessage } = await import(
        '../config/sentry'
      );

      trackCriticalOperation('patient_data_sync', 1500, true);

      expect(setTag).toHaveBeenCalledWith('operation', 'patient_data_sync');
      expect(setTag).toHaveBeenCalledWith('operation_success', 'true');
      expect(setContext).toHaveBeenCalledWith('performance', {
        duration_ms: 1500,
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'Critical operation completed: patient_data_sync',
        'info'
      );
    });

    it('should track failed critical operation', async () => {
      const { setTag, setContext, captureMessage } = await import(
        '../config/sentry'
      );

      trackCriticalOperation('patient_data_sync', 1500, false);

      expect(setTag).toHaveBeenCalledWith('operation', 'patient_data_sync');
      expect(setTag).toHaveBeenCalledWith('operation_success', 'false');
      expect(setContext).toHaveBeenCalledWith('performance', {
        duration_ms: 1500,
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'Critical operation failed: patient_data_sync',
        'error'
      );
    });
  });

  describe('trackUserLogin', () => {
    it('should track successful user login', async () => {
      const { setUser, setTag, captureMessage } = await import(
        '../config/sentry'
      );

      trackUserLogin('user_123', 'password', true);

      expect(setUser).toHaveBeenCalledWith({
        id: 'user_123',
        role: 'health_worker',
      });
      expect(setTag).toHaveBeenCalledWith('login_method', 'password');
      expect(setTag).toHaveBeenCalledWith('login_success', 'true');
      expect(captureMessage).toHaveBeenCalledWith(
        'User logged in successfully: user_123',
        'info'
      );
    });

    it('should track failed user login', async () => {
      const { setUser, setTag, captureMessage } = await import(
        '../config/sentry'
      );

      trackUserLogin('user_123', 'password', false);

      expect(setUser).toHaveBeenCalledWith({
        id: 'user_123',
        role: 'health_worker',
      });
      expect(setTag).toHaveBeenCalledWith('login_method', 'password');
      expect(setTag).toHaveBeenCalledWith('login_success', 'false');
      expect(captureMessage).toHaveBeenCalledWith(
        'User login failed: user_123',
        'warning'
      );
    });
  });

  describe('trackDataAccess', () => {
    it('should track data access with compliance tags', async () => {
      const { setTag, captureMessage } = await import('../config/sentry');

      trackDataAccess('medical_records', 'patient_123', 'read');

      expect(setTag).toHaveBeenCalledWith('data_type', 'medical_records');
      expect(setTag).toHaveBeenCalledWith('patient_id', 'patient_123');
      expect(setTag).toHaveBeenCalledWith('access_type', 'read');
      expect(setTag).toHaveBeenCalledWith('compliance_tracked', 'true');
      expect(captureMessage).toHaveBeenCalledWith(
        'Data access: read medical_records for patient patient_123',
        'info'
      );
    });
  });

  describe('trackReactError', () => {
    it('should track React error with component context', async () => {
      const { setTag, setContext, captureException } = await import(
        '../config/sentry'
      );
      const error = new Error('Component error');
      const errorInfo = { componentStack: 'Component stack trace' };

      trackReactError(error, errorInfo, 'PatientForm');

      expect(setTag).toHaveBeenCalledWith('error_source', 'react_component');
      expect(setTag).toHaveBeenCalledWith('component_name', 'PatientForm');
      expect(setContext).toHaveBeenCalledWith('react_error_info', errorInfo);
      expect(captureException).toHaveBeenCalledWith(error);
    });
  });
});
