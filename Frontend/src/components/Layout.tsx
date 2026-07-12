import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useUIStore } from '../store/ui';
import { Button } from './ui/Button';
import { Menu, X, LogOut, Home, Search, Users, GitBranch, BarChart3, Settings } from 'lucide-react';

export const Layout = () => {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!isAuthenticated) {
    return <Outlet />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } transition-all duration-300 overflow-hidden bg-gray-900 text-white flex flex-col`}
      >
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-xl font-bold">M365 Knowledge</h1>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <SidebarLink to="/dashboard" icon={Home} label="Dashboard" />
          <SidebarLink to="/search" icon={Search} label="Search" />
          <SidebarLink to="/entities" icon={Users} label="Entities" />
          <SidebarLink to="/graph" icon={GitBranch} label="Graph" />
          <SidebarLink to="/feedback" icon={BarChart3} label="Feedback" />
          <SidebarLink to="/sources" icon={Settings} label="Data Sources" />
        </nav>
        <div className="p-4 border-t border-gray-700">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-left"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="p-0"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

interface SidebarLinkProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const SidebarLink = ({ to, icon: Icon, label }: SidebarLinkProps) => (
  <Link
    to={to}
    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
  >
    <Icon className="w-5 h-5" />
    {label}
  </Link>
);
