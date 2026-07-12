import { useState } from 'react';
import { useEntities, useEntity } from '../hooks/useEntities';
import { useUIStore } from '../store/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { X } from 'lucide-react';

export const EntitiesPage = () => {
  const [typeFilter, setTypeFilter] = useState('');
  const { data: entities, isLoading } = useEntities(typeFilter || undefined, 100);
  const { selectedEntityId, setSelectedEntity, entityModalOpen, setEntityModalOpen } =
    useUIStore();
  const { data: selectedEntity } = useEntity(entityModalOpen ? selectedEntityId : null);

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Entities</h1>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <Input
            placeholder="Filter by entity type..."
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      {/* Entities List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <p className="text-gray-600">Loading entities...</p>
        ) : !entities?.data?.length ? (
          <p className="text-gray-600">No entities found</p>
        ) : (
          entities.data.map((entity: unknown) => {
            const ent = entity as Record<string, unknown>;
            return (
              <Card
                key={String(ent.id)}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => {
                  setSelectedEntity(String(ent.id));
                  setEntityModalOpen(true);
                }}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{String(ent.name)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600">
                    Type: <span className="font-semibold capitalize">{String(ent.type)}</span>
                  </p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Detail Modal */}
      {entityModalOpen && selectedEntity?.data && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{String(selectedEntity.data.name)}</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEntityModalOpen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Type</p>
                <p className="font-semibold">{String(selectedEntity.data.type)}</p>
              </div>
              {selectedEntity.data.description && (
                <div>
                  <p className="text-sm text-gray-600">Description</p>
                  <p>{String(selectedEntity.data.description)}</p>
                </div>
              )}
              {selectedEntity.data.relationships?.length > 0 && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Relationships</p>
                  <ul className="space-y-1">
                    {(selectedEntity.data.relationships as unknown[]).map((rel: unknown, idx: number) => (
                      <li key={idx} className="text-sm">
                        {String((rel as Record<string, unknown>).type)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
