import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getToken, setToken, clearToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.get("/auth/status");
      setNeedsBootstrap(status.needsBootstrap);

      if (getToken()) {
        try {
          const me = await api.get("/auth/me");
          setUser(me);
        } catch {
          clearToken();
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    setToken(res.token);
    setUser(res.user);
  };

  const bootstrap = async (payload) => {
    const res = await api.post("/auth/bootstrap", payload);
    setToken(res.token);
    setUser(res.user);
    setNeedsBootstrap(false);
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, needsBootstrap, login, bootstrap, logout, refresh, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
