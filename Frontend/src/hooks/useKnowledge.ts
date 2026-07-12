import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export interface QueryResult {
  answer: string;
  sources: Array<{
    file_id: number;
    file_name: string;
    chunk_text: string;
    relevance_score: number;
  }>;
  entities: Array<{
    id: string;
    type: string;
    name: string;
    confidence: number;
  }>;
  intent: string;
  latency_ms: number;
}

export const useKnowledgeQuery = () => {
  return useMutation({
    mutationFn: (query: string) => apiClient.queryKnowledge(query),
  });
};

export const useOverviewStats = () => {
  return useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.getOverviewStats(),
  });
};
