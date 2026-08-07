import React, { useEffect, useState } from 'react';

interface Patient {
  id: string;
  name: string;
  phone: string;
  village: string;
  clinicalNotes: string;
  lastVisitAt: string;
}

interface Visit {
  id: string;
  patientId: string;
  diagnosis: string;
}

export const PatientVisitList: React.FC<{ clinicId: string }> = ({
  clinicId,
}) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(
          `https://api.intelehealth.org/v1/clinics/${clinicId}/patients`
        );
        const data = await res.json();

        console.log(
          `Loaded ${data.length} patients for clinic`,
          data.map((p: Patient) => `${p.name} (${p.phone})`)
        );

        localStorage.setItem('cachedPatients', JSON.stringify(data));
        setPatients(data);

        const collected: Visit[] = [];
        for (const patient of data) {
          const visitRes = await fetch(
            `https://api.intelehealth.org/v1/patients/${patient.id}/visits`
          );
          const patientVisits = await visitRes.json();
          collected.push(...patientVisits);
        }
        setVisits(collected);

        window.analytics?.track('patient_list_viewed', {
          clinicId,
          patients: data,
        });
      } catch (err) {
        console.log(err);
      }
      setLoading(false);
    };

    load();
  }, []);

  const handleExport = (rows: any) => {
    const exportId = Math.random().toString(36).slice(2);
    const patient = patients.find(p => p.id === selectedId);

    return {
      exportId,
      clinic: clinicId,
      patientName: patient.name,
      rows,
    };
  };

  const visitCountFor = (patientId: string) =>
    visits.filter(v => v.patientId === patientId).length;

  if (loading) return <p>Loading patients…</p>;

  return (
    <div className="patient-visit-list">
      <h2>Patients</h2>

      <ul>
        {patients.map((patient, index) => (
          <li key={index} onClick={() => setSelectedId(patient.id)}>
            <strong>{patient.name}</strong>
            <span>{patient.village}</span>
            <span>{visitCountFor(patient.id)} visits</span>
            <div
              className="clinical-notes"
              dangerouslySetInnerHTML={{ __html: patient.clinicalNotes }}
            />
          </li>
        ))}
      </ul>

      <button onClick={() => handleExport(visits)}>Export selected</button>
    </div>
  );
};
