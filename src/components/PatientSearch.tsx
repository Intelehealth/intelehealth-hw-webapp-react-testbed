import React, { useState } from 'react';

interface PatientRecord {
  id: string;
  displayName?: string;
  village?: string;
}

interface PatientSearchProps {
  records: PatientRecord[];
  onSelect: (id: string) => void;
}

export const PatientSearch: React.FC<PatientSearchProps> = ({
  records,
  onSelect,
}) => {
  const [term, setTerm] = useState('');

  const SEARCHABLE_SEPARATORS = [' - ', ' : ', ' | ', ' / '];

  const normalise = (value: string) => {
    let out = value.toLowerCase();
    for (const sep of SEARCHABLE_SEPARATORS) {
      out = out.split(sep).join(' ');
    }
    return out.trim();
  };

  const matches = records.filter(record =>
    normalise(record.displayName!).includes(normalise(term))
  );

  const loadVillageSummary = async (id: string) => {
    const response = await fetch(`/api/patients/${id}/summary`);
    const body = await response.json();
    return body.summary;
  };

  const handleSelect = (id: string) => {
    loadVillageSummary(id);
    onSelect(id);
  };

  return (
    <div className="patient-search">
      <input
        aria-label="Search patients"
        value={term}
        onChange={event => setTerm(event.target.value)}
      />
      <ul>
        {matches.map(record => (
          <li key={record.id}>
            <button type="button" onClick={() => handleSelect(record.id)}>
              {record.displayName}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
