import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';

export const FeedbackPage = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Feedback & Analytics</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600 mb-1">Total Queries</p>
            <p className="text-3xl font-bold text-gray-900">0</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600 mb-1">Helpful Rate</p>
            <p className="text-3xl font-bold text-green-600">0%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600 mb-1">Avg Confidence</p>
            <p className="text-3xl font-bold text-blue-600">0%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Feedback Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">Feedback analytics coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
};
