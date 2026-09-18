import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useTheme } from "../useTheme";
import Icon from "./Icon";
import SearchField from "./SearchField";

/**
 * Menu samping berbentuk POHON BERCABANG.
 *
 * Tiap grup punya ikon sendiri di rel kiri; anak-anaknya menggantung di bawah
 * garis cabang, seperti struktur folder. Ini menggantikan daftar datar abu-abu
 * yang dulu: 20 halaman berjejer tanpa hierarki sehingga sulit dibaca sekilas
 * dan tidak terlihat seperti produk jadi.
 */
const NAV_GROUPS = [
  {
    id: "ringkasan",
    label: "Ringkasan",
    groupIcon: "M3 11.5 12 4l9 7.5M5 10v9h5v-5h4v5h5v-9",
    items: [
      { to: "/dashboard", label: "Overview", end: true, icon: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" },
      { to: "/monitor", label: "Monitor Chat", icon: "M4 5h16v10H8l-4 4V5Z" },
      { to: "/leads", label: "Leads AI", icon: "M13 2 3 14h7l-1 8 10-12h-7l1-8Z" },
    ],
  },
  {
    id: "percakapan",
    label: "Percakapan",
    groupIcon: "M21 11.5a8.38 8.38 0 0 1-4.7 7.6 8.5 8.5 0 0 1-7.6 0L3 21l1.9-5.7a8.38 8.38 0 0 1 0-7.6 8.5 8.5 0 0 1 7.6-4.7h.5a8.48 8.48 0 0 1 8 8v.5Z",
    items: [
      { to: "/conversations", label: "Percakapan", icon: "M21 11.5a8.38 8.38 0 0 1-4.7 7.6 8.5 8.5 0 0 1-7.6 0L3 21l1.9-5.7a8.38 8.38 0 0 1 0-7.6 8.5 8.5 0 0 1 7.6-4.7h.5a8.48 8.48 0 0 1 8 8v.5Z" },
      { to: "/contacts", label: "Kontak", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
      { to: "/broadcasts", label: "Broadcast", icon: "M4 11a8 8 0 0 1 8-8M4 11a8 8 0 0 0 8 8M4 11h16M12 3a8 8 0 0 1 8 8M12 19a8 8 0 0 0 8-8" },
      { to: "/channels", label: "Nomor WhatsApp", icon: "M3 5a2 2 0 0 1 2-2h3.28a1 1 0 0 1 .95.68l1.5 4.5a1 1 0 0 1-.29 1.05L8.5 10.5a11 11 0 0 0 5 5l1.27-1.94a1 1 0 0 1 1.05-.29l4.5 1.5a1 1 0 0 1 .68.95V19a2 2 0 0 1-2 2h-1C10.4 21 3 13.6 3 4Z" },
    ],
  },
  {
    id: "penjualan",
    label: "Penjualan",
    groupIcon: "M4 6h16l-1.5 14a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 6ZM9 2h6l1 4H8l1-4Z",
    items: [
      { to: "/orders", label: "Laporan Order", icon: "M4 19V5M4 19h16M8 15V9M12 15V6M16 15v-4" },
      { to: "/orders-list", label: "Pesanan", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
      { to: "/courier", label: "Kurir & Resi", icon: "M1 3h15v13H1V3ZM16 8h4l3 3v5h-7V8ZM3 18.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0ZM16 18.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0Z" },
      { to: "/ctwa", label: "CTWA & Iklan", icon: "M3 11 20 3l-4 18-6-8-7-2Z" },
    ],
  },
  {
    id: "otomatisasi",
    label: "Otomatisasi AI",
    groupIcon: "M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 0-6V7a4 4 0 0 0-4-4ZM12 3v18",
    items: [
      { to: "/automation", label: "Otak AI", icon: "M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 0-6V7a4 4 0 0 0-4-4ZM12 3v18" },
      { to: "/knowledge-base", label: "Knowledge Base", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" },
      { to: "/automations", label: "Aturan Otomatis", icon: "M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" },
      { to: "/followups", label: "Follow-up", icon: "M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" },
    ],
  },
  {
    id: "katalog",
    label: "Katalog",
    groupIcon: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    items: [
      { to: "/products", label: "Produk", icon: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
      { to: "/departments", label: "Departemen", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" },
    ],
  },
  {
    id: "organisasi",
    label: "Organisasi",
    groupIcon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87",
    items: [
      { to: "/team", label: "Tim", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
      { to: "/audit-log", label: "Catatan Aktivitas", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M16 13H8M16 17H8M10 9H8" },
      { to: "/settings", label: "Pengaturan", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" },
    ],
  },
];

const COLLAPSED_KEY = "cakapcepat_nav_collapsed";

function readCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Judul halaman aktif — dipakai di jejak remah (breadcrumb) topbar. */
function findCrumb(pathname) {
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (i.end ? pathname === i.to : pathname.startsWith(i.to)) return { group: g.label, item: i.label };
    }
  }
  return null;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [filter, setFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      /* tidak apa-apa kalau penyimpanan diblokir */
    }
  }, [collapsed]);

  /* Menu profil ditutup saat klik di luar atau tekan Escape — tanpa ini menu
     menggantung terbuka dan menutupi isi halaman saat pengguna pindah menu. */
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setSidebarOpen(false);
  }, [location.pathname]);

  const toggleGroup = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  const closeSidebar = () => setSidebarOpen(false);

  const displayName = user?.username || user?.name || user?.email || "Pengguna";
  const initial = String(displayName).trim().charAt(0).toUpperCase() || "?";
  const crumb = findCrumb(location.pathname);

  const avatar = user?.avatar_url ? (
    <img src={user.avatar_url} alt="" />
  ) : (
    <span>{initial}</span>
  );

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebar} />}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-logo-chip">
            {/* Sidebar selalu ungu tua, jadi selalu pakai logo versi terang. */}
            <img src="/logo-light.png" alt="CakapCepat" />
          </span>
        </div>

        <SearchField
          className="nav-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Cari menu..."
        />

        <nav className="nav-scroll">
          {groups.map((group) => {
            const isCollapsed = !q && Boolean(collapsed[group.id]);
            return (
              <div className={`nav-group ${isCollapsed ? "is-collapsed" : ""}`} key={group.id}>
                <button
                  type="button"
                  className="nav-group-head"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="nav-group-chip" aria-hidden="true">
                    <svg viewBox="0 0 24 24" className="nav-group-icon">
                      <path d={group.groupIcon} />
                    </svg>
                  </span>
                  <span className="nav-group-label">{group.label}</span>
                  <svg viewBox="0 0 24 24" className={`nav-chevron ${isCollapsed ? "closed" : ""}`} aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="nav-branch">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={closeSidebar}
                        className={({ isActive }) => `nav-leaf ${isActive ? "active" : ""}`}
                      >
                        <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
                          <path d={item.icon} />
                        </svg>
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <p className="nav-empty">Menu tidak ditemukan.</p>}
        </nav>

        <div className="sidebar-foot">
          <p className="sidebar-foot-note">CakapCepat &middot; WhatsApp bekerja sendiri</p>
        </div>
      </aside>

      <div className="app-body">
        {/* Bilah atas: identitas di kiri, akun & tema di KANAN ATAS —
            struktur yang sama dipakai perangkat lunak bisnis pada umumnya,
            supaya pengguna tahu di mana mencari profil tanpa diberi tahu. */}
        <header className="topbar">
          <button
            type="button"
            className="topbar-burger"
            aria-label="Buka menu"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon name="menu" size={20} />
          </button>

          <span className="topbar-logo-chip">
            <img
              src={theme === "dark" ? "/logo-light.png" : "/logo.png"}
              alt="CakapCepat"
              className="topbar-logo"
            />
          </span>

          <nav className="topbar-crumb" aria-label="Lokasi halaman">
            {crumb ? (
              <>
                <span className="crumb-root">{crumb.group}</span>
                <Icon name="panah" size={13} className="crumb-sep" />
                <span className="crumb-now">{crumb.item}</span>
              </>
            ) : (
              <span className="crumb-now">Dashboard</span>
            )}
          </nav>

          <div className="topbar-right">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={theme === "light" ? "Aktifkan mode gelap" : "Aktifkan mode terang"}
              aria-pressed={theme === "dark"}
              title={theme === "light" ? "Mode gelap" : "Mode terang"}
            >
              <Icon name={theme === "light" ? "bulan" : "matahari"} size={18} />
            </button>

            <div className="profile-menu" ref={menuRef}>
              <button
                type="button"
                className={`profile-trigger ${menuOpen ? "open" : ""}`}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="profile-avatar">{avatar}</span>
                <span className="profile-id">
                  <span className="profile-name">{displayName}</span>
                  <span className="profile-role">{user?.role || "pengguna"}</span>
                </span>
                <Icon name="panah" size={14} className="profile-caret" />
              </button>

              {menuOpen && (
                <div className="profile-pop" role="menu">
                  <div className="profile-pop-head">
                    <span className="profile-avatar lg">{avatar}</span>
                    <div>
                      <div className="profile-pop-name">{displayName}</div>
                      <div className="profile-pop-mail">{user?.email}</div>
                    </div>
                  </div>
                  <Link to="/settings#profil" className="profile-pop-item" role="menuitem">
                    <Icon name="pengguna" size={16} />
                    <span>Profil saya</span>
                  </Link>
                  <Link to="/settings" className="profile-pop-item" role="menuitem">
                    <Icon name="gir" size={16} />
                    <span>Pengaturan</span>
                  </Link>
                  <button type="button" className="profile-pop-item danger" role="menuitem" onClick={logout}>
                    <Icon name="keluar" size={16} />
                    <span>Keluar</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
