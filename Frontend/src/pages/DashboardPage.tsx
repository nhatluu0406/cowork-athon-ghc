import { useOverviewStats } from '../hooks/useKnowledge';
import { useSources, useSyncStatus } from '../hooks/useM365';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { FileText, GitBranch, Users, Zap } from 'lucide-react';

export const DashboardPage = () => {
  const { data: stats, isLoading: statsLoading } = useOverviewStats();
  const { data: syncStatus, isLoading: syncLoading } = useSyncStatus();
  const { data: sources } = useSources();

  const statsData = (stats as any)?.data || {};

  const statItems = [
    {
      label: 'Total Documents',
      value: statsData.total_documents ?? 0,
      icon: FileText,
    },
    {
      label: 'Entities',
      value: statsData.total_entities ?? 0,
      icon: Users,
    },
    {
      label: 'Relationships',
      value: statsData.total_relationships ?? 0,
      icon: GitBranch,
    },
    {
      label: 'Avg Query Time',
      value: `${statsData.avg_query_latency_ms ?? 0}ms`,
      icon: Zap,
    },
  ];

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statItems.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">{item.label}</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {statsLoading ? '...' : item.value}
                    </p>
                  </div>
                  <Icon className="w-10 h-10 text-blue-500 opacity-20" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sync Status */}
        <Card>
          <CardHeader>
            <CardTitle>Sync Status</CardTitle>
          </CardHeader>
          <CardContent>
            {syncLoading ? (
              <p className="text-gray-600">Loading...</p>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Status</span>
                  <span className="font-semibold capitalize">{(syncStatus as any)?.data?.status ?? 'idle'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Last Sync</span>
                  <span className="text-sm">
                    {(syncStatus as any)?.data?.last_sync_at
                      ? new Date((syncStatus as any).data.last_sync_at).toLocaleString()
                      : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Items Processed</span>
                  <span className="font-semibold">{(syncStatus as any)?.data?.items_processed ?? 0}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Connected Sources */}
        <Card>
          <CardHeader>
            <CardTitle>Connected Sources</CardTitle>
          </CardHeader>
          <CardContent>
            {!(sources as any)?.data?.length ? (
              <p className="text-gray-600">No sources connected</p>
            ) : (
              <ul className="space-y-2">
                {(sources as any)?.data?.slice(0, 5).map((source: unknown) => {
                  const src = source as Record<string, unknown>;
                  return (
                    <li key={String(src.id)} className="flex justify-between items-center text-sm">
                      <span>{String(src.name)}</span>
                      <span className="text-gray-500 text-xs capitalize">
                        {String(src.type)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
