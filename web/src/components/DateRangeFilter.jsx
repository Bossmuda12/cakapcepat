import { useState } from "react";
import { PRESETS, rangeForPreset } from "../dateRangePresets";

/**
 * Filter tanggal dipakai di semua dashboard dengan data krusial: Hari ini,
 * Kemarin, Minggu ini, Bulan ini, dan Custom (pilih tanggal sendiri).
 * value: { preset, from, to } (from/to format YYYY-MM-DD)
 */
export default function DateRangeFilter({ value, onChange }) {
  const [customOpen, setCustomOpen] = useState(value.preset === "custom");

  const selectPreset = (key) => {
    if (key === "custom") {
      setCustomOpen(true);
      onChange({ preset: "custom", from: value.from, to: value.to });
      return;
    }
    setCustomOpen(false);
    onChange({ preset: key, ...rangeForPreset(key) });
  };

  const updateCustom = (field) => (e) => {
    const next = { ...value, preset: "custom", [field]: e.target.value };
    onChange(next);
  };

  return (
    <div className="date-range-filter">
      <div className="date-range-pills">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`date-range-pill ${value.preset === p.key ? "active" : ""}`}
            onClick={() => selectPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {customOpen && (
        <div className="date-range-custom">
          <input type="date" value={value.from} onChange={updateCustom("from")} />
          <span>—</span>
          <input type="date" value={value.to} onChange={updateCustom("to")} />
        </div>
      )}
    </div>
  );
}
