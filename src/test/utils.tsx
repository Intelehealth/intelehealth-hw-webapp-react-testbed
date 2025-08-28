import type { RenderOptions } from '@testing-library/react';
import { render } from '@testing-library/react';
import React, { type ReactElement } from 'react';

// Add any providers here if needed
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

// Mock data for testing
export const mockUser = {
  id: '1',
  email: 'test@example.com',
  username: 'testuser',
  role: 'health_worker' as const,
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockPatient = {
  id: '1',
  patientId: 'P001',
  firstName: 'John',
  lastName: 'Doe',
  dateOfBirth: new Date('1990-01-01'),
  gender: 'male' as const,
  phoneNumber: '+1234567890',
  email: 'john.doe@example.com',
  address: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zipCode: '12345',
    country: 'USA',
  },
  emergencyContact: {
    name: 'Jane Doe',
    relationship: 'Spouse',
    phoneNumber: '+1234567891',
    email: 'jane.doe@example.com',
  },
  medicalHistory: [],
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockApiResponse = {
  success: true,
  data: mockPatient,
  message: 'Success',
  timestamp: new Date(),
};

export const mockErrorResponse = {
  success: false,
  error: 'Something went wrong',
  message: 'Error occurred',
  timestamp: new Date(),
};

export * from '@testing-library/react';
export { customRender as render };
