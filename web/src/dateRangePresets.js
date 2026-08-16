// Util bareng buat filter tanggal (Hari ini / Kemarin / Minggu ini / Bulan ini / Custom)
// dipakai di semua dashboard yang nampilin data penting (Overview, Leads AI, Percakapan, dst).

function toDateOnly(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const PRESETS = [
  { key: "today", label: "Hari ini" },
  { key: "yesterday", label: "Kemarin" },
  { key: "week", label: "Minggu ini" },
  { key: "month", label: "Bulan ini" },
  { key: "custom", label: "Custom" },
];

export function rangeForPreset(preset, customFrom, customTo) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (preset === "today") {
    const d = startOfDay(now);
    return { from: toDateOnly(d), to: toDateOnly(d) };
  }
  if (preset === "yesterday") {
    const d = startOfDay(now);
    d.setDate(d.getDate() - 1);
    return { from: toDateOnly(d), to: toDateOnly(d) };
  }
  if (preset === "week") {
    const d = startOfDay(now);
    const day = d.getDay() === 0 ? 7 : d.getDay(); // Senin = awal minggu
    const start = new Date(d);
    start.setDate(d.getDate() - (day - 1));
    return { from: toDateOnly(start), to: toDateOnly(now) };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toDateOnly(start), to: toDateOnly(now) };
  }
  // custom
  return { from: customFrom || toDateOnly(now), to: customTo || toDateOnly(now) };
}

export function defaultRange() {
  return { preset: "today", ...rangeForPreset("today") };
}
