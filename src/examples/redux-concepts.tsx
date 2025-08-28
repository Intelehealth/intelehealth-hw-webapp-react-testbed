import React, { useReducer, useState } from 'react';
import type { User, Patient } from '../types';
import { authReducer, patientReducer } from '../reducers';

// Redux Concepts Component
export const ReduxConcepts: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [patientName, setPatientName] = useState('');

  // Redux-like state management
  const [authState, authDispatch] = useReducer(authReducer, {
    user: null,
    isAuthenticated: false,
    loading: false,
    error: null,
  });

  const [patientsState, patientsDispatch] = useReducer(patientReducer, {
    patients: [],
    currentPatient: null,
    loading: false,
    error: null,
    totalCount: 0,
  });

  // Auth actions
  const handleLogin = () => {
    authDispatch({ type: 'LOGIN_START' });

    // Simulate API call
    setTimeout(() => {
      const mockUser: User = {
        id: '1',
        name: email.split('@')[0],
        email: email,
        role: 'user',
      };
      authDispatch({ type: 'LOGIN_SUCCESS', payload: { user: mockUser, token: 'mock-token' } });
    }, 1000);
  };

  const handleLogout = () => {
    authDispatch({ type: 'LOGOUT' });
  };

  const handleClearAuthError = () => {
    authDispatch({ type: 'CLEAR_ERROR' });
  };

  // Patients actions
  const handleFetchPatients = () => {
    patientsDispatch({ type: 'FETCH_START' });

    // Simulate API call
    setTimeout(() => {
      const mockPatients: Patient[] = [
        { id: '1', name: 'John Doe', email: 'john@example.com' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
      ];
      patientsDispatch({ type: 'FETCH_SUCCESS', payload: mockPatients });
    }, 1000);
  };

  const handleAddPatient = () => {
    if (patientName.trim()) {
      const newPatient: Patient = {
        id: Date.now().toString(),
        name: patientName,
        email: `${patientName.toLowerCase()}@example.com`,
      };
      patientsDispatch({ type: 'ADD_PATIENT', payload: newPatient });
      setPatientName('');
    }
  };

  const handleUpdatePatient = (id: string) => {
    patientsDispatch({
      type: 'UPDATE_PATIENT',
      payload: { id, data: { name: `Updated ${patientName}` } },
    });
  };

  const handleDeletePatient = (id: string) => {
    patientsDispatch({ type: 'DELETE_PATIENT', payload: id });
  };

  const handleClearPatientsError = () => {
    patientsDispatch({ type: 'CLEAR_ERROR' });
  };

  return (
    <div className="redux-concepts">
      <h2>Redux Concepts Examples</h2>

      {/* Auth Status */}
      <div className="auth-status">
        <h3>Authentication State</h3>
        <p>Authenticated: {authState.isAuthenticated ? 'Yes' : 'No'}</p>
        {authState.user && (
          <div>
            <p>
              User: {authState.user.name} ({authState.user.email})
            </p>
            <p>Role: {authState.user.role}</p>
          </div>
        )}
        {authState.error && (
          <div>
            <p className="error">Error: {authState.error}</p>
            <button onClick={handleClearAuthError}>Clear Error</button>
          </div>
        )}
      </div>

      {/* Login Form */}
      <div className="login-section">
        <h3>Login Example</h3>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <div className="button-group">
          <button onClick={handleLogin} disabled={authState.loading}>
            {authState.loading ? 'Logging in...' : 'Login'}
          </button>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* Patients Management */}
      <div className="patients-section">
        <h3>Patients Management</h3>

        <div className="patient-form">
          <input
            type="text"
            placeholder="Patient Name"
            value={patientName}
            onChange={e => setPatientName(e.target.value)}
          />
          <button onClick={handleAddPatient}>Add Patient</button>
        </div>

        <div className="patient-actions">
          <button
            onClick={handleFetchPatients}
            disabled={patientsState.loading}
          >
            {patientsState.loading ? 'Fetching...' : 'Fetch Patients'}
          </button>
        </div>

        {patientsState.error && (
          <div>
            <p className="error">Error: {patientsState.error}</p>
            <button onClick={handleClearPatientsError}>Clear Error</button>
          </div>
        )}

        {patientsState.patients.length > 0 && (
          <div className="patients-list">
            <h4>Patients ({patientsState.patients.length})</h4>
            <ul>
              {patientsState.patients.map(patient => (
                <li key={patient.id}>
                  <span>{patient.name}</span>
                  <div className="patient-actions">
                    <button onClick={() => handleUpdatePatient(patient.id)}>
                      Update
                    </button>
                    <button onClick={() => handleDeletePatient(patient.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
