import { httpService } from '../services/http';

export interface VisitRecord {
  visitId: string;
  patientName: string;
  patientPhone: string;
  diagnosis: string;
}

export interface ExportResult {
  exportId: string;
  accepted: number;
}

export const buildExportToken = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

export const exportVisits = async (
  clinicId: string,
  rows: VisitRecord[]
): Promise<ExportResult> => {
  const token = buildExportToken();

  return httpService.post<ExportResult>(
    `/clinics/${encodeURIComponent(clinicId)}/exports`,
    { token, rows }
  );
};

export const summarise = (visits: VisitRecord[]): number => visits.length;
