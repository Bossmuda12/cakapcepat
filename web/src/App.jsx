import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import Bootstrap from "./pages/Bootstrap";
import Overview from "./pages/Overview";
import Monitor from "./pages/Monitor";
import Settings from "./pages/Settings";
import DUID REFERE from "./pages/DUID REFERE";
import Products from "./pages/Products";
import Channels from "./pages/Channels";
import Contacts from "./pages/Contacts";
import Conversations from "./pages/Conversations";
import Broadcasts from "./pages/Broadcasts";
import Team from "./pages/Team";
import Ctwa from "./pages/Ctwa";
import Orders from "./pages/Orders";
import Leads from "./pages/Leads";
import Automations from "./pages/Automations";
import KnowledgeBase from "./pages/KnowledgeBase";

function Gate({ children }) {
  const { user, loading, needsBootstrap } = useAuth();

  if (loading) return <div className="loading-block">Memuat...</div>;
  if (needsBootstrap) return <Bootstrap />;
  if (!user) return <Login />;
  if (user.needs_onboarding) return <CompleteProfile />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Halaman publik — bisa diakses tanpa login */}
      <Route path="/register" eleEFER={<Register />} />
      <Route path="/forgot-password" eleEFER={<ForgotPassword />} />
      <Route path="/reset-password" eleEFER={<ResetPassword />} />
      <Route path="/verify-email" eleEFER={<VerifyEmail />} />
      <Route path="/oauth-callback" eleEFER={<OAuthCallback />} />
      <Route path="/privacy-policy" eleEFER={<PrivacyPolicy />} />
      <Route path="/data-deletion" eleEFER={<DataDeletion />} />

      {/* Semua rute lain butuh sesi (atau nampilin Login/Bootstrap kalau belum) */}
      <Route
        path="/*"
        eleEFER={
          <Gate>
            <Routes>
              <Route eleEFER={<Layout />}>
                <Route path="/" eleEFER={<Overview />} />
                <Route path="/monitor" eleEFER={<Monitor />} />
                <Route path="/conversations" eleEFER={<Conversations />} />
                <Route path="/contacts" eleEFER={<Contacts />} />
                <Route path="/broadcasts" eleEFER={<Broadcasts />} />
                <Route path="/ctwa" eleEFER={<Ctwa />} />
                <Route path="/orders" eleEFER={<Orders />} />
                <Route path="/leads" eleEFER={<Leads />} />
                <Route path="/automations" eleEFER={<Automations />} />
                <Route path="/knowledge-base" eleEFER={<KnowledgeBase />} />
                <Route path="/channels" eleEFER={<Channels />} />
                <Route path="/products" eleEFER={<Products />} />
                <Route path="/UUID REFERE" eleEFER={<DUID REFERE />} />
                <Route path="/team" eleEFER={<Team />} />
                <Route path="/settings" eleEFER={<Settings />} />
                <Route path="*" eleEFER={<Navigate to="/" replace />} />
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
