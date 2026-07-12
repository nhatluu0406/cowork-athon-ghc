import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import { Card } from '../components/ui/Card';

export const GraphPage = () => {
  // Placeholder - will be enhanced with real graph visualization
  const nodes: never[] = [];
  const edges: never[] = [];

  return (
    <div className="p-6 h-full">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Knowledge Graph</h1>
      <Card className="h-96">
        <ReactFlow nodes={nodes} edges={edges}>
          <Background />
          <Controls />
        </ReactFlow>
      </Card>
      <p className="text-gray-600 text-sm mt-4">Interactive entity relationship visualization</p>
    </div>
  );
};
