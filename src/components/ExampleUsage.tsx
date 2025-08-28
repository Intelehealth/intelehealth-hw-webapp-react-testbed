import React, { useState } from 'react';
import { useHttp } from '../hooks/useHttp';
import { apiService } from '../services/api';

// Define proper types
interface User {
  id: string;
  name: string;
  email: string;
}

interface Patient {
  id: string;
  name: string;
  email?: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

// Example component showing different ways to use the HTTP service
export const ExampleUsage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Using the general useHttp hook
  const {
    post,
    loading: loginLoading,
    error: loginError,
    reset,
  } = useHttp<LoginResponse>();

  // Using the general useHttp hook for patients
  const {
    get: getPatients,
    data: patients,
    loading: patientsLoading,
    error: patientsError,
  } = useHttp<Patient[]>();

  // Example login function
  const handleLogin = async () => {
    const response = await post('/auth/login', { email, password });
    if (response) {
      // Login successful - could store token, redirect, etc.
      reset(); // Clear loading and error states
    }
  };

  // Example using the API service directly
  const handleLogout = async () => {
    try {
      await apiService.logout();
      // Logout successful - could clear storage, redirect, etc.
    } catch {
      // Handle logout error
    }
  };

  // Example fetch patients
  const handleFetchPatients = async () => {
    await getPatients('/patients');
  };

  return (
    <div className="example-usage">
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

      {/* Patients Section */}
      <div className="patients-section">
        <h3>Patients Example</h3>
        <button onClick={handleFetchPatients} disabled={patientsLoading}>
          {patientsLoading ? 'Fetching...' : 'Fetch Patients'}
        </button>
        {patientsError && <p className="error">Error: {patientsError}</p>}
        {patients && (
          <div>
            <h4>Patients ({patients.length})</h4>
            <ul>
              {patients.map((patient: Patient, index: number) => (
                <li key={index}>{patient.name || `Patient ${index + 1}`}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Logout */}
      <div className="logout-section">
        <h3>Logout Example</h3>
        <button onClick={handleLogout}>Logout</button>
      </div>

      {/* API Service Examples */}
      <div className="api-service-examples">
        <h3>API Service Examples</h3>
        <button onClick={() => apiService.getPatients()}>
          Get Patients via API Service
        </button>
        <button onClick={() => apiService.getUsers()}>
          Get Users via API Service
        </button>
      </div>
    </div>
  );
};
