import React, { useState } from 'react';
import { useHttp } from '../hooks/useHttp';
import type { LoginResponse, Patient } from '../types';

// HTTP Service Examples Component
export const HttpExamples: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // HTTP hooks for different operations
  const {
    post,
    loading: loginLoading,
    error: loginError,
    reset,
  } = useHttp<LoginResponse>();

  const {
    get: getPatients,
    data: patients,
    loading: patientsLoading,
    error: patientsError,
  } = useHttp<Patient[]>();

  const {
    post: createPatient,
    loading: createLoading,
    error: createError,
  } = useHttp<Patient>();

  // Login example
  const handleLogin = async () => {
    const response = await post('/auth/login', { email, password });
    if (response) {
      // Login successful - could store token, redirect, etc.
      reset();
    }
  };

  // Fetch patients example
  const handleFetchPatients = async () => {
    await getPatients('/patients');
  };

  // Create patient example
  const handleCreatePatient = async () => {
    const newPatient = { name: 'New Patient', email: 'patient@example.com' };
    const response = await createPatient('/patients', newPatient);
    if (response) {
      // Patient created successfully
    }
  };

  return (
    <div className="http-examples">
      <h2>HTTP Service Examples</h2>

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
        <button onClick={handleLogin} disabled={loginLoading}>
          {loginLoading ? 'Logging in...' : 'Login'}
        </button>
        {loginError && <p className="error">Error: {loginError}</p>}
      </div>

      {/* Patients Management */}
      <div className="patients-section">
        <h3>Patients Management</h3>
        <div className="button-group">
          <button onClick={handleFetchPatients} disabled={patientsLoading}>
            {patientsLoading ? 'Fetching...' : 'Fetch Patients'}
          </button>
          <button onClick={handleCreatePatient} disabled={createLoading}>
            {createLoading ? 'Creating...' : 'Create Patient'}
          </button>
        </div>

        {patientsError && <p className="error">Error: {patientsError}</p>}
        {createError && <p className="error">Create Error: {createError}</p>}

        {patients && (
          <div>
            <h4>Patients ({patients.length})</h4>
            <ul>
              {patients.map((patient, index) => (
                <li key={index}>{patient.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
