// Throwaway probe: write and fsync 256 MiB into os.tmpdir(), then time an RSA keygen via openssl.
import { execFileSync } from "node:child_process";
import { closeSync, fsyncSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "hf-disk-probe-"));
const chunk = Buffer.alloc(8 * 1024 * 1024, 7);
for (let round = 1; round <= 3; round++) {
  const t0 = Date.now();
  const fd = openSync(join(dir, `f${round}`), "w");
  for (let i = 0; i < 32; i++) writeSync(fd, chunk);
  fsyncSync(fd);
  closeSync(fd);
  const ms = Date.now() - t0;
  console.log(`DISK tmp=${tmpdir()} round=${round} 256MiB+fsync ${ms} ms (${Math.round(256000 / ms)} MiB/s)`);
}
for (let round = 1; round <= 5; round++) {
  const t0 = Date.now();
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=probe"], { stdio: "pipe" });
  console.log(`OPENSSL round=${round} ${Date.now() - t0} ms`);
}
rmSync(dir, { recursive: true, force: true });
