import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Modal from "./Modal";

/**
 * Popup untuk menyambungkan nomor tim lewat QR code / kode pairing (BUKA
 * WhatsApp Cloud API resmi) — dipakai halaman Nomor WhatsApp untuk nomor
 * yang belum bisa dapat akses Cloud API resmi dari Meta. Sekali dibuka,
 * modal ini polling status tiap 3 detik sampai statusnya "connected".
 */
export default function QrConnectModal({ channel, onClose, onConnected }) {
  const [method, setMethod] = useState("qr"); // "qr" | "pairing"
  const [phoneNumber, setPhoneNumber] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const pollStatus = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.get(`/channels/${channel.id}/qr/status`);
        setStatus(s);
        if (s.connectionState === "connected") {
          stopPolling();
          onConnected?.();
        }
      } catch (err) {
        // koneksi jaringan sesaat gagal — biarkan interval coba lagi, tidak perlu ganggu user
        console.warn("Gagal polling status QR:", err);
      }
    }, 3000);
  };

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      await api.post(`/channels/${channel.id}/qr/start`, {
        method,
        phoneNumber: method === "pairing" ? phoneNumber : undefined,
      });
      pollStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal open={!!channel} onClose={onClose} title={`Sambungkan "${channel?.label || "Nomor Tim"}"`} width={480}>
      {!status?.qrDataUrl && !status?.pairingCode && status?.connectionState !== "connected" && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: -4, marginBottom: 16 }}>
            Ini koneksi WhatsApp TANPA API resmi (seperti WhatsApp Web) — pakai untuk nomor tim yang
            belum bisa dapat akses Cloud API resmi. Pakai sewajarnya seperti CS manusia biasa chat,
            supaya nomor tidak dianggap mencurigakan oleh WhatsApp.
          </p>
          {error && <div className="error-box">{error}</div>}
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Metode Sambung</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="qr">Scan QR Code</option>
              <option value="pairing">Kode Pairing (tanpa kamera)</option>
            </select>
          </div>
          {method === "pairing" && (
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Nomor HP WhatsApp (format 62...)</label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="62812xxxxxxx"
              />
            </div>
          )}
          <button
            className="btn block"
            type="button"
            disabled={starting || (method === "pairing" && !phoneNumber)}
            onClick={start}
          >
            {starting ? "Memulai..." : method === "qr" ? "Tampilkan QR Code" : "Minta Kode Pairing"}
          </button>
        </div>
      )}

      {status?.connectionState !== "connected" && status?.qrDataUrl && (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Buka WhatsApp di HP nomor tim &rarr; Pengaturan &rarr; Perangkat Tertaut &rarr; Tautkan
            Perangkat, lalu scan QR ini.
          </p>
          <img src={status.qrDataUrl} alt="QR Code WhatsApp" style={{ width: 240, height: 240, margin: "0 auto" }} />
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>QR akan diperbarui otomatis kalau kedaluwarsa.</p>
        </div>
      )}

      {status?.connectionState !== "connected" && status?.pairingCode && (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Buka WhatsApp di HP nomor tim &rarr; Pengaturan &rarr; Perangkat Tertaut &rarr; Tautkan dengan
            Nomor Telepon, lalu masukkan kode ini:
          </p>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 4, margin: "12px 0" }}>
            {status.pairingCode}
          </div>
        </div>
      )}

      {status?.connectionState === "connected" && (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--success, #16a34a)" }}>
            Berhasil tersambung ke {status.displayPhoneNumber || "nomor WhatsApp"}!
          </p>
          <button className="btn block" type="button" onClick={onClose}>
            Selesai
          </button>
        </div>
      )}
    </Modal>
  );
}
