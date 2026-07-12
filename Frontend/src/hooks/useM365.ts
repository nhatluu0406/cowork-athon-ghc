import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export const useSources = () => {
  return useQuery({
    queryKey: ['m365', 'sources'],
    queryFn: () => apiClient.getSources(),
  });
};

export const useSync = () => {
  return useMutation({
    mutationFn: (params: { connectionId?: number; driveId?: string }) =>
      apiClient.syncM365(params.connectionId, params.driveId),
  });
};

export const useSyncStatus = () => {
  return useQuery({
    queryKey: ['m365', 'sync', 'status'],
    queryFn: () => apiClient.getSyncStatus(),
    refetchInterval: 5000, // Poll every 5 seconds
  });
};

export const useConnect = () => {
  return useMutation({
    mutationFn: (params: {
      name: string;
      type: string;
      tenantId: string;
      config: Record<string, string>;
    }) =>
      apiClient.connectM365(params.name, params.type, params.tenantId, params.config),
  });
};
