import { useState } from 'react';
import { useKnowledgeQuery } from '../hooks/useKnowledge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Search, ThumbsUp, ThumbsDown, Link as LinkIcon } from 'lucide-react';

export const SearchPage = () => {
  const [query, setQuery] = useState('');
  const { mutate: search, data: result, isPending } = useKnowledgeQuery();
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      search(query);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Knowledge Search</h1>

      {/* Search Input */}
      <Card className="mb-8">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              placeholder="Ask a question about your organization..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isPending}
              className="flex-1"
            />
            <Button type="submit" disabled={isPending || !query.trim()}>
              <Search className="w-4 h-4 mr-2" />
              {isPending ? 'Searching...' : 'Search'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results */}
      {(result as any)?.data && (
        <div className="space-y-6">
          {/* Answer */}
          <Card>
            <CardHeader>
              <CardTitle>Answer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 leading-relaxed mb-4">{(result as any).data.answer}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={feedback[query] === true ? 'default' : 'outline'}
                  onClick={() => setFeedback({ ...feedback, [query]: true })}
                >
                  <ThumbsUp className="w-4 h-4 mr-1" />
                  Helpful
                </Button>
                <Button
                  size="sm"
                  variant={feedback[query] === false ? 'destructive' : 'outline'}
                  onClick={() => setFeedback({ ...feedback, [query]: false })}
                >
                  <ThumbsDown className="w-4 h-4 mr-1" />
                  Not Helpful
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Intent & Latency */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-600 mb-1">Detected Intent</p>
                <p className="text-lg font-semibold capitalize">{(result as any).data.intent}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-600 mb-1">Query Time</p>
                <p className="text-lg font-semibold">{(result as any).data.latency_ms}ms</p>
              </CardContent>
            </Card>
          </div>

          {/* Sources */}
          {(result as any).data.sources?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {(result as any).data.sources.map((source: unknown, idx: number) => {
                    const src = source as Record<string, unknown>;
                    return (
                      <li key={idx} className="border-b border-gray-200 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-start gap-3">
                          <LinkIcon className="w-4 h-4 text-blue-500 mt-1 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{String(src.file_name)}</p>
                            <p className="text-sm text-gray-600 mt-1">{String(src.chunk_text)}</p>
                            <div className="flex gap-4 mt-2">
                              <span className="text-xs text-gray-500">
                                Relevance: {(Number(src.relevance_score) * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Entities */}
          {(result as any).data.entities?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Mentioned Entities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(result as any).data.entities.map((entity: unknown, idx: number) => {
                    const ent = entity as Record<string, unknown>;
                    return (
                      <span
                        key={idx}
                        className="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
                      >
                        {String(ent.name)}
                        <span className="text-xs ml-1 opacity-70">
                          ({String(ent.type)})
                        </span>
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
