# Canonical installer screen flow

`01 Detect → 02 Select → 03 Configure → 04 Review / Apply → 05 Finish`

1. **Detect:** tampilkan platform/runtime, discovery provider read-only, compatibility, dan feedback selama subprocess inventory berjalan. Tidak ada perubahan instalasi.
2. **Select:** provider supported boleh dipilih semua, subset, recommended, atau kosong. Preset Minimal/Recommended/Full/Custom berasal dari catalog komponen aktual, bukan gambar konsep.
3. **Configure:** komponen Custom, scope provider yang didukung, dan root yang relevan ditampilkan sebelum plan. Pemilihan komponen/provider tidak memberi izin di luar kontrak installer.
4. **Review / Apply:** plan backend read-only memuat state, ownership, target, action dan prerequisite. Konfirmasi mengikat fingerprint. Perubahan state mewajibkan review ulang. Setelah Apply, panel utama berubah menjadi progres komponen dan aktivitas backend; tidak ada persentase/durasi fiktif.
5. **Finish:** jalankan kembali inspeksi state dan verifikasi backend. PASS membutuhkan exit installer 0, verifikasi 0, serta komponen terpilih sehat. Tampilkan receipt, versi/outcome, log, restart-required bila relevan, dan perintah verify/update/selective uninstall.

Planning gagal: tandai FAILED, simpan diagnostic lengkap, dan jangan Apply. Instalasi gagal/terputus: stop indikator aktif, pertahankan state/evidence dan tampilkan recovery; jangan mengklaim rollback atomik bila backend hanya mendukung pemulihan parsial. Kegagalan verifikasi tidak boleh menjadi success receipt meskipun exit install 0.

Plain/non-ANSI memakai state dan konfirmasi yang sama dengan presentasi teks. Mode scripted dengan preset/flags tetap noninteraktif sesuai kontrak CLI. Konfigurasi provider yang dilewati harus tetap dilewati pada tahap verifikasi.
