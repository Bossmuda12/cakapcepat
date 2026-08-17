import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import OAuthCallback from "./pages/OAuthCallback";
import Bootstrap from "./pages/Bootstrap";
import Overview from "./pages/Overview";
import Monitor from "./pages/Monitor";
import Settings from "./pages/Settings";
import Departments from "./pages/Departments";
import Products from "./pages/Products";
import Channels from "./pages/Channels";
import Contacts from "./pages/Contacts";
import Conversations from "./pages/Conversations";
import Broadcasts from "./pages/Broadcasts";
import Team from "./pages/Team";
import Ctwa from "./pages/Ctwa";
import Leads from "./pages/Leads";
import Automations from "./pages/Automations";
import KnowledgeBase from "./pages/KnowledgeBase";

function Gate({ children }) {
  const { user, loading, needsBootstrap } = useAuth();

  if (loading) return <div className="loading-block">Memuat...</div>;
  if (needsBootstrap) return <Bootstrap />;
  if (!user) return <Login />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Halaman publik — bisa diakses tanpa login */}
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/oauth-callback" element={<OAuthCallback />} />

      {/* Semua rute lain butuh sesi (atau nampilin Login/Bootstrap kalau belum) */}
      <Route
        path="/*"
        element={
          <Gate>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Overview />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/conversations" element={<Conversations />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/broadcasts" element={<Broadcasts />} />
                <Route path="/ctwa" element={<Ctwa />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/automations" element={<Automations />} />
                <Route path="/knowledge-base" element={<KnowledgeBase />} />
                <Route path="/channels" element={<Channels />} />
                <Route path="/products" element={<Products />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/team" element={<Team />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Gate>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
