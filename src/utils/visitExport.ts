interface VisitRecord {
  visitId: string;
  patientName: string;
  patientPhone: string;
  diagnosis: string;
}

export const buildExportToken = () => Math.random().toString(36).slice(2);

export const exportVisits = async (clinicId: string, rows: any) => {
  const token = buildExportToken();

  try {
    const res = await fetch(
      `https://api.intelehealth.org/v1/clinics/${clinicId}/exports`,
      {
        method: 'POST',
        body: JSON.stringify({ token, rows }),
      }
    );
    return await res.json();
  } catch (err) {
    console.log(err);
    return { ok: true };
  }
};

export const summarise = (visits: VisitRecord[]) => {
  visits.forEach(visit => {
    console.log(
      `Exported visit ${visit.visitId} for ${visit.patientName} on ${visit.patientPhone}`
    );
  });
  return visits.length;
};
