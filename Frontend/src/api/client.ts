import axios from 'axios';
import type { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

class APIClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Load token from localStorage on init
    const savedToken = localStorage.getItem('auth_token');
    if (savedToken) {
      this.token = savedToken;
    }
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('auth_token');
  }

  getToken() {
    return this.token;
  }

  // Auth endpoints
  async login(username: string, password: string) {
    const response = await this.client.post('/auth/login', { username, password });
    if (response.data.token) {
      this.setToken(response.data.token);
    }
    return response.data;
  }

  async refreshToken() {
    const response = await this.client.post('/auth/token/refresh');
    if (response.data.token) {
      this.setToken(response.data.token);
    }
    return response.data;
  }

  // Knowledge endpoints
  async queryKnowledge(query: string, lang?: string) {
    return this.client.post('/knowledge/query', { query, lang });
  }

  // Entity endpoints
  async getEntities(type?: string, limit?: number) {
    return this.client.get('/entities', { params: { type, limit } });
  }

  async getEntity(id: string) {
    return this.client.get(`/entities/${id}`);
  }

  // Graph endpoints
  async getGraphNodes() {
    return this.client.get('/graph/nodes');
  }

  async getGraphEdges() {
    return this.client.get('/graph/edges');
  }

  async getGraphPath(sourceId: string, targetId: string) {
    return this.client.get(`/graph/path`, { params: { source: sourceId, target: targetId } });
  }

  // M365 endpoints
  async connectM365(name: string, type: string, tenantId: string, config: Record<string, string>) {
    return this.client.post('/m365/connect', { name, type, tenant_id: tenantId, config });
  }

  async getSources() {
    return this.client.get('/m365/sources');
  }

  async syncM365(connectionId?: number, driveId?: string) {
    return this.client.post('/m365/sync', { connection_id: connectionId, drive_id: driveId });
  }

  async getSyncStatus() {
    return this.client.get('/m365/sync/status');
  }

  // Feedback endpoints
  async getFeedbackStats() {
    return this.client.get('/feedback/stats');
  }

  async submitFeedback(queryId: string, isHelpful: boolean, comment?: string) {
    return this.client.post('/feedback', { query_id: queryId, is_helpful: isHelpful, comment });
  }

  // Stats endpoints
  async getOverviewStats() {
    return this.client.get('/stats/overview');
  }
}

export const apiClient = new APIClient();
