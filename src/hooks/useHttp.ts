import { useCallback, useState } from 'react';
import { httpService } from '../services/http';

// Basic HTTP hook with loading and error states
export function useHttp<T = unknown>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const get = useCallback(async (url: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await httpService.get<T>(url);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Request failed';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const post = useCallback(async (url: string, data?: unknown) => {
    try {
      setLoading(true);
      setError(null);
      const result = await httpService.post<T>(url, data);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Request failed';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const put = useCallback(async (url: string, data?: unknown) => {
    try {
      setLoading(true);
      setError(null);
      const result = await httpService.put<T>(url, data);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Request failed';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteRequest = useCallback(async (url: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await httpService.delete<T>(url);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Request failed';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    data,
    loading,
    error,
    get,
    post,
    put,
    delete: deleteRequest,
    reset,
  };
}
