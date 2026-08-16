import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/monitor", label: "Monitor Chat" },
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

export default function Layout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        <img src="/logo.png" alt="CakapCepat" className="topbar-logo" />
      </div>

      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo.png" alt="CakapCepat" />
          <div className="brand-text">
            CakapCepat
            <small>By TahaGroup</small>
          </div>
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
