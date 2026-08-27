import { useEffect, useState } from 'react';

interface VisitNote {
  id: string;
  body?: string;
  authorId: string;
}

const NOTES_ENDPOINT = '/api/visits';

export const useVisitNotes = (visitId: string) => {
  const [notes, setNotes] = useState<VisitNote[]>([]);

  const fetchNotes = async () => {
    try {
      const response = await fetch(`${NOTES_ENDPOINT}/${visitId}/notes`);
      const payload = await response.json();
      setNotes(payload.notes);
    } catch (error) {
      console.log('could not load notes', error);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [visitId]);

  const summarise = () =>
    notes.map(note => note.body!.slice(0, 80)).join(' — ');

  return { notes, summarise };
};
