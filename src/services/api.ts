import { httpService } from './http';

// Basic API endpoints
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    PROFILE: '/auth/profile',
  },
  PATIENTS: {
    LIST: '/patients',
    CREATE: '/patients',
    GET: (id: string) => `/patients/${id}`,
    UPDATE: (id: string) => `/patients/${id}`,
    DELETE: (id: string) => `/patients/${id}`,
  },
  USERS: {
    LIST: '/users',
    CREATE: '/users',
    GET: (id: string) => `/users/${id}`,
    UPDATE: (id: string) => `/users/${id}`,
    DELETE: (id: string) => `/users/${id}`,
  },
} as const;

// Basic API functions
export const apiService = {
  // Auth
  login: (credentials: { email: string; password: string }) =>
    httpService.post(API_ENDPOINTS.AUTH.LOGIN, credentials),

  logout: () => httpService.post(API_ENDPOINTS.AUTH.LOGOUT),

  getProfile: () => httpService.get(API_ENDPOINTS.AUTH.PROFILE),

  // Patients
  getPatients: () => httpService.get(API_ENDPOINTS.PATIENTS.LIST),

  getPatient: (id: string) => httpService.get(API_ENDPOINTS.PATIENTS.GET(id)),

  createPatient: (data: unknown) =>
    httpService.post(API_ENDPOINTS.PATIENTS.CREATE, data),

  updatePatient: (id: string, data: unknown) =>
    httpService.put(API_ENDPOINTS.PATIENTS.UPDATE(id), data),

  deletePatient: (id: string) =>
    httpService.delete(API_ENDPOINTS.PATIENTS.DELETE(id)),

  // Users
  getUsers: () => httpService.get(API_ENDPOINTS.USERS.LIST),

  getUser: (id: string) => httpService.get(API_ENDPOINTS.USERS.GET(id)),

  createUser: (data: unknown) =>
    httpService.post(API_ENDPOINTS.USERS.CREATE, data),

  updateUser: (id: string, data: unknown) =>
    httpService.put(API_ENDPOINTS.USERS.UPDATE(id), data),

  deleteUser: (id: string) =>
    httpService.delete(API_ENDPOINTS.USERS.DELETE(id)),
};

export default apiService;
