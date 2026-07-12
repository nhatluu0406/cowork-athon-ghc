import { useState } from 'react';
import { useSources, useSync, useSyncStatus, useConnect } from '../hooks/useM365';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { RefreshCw, Plus } from 'lucide-react';

export const DataSourcesPage = () => {
  const { data: sources, refetch: refetchSources } = useSources();
  const { mutate: sync, isPending: syncing } = useSync();
  const { data: syncStatus } = useSyncStatus();
  const { mutate: connect } = useConnect();

  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'onedrive',
    tenantId: '',
  });

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    connect(
      {
        ...formData,
        config: {},
      },
      {
        onSuccess: () => {
          setFormData({ name: '', type: 'onedrive', tenantId: '' });
          setShowAddForm(false);
          refetchSources();
        },
      }
    );
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Data Sources</h1>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Source
        </Button>
      </div>

      {/* Add Source Form */}
      {showAddForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Add Data Source</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddSource} className="space-y-4">
              <div>
                <Label htmlFor="name">Source Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="My OneDrive"
                  required
                />
              </div>

              <div>
                <Label htmlFor="type">Source Type</Label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({ ...formData, type: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="onedrive">OneDrive</option>
                  <option value="teams">Teams</option>
                </select>
              </div>

              <div>
                <Label htmlFor="tenantId">Tenant ID</Label>
                <Input
                  id="tenantId"
                  value={formData.tenantId}
                  onChange={(e) =>
                    setFormData({ ...formData, tenantId: e.target.value })
                  }
                  placeholder="Your Azure Tenant ID"
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit">Add</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Sync Status */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Sync Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-600">Current Status</p>
              <p className="text-lg font-semibold capitalize">
                {syncStatus?.status ?? 'idle'}
              </p>
            </div>
            <Button
              onClick={() => sync({})}
              disabled={syncing}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Connected Sources */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Connected Sources
        </h2>
        {!sources?.data?.length ? (
          <p className="text-gray-600">No sources connected</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(sources as any)?.data?.map((source: unknown) => {
              const src = source as Record<string, unknown>;
              return (
                <Card key={String(src.id)}>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-600">Name</p>
                        <p className="font-semibold">{String(src.name)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Type</p>
                        <p className="font-semibold capitalize">{String(src.type)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Status</p>
                        <p className="font-semibold">{String(src.status)}</p>
                      </div>
                      {src.last_sync_at ? (
                        <div>
                          <p className="text-sm text-gray-600">Last Sync</p>
                          <p className="text-sm">
                            {new Date(String(src.last_sync_at)).toLocaleString()}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            }) as React.ReactNode}
          </div>
        )}
      </div>
    </div>
  );
};
