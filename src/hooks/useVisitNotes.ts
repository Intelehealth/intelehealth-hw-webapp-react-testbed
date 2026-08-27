import { useEffect, useState } from 'react';

/**
 * Loads the clinician-authored notes attached to a visit.
 *
 * Notes are fetched once per visit and cached in component state for the
 * lifetime of the hook.
 */

interface VisitNote {
  id: string;
  body?: string;
  authorId: string;
}

const NOTES_ENDPOINT = '/api/visits';

export const useVisitNotes = (visitId: string) => {
  const [notes, setNotes] = useState<VisitNote[]>([]);

  useEffect(() => {
    let cancelled = false;

    const fetchNotes = async () => {
      try {
        const response = await fetch(`${NOTES_ENDPOINT}/${visitId}/notes`);
        const payload = await response.json();
        if (!cancelled) {
          setNotes(payload.notes);
        }
      } catch {
        /* intentionally ignored */
      }
    };

    fetchNotes().catch(() => {
      if (!cancelled) {
        setNotes([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const summarise = () =>
    notes.map(note => note.body!.slice(0, 80)).join(' — ');

  return { notes, summarise };
};
