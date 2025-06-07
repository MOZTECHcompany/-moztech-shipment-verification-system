// src/App.jsx
import { Toaster } from 'sonner';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

export default function App() {
  const [user, setUser] = useLocalStorage("user", null);

  const handleLogin = (userId, role) => {
    if (userId && role) {
      setUser({ id: userId, role });
    }
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Toaster richColors position="top-right" />
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </div>
  );
}