/**
 * Isi halaman panduan.
 *
 * KENAPA HALAMAN INI ADA
 * Sampai 19 September 2026, cakapcepat.com cuma punya SATU halaman berisi —
 * sisanya kebijakan privasi dan penghapusan data. Satu halaman tidak bisa
 * bersaing untuk kata kunci apa pun selain nama mereknya sendiri, dan nama
 * "cakapcepat" pun dibetulkan Google jadi "cakap cepat" lalu kalah oleh
 * cakap.com. Halaman-halaman ini menyasar pertanyaan yang benar-benar diketik
 * calon pembeli sebelum mereka tahu nama produknya.
 *
 * ATURAN ISI
 * Semuanya diturunkan dari apa yang memang sudah dikerjakan sistem dan sudah
 * tertulis di halaman depan. Tidak boleh ada klaim baru, angka karangan, janji
 * kenaikan penjualan, atau testimoni palsu — halaman depan sendiri menulis
 * batas kemampuan secara terbuka, dan halaman ini tidak boleh melanggarnya.
 */

export const PANDUAN = [
  {
    slug: "balas-chat-whatsapp-otomatis",
    judul: "Cara Membalas Chat WhatsApp Otomatis dengan AI Tanpa Terasa Robot",
    ringkas:
      "Kenapa auto-reply template gagal, apa bedanya balasan berbasis AI, dan bagaimana mengatur jeda mengetik supaya balasan tidak terasa mesin.",
    deskripsi:
      "Panduan membalas chat WhatsApp secara otomatis dengan AI: perbedaannya dengan auto-reply template, cara mengatur jeda mengetik yang wajar, dan kapan percakapan harus dilempar ke manusia.",
    diperbarui: "2026-09-19",
    isi: [
      {
        h: null,
        p: [
          "Setiap penjual yang beriklan tahu rasanya: iklan jalan, chat masuk berbarengan, dan pertanyaan yang sama diulang puluhan kali dalam sehari. Yang paling sering hilang bukan pembeli yang membandingkan harga — tapi pembeli yang menunggu balasan dan keburu menutup aplikasi.",
          "Balasan otomatis adalah jawaban yang jelas untuk masalah itu. Masalahnya, cara paling umum melakukannya justru membuat keadaan lebih buruk.",
        ],
      },
      {
        h: "Kenapa auto-reply template sering gagal",
        p: [
          "Auto-reply bawaan WhatsApp Business hanya bisa mengirim satu pesan yang sama untuk semua orang. Pembeli yang bertanya \"masih ada warna sage?\" dan pembeli yang bertanya \"bisa COD?\" menerima kalimat yang persis sama.",
          "Akibatnya dua hal. Pertama, pertanyaannya tetap tidak terjawab, jadi admin tetap harus membalas manual — pekerjaan tidak berkurang. Kedua, pembeli langsung tahu dia sedang bicara dengan mesin, dan itu menurunkan kepercayaan tepat di menit ketika kepercayaan paling menentukan.",
        ],
      },
      {
        h: "Apa bedanya balasan berbasis AI",
        p: [
          "Balasan berbasis AI membaca dua hal sebelum menjawab: riwayat percakapan itu sendiri, dan materi produk yang Anda isi sendiri — daftar produk, varian, harga, ongkir, garansi, dan jawaban atas pertanyaan yang paling sering muncul.",
          "Artinya pertanyaan soal stok dijawab dengan stok, pertanyaan soal ongkir dijawab dengan ongkir, dan kalau pembeli menyebut ukuran di pesan sebelumnya, jawaban berikutnya tidak menanyakannya lagi.",
          "Ini juga batas terpentingnya: AI tidak mengarang harga atau stok. Kalau materi produk Anda kosong atau usang, jawabannya akan seadanya. Kualitas jawaban selalu mengikuti kualitas materi yang Anda isi — itu pekerjaan yang tetap harus Anda lakukan sendiri.",
        ],
      },
      {
        h: "Jeda mengetik: detail kecil yang menentukan",
        p: [
          "Balasan yang datang nol koma sekian detik setelah pembeli menekan kirim tidak pernah terasa seperti orang. Manusia perlu waktu membaca dan mengetik, dan pembeli menangkap ketiadaan jeda itu secara refleks.",
          "Karena itu jeda mengetik diberi rentang, bukan angka tetap, dan berbeda-beda tiap balasan. Pesan panjang butuh jeda lebih lama daripada pesan pendek, sama seperti orang sungguhan. Yang dikejar bukan kecepatan maksimal, tapi kecepatan yang masuk akal.",
        ],
      },
      {
        h: "Kapan percakapan harus dilempar ke manusia",
        p: [
          "Otomatisasi yang baik tahu kapan berhenti. Ada percakapan yang seharusnya tidak pernah ditangani mesin:",
        ],
        ul: [
          "Tawar-menawar harga — keputusan uang, dan jawaban salah di sini menimbulkan sengketa.",
          "Komplain berat, terutama yang sudah menyinggung refund atau kerusakan.",
          "Pertanyaan di luar materi produk, ketika AI sendiri tidak yakin jawabannya.",
          "Permintaan yang sensitif atau tidak biasa, yang butuh pertimbangan orang.",
        ],
        p2: [
          "Pengalihan ke manusia bukan tanda sistemnya gagal. Justru sebaliknya: sistem yang memaksakan diri menjawab semuanya akan menghasilkan kesalahan yang jauh lebih mahal daripada balasan yang tertunda lima menit.",
        ],
      },
      {
        h: "Yang perlu disiapkan sebelum menyalakannya",
        ol: [
          "Daftar produk dengan varian dan harga yang benar-benar terkini.",
          "Ongkir per wilayah, atau aturan ongkir yang Anda pakai.",
          "Sepuluh sampai dua puluh pertanyaan yang paling sering masuk, beserta jawabannya.",
          "Gaya bicara: sapaan, panjang balasan, dan hal yang tidak boleh dikatakan.",
          "Daftar topik yang harus selalu dialihkan ke manusia.",
        ],
        p2: [
          "Lima hal ini yang menentukan hasilnya, jauh lebih besar daripada pilihan alatnya.",
        ],
      },
    ],
  },

  {
    slug: "rekap-closing-ke-grup-whatsapp",
    judul: "Merekap Closing ke Grup WhatsApp Tanpa Pernah Dobel",
    ringkas:
      "Kenapa rekap manual selalu bocor, apa yang membuat sebuah percakapan layak disebut closing, dan bagaimana mencegah satu pesanan dilaporkan dua kali.",
    deskripsi:
      "Cara merekap closing dari percakapan WhatsApp ke grup secara otomatis: apa yang menandai sebuah closing, data apa yang perlu ikut, dan bagaimana mencegah satu pesanan dilaporkan dua kali.",
    diperbarui: "2026-09-19",
    isi: [
      {
        h: null,
        p: [
          "Di hampir semua tim jualan lewat chat, rekap closing dikerjakan manual: admin menyalin nama, nomor, alamat, dan pesanan dari percakapan, lalu menempelkannya ke grup closingan. Cara ini bekerja sampai chat menumpuk — dan chat selalu menumpuk persis ketika iklan sedang jalan bagus.",
        ],
      },
      {
        h: "Tiga kebocoran yang selalu sama",
        ul: [
          "Pesanan yang terlewat. Admin sedang membalas sepuluh chat sekaligus, satu closing tidak sempat disalin, dan baru ketahuan waktu pembeli menanyakan paketnya.",
          "Pesanan yang dobel. Dua admin menangani percakapan yang sama, keduanya merekap, dan gudang mengemas dua paket untuk satu pembeli.",
          "Salin yang salah. Nomor tertukar satu digit, atau alamat terpotong. Ini yang paling mahal, karena baru ketahuan setelah paket berjalan.",
        ],
      },
      {
        h: "Apa yang menandai sebuah closing",
        p: [
          "Rekap otomatis hanya berguna kalau definisi closing-nya jelas. Yang dipakai di sini bukan tebakan dari kata kunci semata, melainkan kelengkapan percakapan: pembeli menyatakan mau, dan data yang dibutuhkan untuk mengirim barang sudah ada di percakapan itu.",
          "Praktisnya, sebuah percakapan dinilai closing ketika produk dan variannya jelas, nama dan nomor penerima ada, alamat lengkap ada, dan cara bayarnya disepakati. Kalau salah satu belum ada, itu belum closing — itu percakapan yang masih perlu dilanjutkan.",
        ],
      },
      {
        h: "Apa yang ikut dilaporkan",
        p: [
          "Ringkasan yang dikirim ke grup memuat isi pesanan, penerima, dan cara bayar — cukup untuk gudang bekerja tanpa harus membuka percakapan aslinya, dan cukup untuk Anda memeriksa kalau ada yang janggal.",
        ],
      },
      {
        h: "Aturan yang mencegah laporan dobel",
        p: [
          "Ini bagian yang paling menentukan dan paling sering dilewatkan waktu orang membangun sendiri: satu pesanan hanya boleh dilaporkan satu kali, selamanya.",
          "Artinya penandaan closing melekat pada percakapannya, bukan pada siapa yang kebetulan membukanya. Kalau percakapan yang sama diperiksa lagi nanti, atau ditangani admin lain, atau pembeli membalas lagi setelahnya, rekapnya tidak diulang. Tanpa aturan ini, rekap otomatis justru menghasilkan kekacauan yang lebih rapi kelihatannya tapi lebih sulit dilacak.",
        ],
      },
      {
        h: "Yang tetap harus dikerjakan orang",
        p: [
          "Rekap otomatis menghapus pekerjaan menyalin, bukan pekerjaan memeriksa. Alamat yang aneh, nomor yang mencurigakan, dan pesanan bernilai besar tetap layak dilihat manusia sebelum dikemas. Sistem ini mengurangi beban admin, bukan menghapus perannya.",
        ],
      },
    ],
  },

  {
    slug: "pantau-resi-dan-paket-bermasalah",
    judul: "Memantau Resi dan Menemukan Paket Bermasalah Sebelum Pembeli Marah",
    ringkas:
      "Kenapa masalah pengiriman COD hampir selalu ketahuan terlambat, status resi apa yang benar-benar perlu diwaspadai, dan apa yang harus dilakukan begitu tertahan.",
    deskripsi:
      "Cara memantau status resi kurir secara otomatis untuk jualan COD: status mana yang menandakan masalah, kenapa paket tertahan harus ditindak cepat, dan bagaimana retur ditekan.",
    diperbarui: "2026-09-19",
    isi: [
      {
        h: null,
        p: [
          "Pada jualan COD, uang baru masuk setelah paket diterima. Itu membuat setiap paket yang tertahan bukan sekadar urusan layanan pelanggan, tapi urusan arus kas — ongkos kirimnya sudah keluar, barangnya sudah keluar, dan uangnya belum tentu kembali.",
        ],
      },
      {
        h: "Kenapa masalah pengiriman selalu ketahuan terlambat",
        p: [
          "Karena tidak ada yang memeriksa resi satu per satu. Dengan sepuluh pesanan sehari mungkin masih sempat; dengan seratus, tidak ada yang melakukannya. Praktiknya, masalah baru ketahuan lewat satu dari dua jalan: pembeli mengeluh, atau paketnya sudah kembali ke gudang sebagai retur.",
          "Dua-duanya terlambat. Waktu pembeli yang mengeluh, kepercayaannya sudah rusak. Waktu paketnya sudah kembali, ongkos dua arah sudah hangus.",
        ],
      },
      {
        h: "Status yang perlu diwaspadai",
        p: [
          "Tidak semua status butuh perhatian. Yang benar-benar perlu ditandai ada empat kelompok:",
        ],
        ul: [
          "Tertahan — paket berhenti di satu titik lebih lama dari wajar. Ini yang paling sering berakhir jadi retur kalau didiamkan.",
          "Gagal kirim — kurir sudah mencoba mengantar dan tidak berhasil. Biasanya nomor tidak diangkat atau alamat tidak ketemu, dan keduanya masih bisa diselamatkan hari itu juga.",
          "Alamat bermasalah — perlu diperbaiki sebelum percobaan kirim berikutnya.",
          "Diretur — sudah dalam perjalanan kembali. Yang bisa dilakukan tinggal mencatat sebabnya supaya pola yang sama tidak berulang.",
        ],
      },
      {
        h: "Kenapa gagal kirim harus ditindak hari itu juga",
        p: [
          "Kurir umumnya mencoba mengantar beberapa kali sebelum memutuskan retur. Jarak antar-percobaan itulah satu-satunya jendela yang Anda punya.",
          "Kalau dalam jendela itu pembeli dihubungi — sekadar memastikan dia di rumah besok, atau membetulkan patokan alamat — sebagian besar paket yang tadinya menuju retur bisa selesai terkirim. Kalau jendela itu lewat, tidak ada lagi yang bisa dilakukan selain menanggung ongkos dua arah.",
          "Itu sebabnya pemantauan resi nilainya bukan pada laporannya, melainkan pada kecepatannya.",
        ],
      },
      {
        h: "Retur tidak akan nol, dan itu wajar",
        p: [
          "Sebagian pembeli memang berubah pikiran, salah alamat, atau memesan iseng. Tidak ada sistem yang menghapus itu, dan siapa pun yang menjanjikan retur nol pada COD sedang menjual harapan.",
          "Yang bisa dikerjakan adalah memastikan tidak ada paket bermasalah yang lewat tanpa ada yang tahu, dan setiap retur tercatat sebabnya — supaya kalau ternyata satu wilayah atau satu kurir menyumbang retur jauh lebih banyak, polanya terlihat sebelum jadi kerugian besar.",
        ],
      },
    ],
  },

  {
    slug: "follow-up-pembeli-yang-belum-membalas",
    judul: "Follow-up Pembeli yang Menggantung Chat Tanpa Terkesan Mengejar",
    ringkas:
      "Kenapa pembeli berhenti membalas, berapa lama sebaiknya menunggu, dan kenapa mengirim kalimat yang sama berulang kali justru mematikan peluangnya.",
    deskripsi:
      "Cara menindaklanjuti pembeli WhatsApp yang belum membalas: jeda yang masuk akal, kenapa kalimat follow-up harus berbeda-beda, dan kapan harus berhenti.",
    diperbarui: "2026-09-19",
    isi: [
      {
        h: null,
        p: [
          "Dari semua chat yang masuk lewat iklan, sebagian besar berhenti di tengah. Pembeli bertanya harga, dijawab, lalu hilang. Percakapan itu bukan penolakan — sering kali cuma perhatian yang teralih.",
        ],
      },
      {
        h: "Kenapa pembeli berhenti membalas",
        p: [
          "Alasannya jarang dramatis. Chat dibuka saat sedang bekerja lalu tertimbun notifikasi lain. Pembeli ingin membandingkan dulu. Atau dia menunggu gajian dan tidak enak mengatakannya.",
          "Yang jelas, hampir tidak ada yang kembali sendiri. Percakapan yang menggantung akan tetap menggantung kecuali ada yang menyapanya lagi.",
        ],
      },
      {
        h: "Jeda yang masuk akal",
        p: [
          "Follow-up terlalu cepat terasa mendesak dan membuat pembeli mundur. Terlalu lama, produknya sudah terlupakan atau sudah dibeli di tempat lain.",
          "Yang wajar: sapaan pertama beberapa jam setelah percakapan berhenti — masih di hari yang sama, ketika ingatannya belum hilang. Berikutnya diberi jarak lebih panjang, satu sampai beberapa hari. Setelah dua atau tiga kali tanpa jawaban, berhenti.",
        ],
      },
      {
        h: "Kenapa kalimatnya harus berbeda-beda",
        p: [
          "Inilah yang membedakan follow-up dari spam. Pesan \"halo kak, jadi order?\" yang dikirim tiga kali dengan kata yang persis sama membuat jelas bahwa tidak ada orang di balik layar, dan pembeli berhenti menganggapnya percakapan.",
          "Karena itu kalimatnya divariasikan, dan sebaiknya masing-masing membawa sesuatu yang baru — mengingatkan varian yang tadi dia tanyakan, menjawab keraguan yang paling sering muncul, atau sekadar memastikan pertanyaannya sudah terjawab. Follow-up yang berisi punya alasan untuk dibalas; follow-up kosong tidak.",
        ],
      },
      {
        h: "Kapan harus berhenti",
        p: [
          "Setelah dua atau tiga kali tanpa jawaban, peluangnya sudah sangat kecil dan risikonya mulai nyata: diblokir, atau dilaporkan sebagai spam. Nomor WhatsApp yang dilaporkan berulang kali bisa dibatasi, dan itu kerugian yang jauh lebih besar daripada satu pesanan yang lepas.",
          "Menghormati diam pembeli bukan kelemahan. Itu yang menjaga nomor Anda tetap bisa dipakai besok.",
        ],
      },
    ],
  },

  {
    slug: "otomatisasi-whatsapp-untuk-jualan-cod",
    judul: "Otomatisasi WhatsApp untuk Jualan COD lewat Iklan Meta",
    ringkas:
      "Gambaran menyeluruh: di mana chat menumpuk, bagian mana yang layak diotomatiskan, bagian mana yang tidak, dan apa yang perlu disiapkan lebih dulu.",
    deskripsi:
      "Gambaran menyeluruh otomatisasi WhatsApp untuk penjual COD yang beriklan di Meta Ads: bagian mana yang layak diotomatiskan, mana yang harus tetap ditangani orang, dan apa yang perlu disiapkan.",
    diperbarui: "2026-09-19",
    isi: [
      {
        h: null,
        p: [
          "Jualan COD lewat iklan Meta punya bentuk beban yang khas. Chat tidak datang rata sepanjang hari — ia datang berombak mengikuti jam tayang iklan. Satu jam bisa sepi, jam berikutnya empat puluh chat masuk berbarengan, dan semuanya menanyakan hal yang mirip.",
          "Menambah admin menyelesaikannya sebagian, tapi mahal dan tetap tidak menutup jam malam. Di sinilah otomatisasi masuk akal — asal jelas bagian mana yang diotomatiskan.",
        ],
      },
      {
        h: "Empat titik beban yang berulang",
        ol: [
          "Pertanyaan pembuka yang sama: masih ada? berapa? bisa COD? kirim ke mana?",
          "Pengumpulan data pesanan: nama, nomor, alamat — diketik ulang oleh admin ke catatan lain.",
          "Percakapan yang menggantung dan tidak ada yang menyusulnya.",
          "Status pengiriman yang tidak ada yang memeriksa sampai pembeli mengeluh.",
        ],
        p2: [
          "Keempatnya berulang, punya aturan yang jelas, dan tidak butuh pertimbangan. Itu ciri pekerjaan yang layak diotomatiskan.",
        ],
      },
      {
        h: "Yang sebaiknya tidak diotomatiskan",
        ul: [
          "Tawar-menawar. Keputusan uang, dan kesalahan di sini menimbulkan sengketa.",
          "Komplain berat. Pembeli yang sudah kecewa butuh tanda bahwa ada orang yang mendengarkan.",
          "Keputusan pengecualian — refund, ganti barang, kirim ulang.",
          "Apa pun yang jawabannya belum ada di materi produk Anda.",
        ],
      },
      {
        h: "Yang perlu disiapkan sebelum mulai",
        p: [
          "Urutannya penting, karena menyalakan otomatisasi di atas materi yang belum siap hanya memperbanyak jawaban yang salah:",
        ],
        ol: [
          "Hubungkan nomor WhatsApp yang sudah Anda pakai. Tidak perlu ganti nomor — pelanggan lama tidak perlu menyimpan nomor baru.",
          "Isi materi produk: daftar produk, varian, harga, ongkir, dan jawaban atas pertanyaan yang paling sering muncul.",
          "Tentukan gaya bicara dan aturan aman: sapaan, panjang balasan, jam kerja, dan topik yang harus selalu dialihkan ke manusia.",
          "Pantau hasilnya beberapa hari pertama, dan perbaiki materi setiap kali muncul jawaban yang meleset.",
        ],
      },
      {
        h: "Apa yang wajar diharapkan, dan apa yang tidak",
        p: [
          "Yang wajar diharapkan: balasan yang jauh lebih cepat pada jam ramai, pencatatan pesanan yang tidak bergantung pada ingatan admin, follow-up yang tidak terlewat, dan masalah pengiriman yang ketahuan lebih awal.",
          "Yang tidak wajar diharapkan: kenaikan penjualan sebagai akibat langsung. Penjualan ditentukan produk, harga, dan iklan Anda sendiri. Otomatisasi menghapus kebocoran di antara ketiganya — ia tidak menggantikan satu pun dari ketiganya.",
        ],
      },
    ],
  },
];

export const PETA_PANDUAN = Object.fromEntries(PANDUAN.map((p) => [p.slug, p]));
