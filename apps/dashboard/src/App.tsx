import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/useAuth";
import Login from "./pages/Login";
import Sites from "./pages/Sites";
import SiteLayout from "./pages/SiteLayout";
import Inbox from "./pages/Inbox";
import Visitors from "./pages/Visitors";
import Settings from "./pages/Settings";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Sites />
          </RequireAuth>
        }
      />
      <Route
        path="/sites/:siteId"
        element={
          <RequireAuth>
            <SiteLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="inbox" replace />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="visitors" element={<Visitors />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
