import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Bootstrap from "./pages/Bootstrap";
import Overview from "./pages/Overview";
import Departments from "./pages/Departments";
import Products from "./pages/Products";
import Channels from "./pages/Channels";
import Contacts from "./pages/Contacts";
import Conversations from "./pages/Conversations";
import Broadcasts from "./pages/Broadcasts";
import Team from "./pages/Team";

function Gate({ children }) {
  const { user, loading, needsBootstrap } = useAuth();

  if (loading) return <div className="loading-block">Memuat...</div>;
  if (needsBootstrap) return <Bootstrap />;
  if (!user) return <Login />;
  return children;
}

function AppRoutes() {
  return (
    <Gate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/departments" element={<Departments />} />
          <Route path="/products" element={<Products />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/broadcasts" element={<Broadcasts />} />
          <Route path="/team" element={<Team />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Gate>
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
