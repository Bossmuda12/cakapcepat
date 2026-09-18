import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import OAuthCallback from "./pages/OAuthCallback";
import CompleteProfile from "./pages/CompleteProfile";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import DataDeletion from "./pages/DataDeletion";
import Landing from "./pages/Landing";
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
import Orders from "./pages/Orders";
import OrdersList from "./pages/OrdersList";
import Leads from "./pages/Leads";
import Automations from "./pages/Automations";
import Automation from "./pages/Automation";
import FollowUps from "./pages/FollowUps";
import Courier from "./pages/Courier";
import KnowledgeBase from "./pages/KnowledgeBase";
import AuditLog from "./pages/AuditLog";

/**
 * Halaman muka (/) adalah PROFIL publik CakapCepat, bukan layar login.
 * Pengunjung baru dan mesin pencari melihat profil; pengguna yang sudah masuk
 * langsung dialihkan ke dasbor supaya tidak perlu klik dua kali.
 */
function Beranda() {
  const { user, loading, needsBootstrap } = useAuth();
  if (loading) return <div className="loading-block">Memuat...</div>;
  if (!needsBootstrap && user && !user.needs_onboarding) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

/** Layar masuk berdiri sendiri di /masuk. */
function Masuk() {
  const { user, loading, needsBootstrap } = useAuth();
  if (loading) return <div className="loading-block">Memuat...</div>;
  if (needsBootstrap) return <Bootstrap />;
  if (user && user.needs_onboarding) return <CompleteProfile />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Login />;
}

/** Penjaga rute dasbor: tanpa sesi, lempar ke /masuk. */
function Gate({ children }) {
  const { user, loading, needsBootstrap } = useAuth();
  const location = useLocation();

  if (loading) return <div className="loading-block">Memuat...</div>;
  if (needsBootstrap) return <Bootstrap />;
  if (!user) return <Navigate to="/masuk" replace state={{ from: location.pathname }} />;
  if (user.needs_onboarding) return <CompleteProfile />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* --- Halaman publik --- */}
      <Route path="/" element={<Beranda />} />
      <Route path="/masuk" element={<Masuk />} />
      <Route path="/login" element={<Navigate to="/masuk" replace />} />
      <Route path="/tentang" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/oauth-callback" element={<OAuthCallback />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/data-deletion" element={<DataDeletion />} />

      {/* --- Dasbor (butuh sesi) --- */}
      <Route
        path="/*"
        element={
          <Gate>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Overview />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/conversations" element={<Conversations />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/broadcasts" element={<Broadcasts />} />
                <Route path="/ctwa" element={<Ctwa />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders-list" element={<OrdersList />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/automations" element={<Automations />} />
                <Route path="/automation" element={<Automation />} />
                <Route path="/followups" element={<FollowUps />} />
                <Route path="/courier" element={<Courier />} />
                <Route path="/knowledge-base" element={<KnowledgeBase />} />
                <Route path="/channels" element={<Channels />} />
                <Route path="/products" element={<Products />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/team" element={<Team />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
