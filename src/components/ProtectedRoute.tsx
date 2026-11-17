import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="dashboard-layout flex min-h-dvh items-center justify-center p-6">
        <div role="status" aria-live="polite" className="dashboard-card flex items-center gap-3 rounded-2xl px-5 py-4">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#72884c] border-r-transparent" />
          <span className="text-sm font-medium text-foreground">Vérification de la session…</span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return children;
};
