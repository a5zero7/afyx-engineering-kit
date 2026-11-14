# Installer progress protocol v1

Transport backend opt-in: satu baris `AFYX_PROGRESS ` diikuti objek JSON. Plan JSON `AfyxInstallPlan/v1` dan verification `AfyxVerification/v1` tetap kompatibel; progress bukan pengganti kedua kontrak tersebut.

Fields: `contract: AfyxInstallerProgress/v1`, `operationId`, `componentId` (null untuk global), `phase`, `state`, `completed`, `total`, `message`, `timestamp`, dan `errorCode` (null bila tidak ada).

- Phase: discovery, validation, planning, revalidation, download, extract, install, update, repair, configure, verify, cleanup, rollback, receipt.
- State: queued, running, completed, failed, cancelled. Identitas operation stabil sepanjang pekerjaan yang sama. Event emitted ketika pekerjaan benar-benar dimulai/selesai/gagal.
- `completed`/`total` boleh null. Bila ada, keduanya finite nonnegative dan `total > 0`, `completed <= total`. Persentase dihitung dari unit itu saja; tidak ada ETA tanpa estimator yang terukur.
- Tanpa total: rail/spinner bertanda INDETERMINATE dan elapsed monotonic aktual. Tidak ada asumsi bahwa animasi menjamin sukses.
- Backend operation completed berarti operasi tersebut selesai, **bukan** final installation verified. Final PASS tetap memerlukan receipt backend dan healthy desired components.
- Discovery, plan dan verify subprocess harus asinkron agar feedback tetap hidup. Renderer dibatasi maksimal 12,5 refresh/detik, redraw incremental, tanpa busy-wait. `AFYX_REDUCED_MOTION=1` menonaktifkan animasi, bukan feedback transisi. Plain mode mencetak event transisi tanpa frame animasi berulang.
- Progress input divalidasi; event malformed tidak boleh memberi status sukses atau mengubah izin. Raw stdout/stderr dan error lengkap tetap ada dalam log private. Timeline layar menyimpan event bermakna secara bounded.
- Pada exit nonzero/cancel, operasi aktif menjadi failed/cancelled dan timer dihentikan. Tidak ada timer tertinggal pada success, failure, EOF, atau Ctrl+C.

Reduced-motion menggunakan rail statis dan pembaruan elapsed maksimal sekali per detik. Mode normal dibatasi 80 ms per refresh; tidak ada busy-wait.

Coverage saat ini: Node melaporkan discovery, planning, revalidation, pemeriksaan state, verify dan receipt. Adapter native melaporkan awal/akhir/gagal instalasi skill dan operasi Graph/Context/Forge/Usage Tracking. Operasi runtime tetap indeterminate selama pekerjaan internal (termasuk download/extract/configure); belum ada penghitung byte atau event subphase granular untuk semua komponen. Jumlah komponen selesai hanya berasal dari event operasi install/update/repair, bukan elapsed time. Provider discovery tidak membuktikan real-agent acceptance.

Coverage nyata dan gap per phase dicatat pada evidence acceptance; operasi yang tidak menyediakan unit reliabel tetap indeterminate. Jangan menyamakan event simulasi dengan real OS/provider acceptance.
