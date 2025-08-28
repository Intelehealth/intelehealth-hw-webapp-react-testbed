import React, { useState } from 'react';
import { apiService } from '../services/api';

// API Service Examples Component
export const ApiExamples: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [results, setResults] = useState<string>('');

  // Login example using API service
  const handleLogin = async () => {
    try {
      const response = await apiService.login({ email, password });
      setResults(`Login successful: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setResults(
        `Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  // Logout example
  const handleLogout = async () => {
    try {
      await apiService.logout();
      setResults('Logout successful');
    } catch (error) {
      setResults(
        `Logout failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  // Get profile example
  const handleGetProfile = async () => {
    try {
      const response = await apiService.getProfile();
      setResults(`Profile: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setResults(
        `Get profile failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  // Patients management examples
  const handleGetPatients = async () => {
    try {
      const response = await apiService.getPatients();
      setResults(`Patients: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setResults(
        `Get patients failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const handleCreatePatient = async () => {
    if (!patientName.trim()) {
      setResults('Please enter a patient name');
      return;
    }

    try {
      const patientData = {
        name: patientName,
        email: patientEmail || undefined,
      };
      const response = await apiService.createPatient(patientData);
      setResults(`Patient created: ${JSON.stringify(response, null, 2)}`);
      setPatientName('');
      setPatientEmail('');
    } catch (error) {
      setResults(
        `Create patient failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const handleUpdatePatient = async (id: string) => {
    try {
      const updateData = { name: `Updated ${patientName}` };
      const response = await apiService.updatePatient(id, updateData);
      setResults(`Patient updated: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setResults(
        `Update patient failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const handleDeletePatient = async (id: string) => {
    try {
      await apiService.deletePatient(id);
      setResults(`Patient ${id} deleted successfully`);
    } catch (error) {
      setResults(
        `Delete patient failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  // Users management examples
  const handleGetUsers = async () => {
    try {
      const response = await apiService.getUsers();
      setResults(`Users: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setResults(
        `Get users failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const handleCreateUser = async () => {
    try {
      const userData = { name: patientName, email: patientEmail };
      const response = await apiService.createUser(userData);
      setResults(`User created: ${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setResults(
        `Create user failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  return (
    <div className="api-examples">
      <h2>API Service Examples</h2>

      {/* Authentication */}
      <div className="auth-section">
        <h3>Authentication</h3>
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
          <button onClick={handleLogin}>Login</button>
          <button onClick={handleLogout}>Logout</button>
          <button onClick={handleGetProfile}>Get Profile</button>
        </div>
      </div>

      {/* Patients Management */}
      <div className="patients-section">
        <h3>Patients Management</h3>
        <input
          type="text"
          placeholder="Patient Name"
          value={patientName}
          onChange={e => setPatientName(e.target.value)}
        />
        <input
          type="email"
          placeholder="Patient Email (optional)"
          value={patientEmail}
          onChange={e => setPatientEmail(e.target.value)}
        />
        <div className="button-group">
          <button onClick={handleGetPatients}>Get Patients</button>
          <button onClick={handleCreatePatient}>Create Patient</button>
          <button onClick={() => handleUpdatePatient('1')}>
            Update Patient 1
          </button>
          <button onClick={() => handleDeletePatient('1')}>
            Delete Patient 1
          </button>
        </div>
      </div>

      {/* Users Management */}
      <div className="users-section">
        <h3>Users Management</h3>
        <div className="button-group">
          <button onClick={handleGetUsers}>Get Users</button>
          <button onClick={handleCreateUser}>Create User</button>
        </div>
      </div>

      {/* Results Display */}
      <div className="results-section">
        <h3>API Results</h3>
        {results && <pre className="results-display">{results}</pre>}
      </div>
    </div>
  );
};
