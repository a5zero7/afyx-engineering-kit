# AFYX Engineering Kit — Installer UX v2

Kontrak ini menggantikan arahan visual installer pada `docs/design/AFYX_ENGINEERING_KIT_INSTALLER_DESIGN_SYSTEM_v1.md`. Dokumen dan konsep v1 tetap merupakan rekaman historis. Acuan v2 adalah gambar owner `AFYX Engineering Kit Installer UI.png`; angka, ETA, persentase, nama komponen ilustratif, dan status pada gambar bukan fakta produk.

Satu renderer Node.js melayani interaksi `npx afyx-engineering-kit install` di seluruh shell. PowerShell dan Bash adalah adapter eksekusi; keduanya tidak memilih desain TUI berdasarkan shell induk. Native scripts tetap menyediakan kontrak plan/verifikasi dan jalur noninteraktif.

- Identitas: **AFYX / ENGINEERING KIT**, versi package dan platform/runtime aktual.
- Warna: cyan fokus/brand (#22D3EE), biru aktivitas (#60A5FA), violet aksen sekunder (#8B5CF6), hijau operasi selesai (#34D399), amber peringatan/restart (#FBBF24), merah kegagalan (#FB7185). Terminal true-color menggunakan token RGB; lainnya menggunakan ANSI 16 warna. Status selalu memiliki teks; warna bukan satu-satunya indikator.
- Lebar mencukupi: dua kolom, provider di kiri, panel sesuai tahap di kanan dengan aktivitas ringkas. Tidak ada tiga kolom sama lebar atau panel kosong yang dipaksa memenuhi tinggi terminal.
- Lebar sedang/sempit: konten ditumpuk atau dipadatkan tanpa kehilangan kontrol; terminal yang tidak mendukung ANSI memakai wizard teks Node yang sama, pilihan bernomor, dan outcome backend yang sama.
- Inventory diurutkan alfabetis per kelompok supported/other detected. Produk CLI, IDE/Desktop, extension ditampilkan bersarang. Detected tidak berarti configured/healthy; produk unsupported diberi COMING SOON dan tidak selectable.
- Arrow keys memilih/scroll, Tab memindahkan fokus, Space men-toggle, Enter mengonfirmasi, Esc kembali/batal, Ctrl+C menginterupsi. Resize tidak mereset pilihan.
- Frame memiliki batas dimensi, scrollbar/indikasi overflow, sanitasi kontrol terminal dalam data, dan redraw hanya pada baris berubah. Detail lengkap disimpan dalam log, bukan ditumpahkan sebagai stack JavaScript di layar.

Snapshot lintas OS harus berasal dari commit dan capability terminal yang sama. Normalisasi hanya platform, path, versi, waktu aktual, dan inventory fixture. Screenshot konsep bukan acceptance eksekusi. Tidak ada klaim Windows Terminal/macOS native sebelum benar-benar dijalankan.
