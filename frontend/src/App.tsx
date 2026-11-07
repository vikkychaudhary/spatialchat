import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { Spinner } from "./components/ui";
import AppShell from "./components/AppShell";
import { useViewportHeight } from "./lib/useViewportHeight";
import { ForgotPage, LoginPage, RegisterPage, ResetPage } from "./pages/AuthPages";
import ChatsPage from "./pages/ChatsPage";
import ContactsPage from "./pages/ContactsPage";
import SettingsPage from "./pages/SettingsPage";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading SpatialChat" />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading SpatialChat" />;
  return user ? <Navigate to="/chats" replace /> : <Outlet />;
}

export default function App() {
  useViewportHeight();
  return (
    <>
      <div className="ambient" aria-hidden />
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route path="/forgot-password" element={<ForgotPage />} />
        <Route path="/reset-password" element={<ResetPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/chats" element={<ChatsPage />} />
            <Route path="/chats/:id" element={<ChatsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/chats" replace />} />
      </Routes>
    </>
  );
}
