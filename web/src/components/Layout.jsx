import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true, icon: "M3 11.5 12 4l9 7.5M5 10v9h5v-5h4v5h5v-9" },
  { to: "/monitor", label: "Monitor Chat", icon: "M4 5h16v10H8l-4 4V5Z" },
  { to: "/leads", label: "Leads AI", icon: "M13 2 3 14h7l-1 8 10-12h-7l1-8Z" },
  { to: "/conversations", label: "Percakapan", icon: "M21 11.5a8.38 8.38 0 0 1-4.7 7.6 8.5 8.5 0 0 1-7.6 0L3 21l1.9-5.7a8.38 8.38 0 0 1 0-7.6 8.5 8.5 0 0 1 7.6-4.7h.5a8.48 8.48 0 0 1 8 8v.5Z" },
  { to: "/contacts", label: "Kontak", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { to: "/broadcasts", label: "Broadcast", icon: "M4 11a8 8 0 0 1 8-8M4 11a8 8 0 0 0 8 8M4 11h16M12 3a8 8 0 0 1 8 8M12 19a8 8 0 0 0 8-8" },
  { to: "/ctwa", label: "CTWA & Iklan", icon: "M3 11 20 3l-4 18-6-8-7-2Z" },
  { to: "/automations", label: "Otomatisasi", icon: "M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" },
  { to: "/knowledge-base", label: "Knowledge Base", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" },
  { to: "/channels", label: "Nomor WhatsApp", icon: "M3 5a2 2 0 0 1 2-2h3.28a1 1 0 0 1 .95.68l1.5 4.5a1 1 0 0 1-.29 1.05L8.5 10.5a11 11 0 0 0 5 5l1.27-1.94a1 1 0 0 1 1.05-.29l4.5 1.5a1 1 0 0 1 .68.95V19a2 2 0 0 1-2 2h-1C10.4 21 3 13.6 3 4Z" },
  { to: "/products", label: "Produk", icon: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { to: "/departments", label: "Departemen", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 12h.01M15 12h.01" },
  { to: "/team", label: "Tim", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { to: "/settings", label: "Pengaturan", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" },
];

const THEME_KEY = "cakapcepat_theme";

export default function Layout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  return (
    <div className="app-shell">
      <div className="topbar-mobile">
        <button
          type="button"
          className="menu-toggle"
          aria-label="Buka menu"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          &#9776;
        </button>
        <span className="topbar-logo-chip">
          <img src="/logo.png" alt="CakapCepat" className="topbar-logo" />
        </span>
        <button
          type="button"
          className="theme-toggle-mobile"
          onClick={toggleTheme}
          aria-label="Ganti tema"
          aria-pressed={theme === "dark"}
        >
          <svg viewBox="0 0 24 24" className="theme-icon theme-icon-sun" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
          </svg>
          <svg viewBox="0 0 24 24" className="theme-icon theme-icon-moon" aria-hidden="true">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
          </svg>
        </button>
      </div>

      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-logo-chip">
            <img src="/logo.png" alt="CakapCepat" />
          </span>
          <span className="brand-tagline">By TahaGroup</span>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-pressed={theme === "dark"}>
          <span className="theme-toggle-track">
            <svg viewBox="0 0 24 24" className="theme-icon theme-icon-sun" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
            </svg>
            <svg viewBox="0 0 24 24" className="theme-icon theme-icon-moon" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
            </svg>
            <span className="theme-toggle-thumb" />
          </span>
          <span className="theme-toggle-label">{theme === "light" ? "Mode Gelap" : "Mode Terang"}</span>
        </button>
        <div className="user-box">
          <div className="user-box-row">
            <div className="user-box-avatar">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" />
              ) : (
                <span>{(user?.name || user?.email || "?").trim().charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div>
              <div className="name">{user?.username || user?.name || user?.email}</div>
              <div>{user?.role}</div>
            </div>
          </div>
          <button onClick={logout}>Keluar</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
