import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/conversations", label: "Percakapan" },
  { to: "/contacts", label: "Kontak" },
  { to: "/broadcasts", label: "Broadcast" },
  { to: "/channels", label: "Nomor WhatsApp" },
  { to: "/products", label: "Produk" },
  { to: "/departments", label: "Departemen" },
  { to: "/team", label: "Tim" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          CakapCepat
          <small>by TahaGroup</small>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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
