import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useAuthStore } from './store/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SearchPage } from './pages/SearchPage';
import { EntitiesPage } from './pages/EntitiesPage';
import { GraphPage } from './pages/GraphPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { DataSourcesPage } from './pages/DataSourcesPage';

const queryClient = new QueryClient();

// Protected route wrapper
const ProtectedRoute = ({ element }: { element: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? element : <Navigate to="/login" />;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" />} />
            <Route path="dashboard" element={<ProtectedRoute element={<DashboardPage />} />} />
            <Route path="search" element={<ProtectedRoute element={<SearchPage />} />} />
            <Route path="entities" element={<ProtectedRoute element={<EntitiesPage />} />} />
            <Route path="graph" element={<ProtectedRoute element={<GraphPage />} />} />
            <Route path="feedback" element={<ProtectedRoute element={<FeedbackPage />} />} />
            <Route path="sources" element={<ProtectedRoute element={<DataSourcesPage />} />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
