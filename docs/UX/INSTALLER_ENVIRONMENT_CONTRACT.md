# Identitas environment installer

`AfyxInstallerEnvironment/v1` dibaca oleh renderer Node yang sama untuk seluruh platform. State dan versi sumber disimpan bersama semua baris pemeriksaan pada `verification.json`.

- OS: Windows memakai caption/version Win32_OperatingSystem; Linux membaca PRETTY_NAME dari /etc/os-release; macOS memakai sw_vers. Architecture berasal dari proses Node. WSL ditampilkan sebagai subsystem, bukan sebagai Windows.
- Invoking shell: observasi ancestor proses yang benar-benar menjalankan CLI. Wrapper CMD /c dilewati; CMD interaktif tetap dikenali. Versi diambil dari executable teramati. SHELL dan ComSpec tidak membuktikan shell pemanggil.
- Terminal: TERM_PROGRAM (termasuk VS Code, iTerm2, Terminal.app) atau WT_SESSION ketika tersedia. Tidak ada inferensi terminal dari OS atau shell. Data yang tidak dapat diamati tetap Unknown.
- Backend: executable/version yang tersedia ditampilkan terpisah; setelah plan/verify, executable aktual dicatat. Pergantian backend tidak mewarisi nomor versi executable sebelumnya.
- Package: versi dibaca dari package.json. Arsip terpasang memakai marker sumber tepat. Checkout memakai HEAD dari metadata Git miliknya dan menampilkan `+` bila dirty; repository ancestor tidak boleh mengklaim identitas package tanpa marker.

Entrypoint native tanpa opsi, dalam terminal interaktif dan dengan Node tersedia, meneruskan ke `bin/afyx-engineering-kit.mjs install`. Opsi script eksplisit dan automation noninteraktif mempertahankan kontrak backend. Formatter PowerShell tetap melayani status/prerequisite dan jalur native tanpa Node; tidak menjadi wizard default kedua ketika renderer Node tersedia. Recursive dispatch dicegah oleh opsi backend dan AFYX_INSTALL_UI_OWNER.

Header dan panel memakai struktur UX v2 yang sama, dengan wrapping/scroll dan plain fallback. OS, invoking shell, terminal, serta backend memiliki arti berbeda; provider yang terdeteksi tidak otomatis dianggap terkonfigurasi atau sehat. Aktivitas deteksi, plan, dan verify menggunakan indeterminate progress serta elapsed terukur, bukan persentase rekaan.

Penerimaan lintas platform menggunakan satu commit dan tarball. Identitas shell nyata diuji terpisah dari fixture parser; shell yang tidak tersedia diberi SKIP. Unknown pada runner tanpa penanda terminal adalah hasil yang benar, bukan alasan untuk menebak aplikasi terminal.
