import {
  captureException,
  captureMessage,
  setContext,
  setTag,
  setUser,
} from '../config/sentry';

// Healthcare-specific error tracking
export const trackHealthWorkerAction = (
  action: string,
  details: Record<string, unknown>
) => {
  setTag('action_type', action);
  setTag('user_role', 'health_worker');
  setContext('action_details', details);

  captureMessage(`Health worker performed action: ${action}`, 'info');
};

// Patient-related error tracking
export const trackPatientInteraction = (
  interactionType: string,
  patientId: string,
  details: Record<string, unknown>
) => {
  setTag('interaction_type', interactionType);
  setTag('patient_id', patientId);
  setTag('user_role', 'health_worker');
  setContext('interaction_details', details);

  captureMessage(`Patient interaction: ${interactionType}`, 'info');
};

// Form submission tracking
export const trackFormSubmission = (
  formName: string,
  success: boolean,
  details: Record<string, unknown>
) => {
  setTag('form_name', formName);
  setTag('submission_success', success.toString());
  setContext('form_details', details);

  if (success) {
    captureMessage(`Form submitted successfully: ${formName}`, 'info');
  } else {
    captureMessage(`Form submission failed: ${formName}`, 'error');
  }
};

// API error tracking
export const trackApiError = (
  endpoint: string,
  error: Error,
  context: Record<string, unknown>
) => {
  setTag('endpoint', endpoint);
  setTag('error_type', 'api_error');
  setContext('api_context', context);

  captureException(error);
};

// Performance tracking for critical operations
export const trackCriticalOperation = (
  operation: string,
  duration: number,
  success: boolean
) => {
  setTag('operation', operation);
  setTag('operation_success', success.toString());
  setContext('performance', { duration_ms: duration });

  if (success) {
    captureMessage(`Critical operation completed: ${operation}`, 'info');
  } else {
    captureMessage(`Critical operation failed: ${operation}`, 'error');
  }
};

// User authentication tracking
export const trackUserLogin = (
  userId: string,
  method: string,
  success: boolean
) => {
  setUser({ id: userId, role: 'health_worker' });
  setTag('login_method', method);
  setTag('login_success', success.toString());

  if (success) {
    captureMessage(`User logged in successfully: ${userId}`, 'info');
  } else {
    captureMessage(`User login failed: ${userId}`, 'warning');
  }
};

// Data access tracking (for compliance)
export const trackDataAccess = (
  dataType: string,
  patientId: string,
  accessType: 'read' | 'write' | 'delete'
) => {
  setTag('data_type', dataType);
  setTag('patient_id', patientId);
  setTag('access_type', accessType);
  setTag('compliance_tracked', 'true');

  captureMessage(
    `Data access: ${accessType} ${dataType} for patient ${patientId}`,
    'info'
  );
};

// Error boundary error tracking
export const trackReactError = (
  error: Error,
  errorInfo: Record<string, unknown>,
  componentName: string
) => {
  setTag('error_source', 'react_component');
  setTag('component_name', componentName);
  setContext('react_error_info', errorInfo);

  captureException(error);
};
