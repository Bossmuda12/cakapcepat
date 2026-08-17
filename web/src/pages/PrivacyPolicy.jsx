export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <h1>Kebijakan Privasi CakapCepat</h1>
        <p className="legal-updated">Terakhir diperbarui: 17 Agustus 2026</p>

        <p>
          CakapCepat ("kami") adalah layanan otomasi WhatsApp yang dikembangkan dan dioperasikan oleh
          TahaGroup. Kebijakan ini menjelaskan data apa saja yang kami kumpulkan dari pengguna dashboard
          CakapCepat, untuk apa data itu dipakai, dan bagaimana pengguna bisa mengontrolnya.
        </p>

        <h2>1. Data yang Kami Kumpulkan</h2>
        <p>Saat mendaftar atau menggunakan CakapCepat, kami dapat menyimpan:</p>
        <ul>
          <li>Nama, alamat email, dan username akun kamu.</li>
          <li>Foto profil (jika kamu unggah sendiri, atau diambil dari Google/Facebook saat login sosial).</li>
          <li>Data organisasi/bisnis yang kamu daftarkan (nama organisasi, departemen, produk).</li>
          <li>Data operasional WhatsApp Business yang kamu hubungkan (nomor, percakapan, kontak, pesan) untuk menjalankan fitur dashboard.</li>
          <li>Jika kamu masuk lewat Google atau Facebook: nama, alamat email, dan foto profil yang diizinkan platform tersebut untuk dibagikan ke aplikasi pihak ketiga.</li>
        </ul>

        <h2>2. Bagaimana Data Digunakan</h2>
        <ul>
          <li>Membuat dan mengelola akun kamu di CakapCepat.</li>
          <li>Menjalankan fitur inti dashboard: monitor chat, broadcast, otomasi, laporan AI harian.</li>
          <li>Mengirim email transaksional (verifikasi akun, reset password) yang kamu minta sendiri.</li>
          <li>Kami tidak menjual data pengguna ke pihak ketiga manapun.</li>
        </ul>

        <h2>3. Login dengan Google / Facebook</h2>
        <p>
          Jika kamu memilih masuk memakai akun Google atau Facebook, kami hanya meminta data dasar (nama,
          email, foto profil) yang diperlukan untuk membuat/mencocokkan akun CakapCepat kamu. Kami tidak
          memposting apa pun atas nama kamu, tidak mengakses daftar teman, dan tidak meminta izin di luar
          yang ditampilkan pada layar persetujuan Google/Facebook saat login.
        </p>

        <h2>4. Keamanan Data</h2>
        <p>
          Password disimpan dalam bentuk terenkripsi (hashed), tidak pernah dalam teks biasa. Data
          disimpan di database yang dikelola secara terpusat dan hanya bisa diakses oleh anggota tim
          organisasi kamu sendiri sesuai peran (role) masing-masing.
        </p>

        <h2>5. Hak Pengguna</h2>
        <p>
          Kamu bisa mengubah atau menghapus data profil kapan saja lewat halaman Pengaturan Akun. Untuk
          menghapus akun beserta seluruh datanya secara permanen, lihat halaman{" "}
          <a href="/data-deletion">Petunjuk Penghapusan Data</a>.
        </p>

        <h2>6. Kontak</h2>
        <p>
          Pertanyaan seputar privasi data bisa dikirim ke email yang terdaftar pada akun pemilik
          organisasi (owner) CakapCepat kamu.
        </p>
      </div>
    </div>
  );
}
