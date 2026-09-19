/**
 * Uji pengalihan apex -> www.
 *
 * KENAPA UJI INI ADA
 * Railway menyajikan aplikasi yang sama di `cakapcepat.com` dan
 * `www.cakapcepat.com`. Dua host dengan isi identik membuat mesin pencari
 * menebak mana yang asli, dan membuat sesi login pecah antar-host. Pengalihan
 * 301 di src/app.ts yang mencegahnya.
 *
 * Yang dijaga berkas ini, dan tiap satunya pernah jadi bug di produk lain:
 *   1. Apex dialihkan — bukan hanya halaman depan, tapi SETIAP path.
 *   2. Query string ikut terbawa. Yang hilang di sini = klik iklan yang
 *      kehilangan parameter pelacakannya.
 *   3. Nama host TIDAK peka huruf besar-kecil (RFC 4343).
 *   4. www, domain railway.app, dan localhost TIDAK ikut dialihkan. Kalau
 *      ikut, pratinjau Railway dan seluruh uji lokal terlempar ke produksi.
 *
 * MENJALANKAN:  npm run test:host   (butuh `npx tsc` lebih dulu? tidak —
 * berkas ini meng-import sumbernya langsung lewat tsx)
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../src/app";

/* fetch() bawaan Node menolak menyetel header Host — undici menganggapnya
   header terlarang. Jadi permintaannya dibuat langsung dengan http.request. */
function minta(port: number, host: string, jalur: string) {
  return new Promise<{ status: number; lokasi?: string }>((selesai) => {
    const r = http.request(
      { host: "127.0.0.1", port, path: jalur, method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        selesai({ status: res.statusCode ?? 0, lokasi: res.headers.location });
      }
    );
    r.on("error", () => selesai({ status: 0 }));
    r.end();
  });
}

const KASUS: Array<[string, string, boolean, string]> = [
  ["cakapcepat.com", "/", true, "halaman depan apex dialihkan"],
  ["cakapcepat.com", "/panduan", true, "halaman panduan ikut dialihkan"],
  ["cakapcepat.com", "/panduan/balas-chat-whatsapp-otomatis", true, "path dalam ikut terbawa"],
  ["cakapcepat.com", "/masuk?dari=iklan&utm_source=meta", true, "query ikut terbawa"],
  ["CakapCepat.com", "/", true, "nama host tidak peka huruf besar-kecil"],
  ["www.cakapcepat.com", "/", false, "www TIDAK dialihkan (kalau ikut = lingkaran tak berujung)"],
  ["www.cakapcepat.com", "/panduan", false, "www di path dalam tetap dilayani"],
  ["cakapcepat.up.railway.app", "/", false, "domain Railway TIDAK dialihkan"],
  ["localhost:3000", "/", false, "localhost TIDAK dialihkan"],
];

async function jalan() {
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as AddressInfo).port;

  console.log("\nPengalihan host resmi (apex -> www)\n");
  let lulus = 0;
  let gagal = 0;

  for (const [host, jalur, harusAlih, ket] of KASUS) {
    const { status, lokasi } = await minta(port, host, jalur);
    const benar = harusAlih
      ? status === 301 && lokasi === `https://www.cakapcepat.com${jalur}`
      : status !== 301;
    if (benar) {
      lulus++;
      console.log(`  LULUS  ${ket}`);
    } else {
      gagal++;
      console.log(`  GAGAL  ${ket}`);
      console.log(`           ${host}${jalur} -> ${status}${lokasi ? " " + lokasi : ""}`);
    }
  }

  console.log(`\n==== HASIL: ${lulus} lulus, ${gagal} gagal ====\n`);
  srv.close();
  process.exit(gagal ? 1 : 0);
}

jalan();
