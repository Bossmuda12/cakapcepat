import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/monitor", label: "Monitor Chat" },
  { to: "/leads", label: "Leads AI" },
  { to: "/conversations", label: "Percakapan" },
  { to: "/contacts", label: "Kontak" },
  { to: "/broadcasts", label: "Broadcast" },
  { to: "/ctwa", label: "CTWA & Iklan" },
  { to: "/automations", label: "Otomatisasi" },
  { to: "/knowledge-base", label: "Knowledge Base" },
  { to: "/channels", label: "Nomor WhatsApp" },
  { to: "/products", label: "Produk" },
  { to: "/departments", label: "Departemen" },
  { to: "/team", label: "Tim" },
  { to: "/settings", label: "Pengaturan" },
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
          <div className="name">{user?.name || user?.email}</div>
          <div>{user?.role}</div>
          <button onClick={logout}>Keluar</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
