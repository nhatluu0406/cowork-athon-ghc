import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export const useEntities = (type?: string, limit?: number) => {
  return useQuery({
    queryKey: ['entities', { type, limit }],
    queryFn: () => apiClient.getEntities(type, limit),
  });
};

export const useEntity = (id: string | null) => {
  return useQuery({
    queryKey: ['entity', id],
    queryFn: () => (id ? apiClient.getEntity(id) : null),
    enabled: !!id,
  });
};
