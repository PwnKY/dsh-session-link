// Contract test for the two Windows helpers around the dsh:// scheme:
// `dsh-open.cmd` resolves the Web base URL (env override -> state file ->
// 3080 fallback) and `register-protocol.ps1` refuses to steal a foreign
// handler without -Force. The static assertions run everywhere; the batch
// probe runs on Windows only.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
}

const launcher = readFileSync(new URL("./dsh-open.cmd", import.meta.url), "utf8");
const register = readFileSync(new URL("./register-protocol.ps1", import.meta.url), "utf8");

// --- static: the resolution chain and the conflict guard live in the files ---
check("launcher accepts the env override", launcher.includes("DSH_SESSION_LINK_WEB_URL"));
check("launcher reads the state file", launcher.includes("web-url") && launcher.includes("DSH_SESSION_LINK_STATE_DIR"));
check("launcher keeps the 3080 fallback", launcher.includes("http://127.0.0.1:3080"));
check("launcher opens the index route", launcher.includes('"%base%/?session=%id%"'));
check("launcher only accepts dsh://session/ links", launcher.includes('if not "%u:~0,14%"=="dsh://session/"'));
check("registration script exposes -Force", /\[switch\]\$Force/.test(register));
check("registration script inspects the existing handler", register.includes("shell\\open\\command"));
check("registration script refuses a foreign handler", register.includes("Refusing to overwrite"));
check("registration script keeps -Uninstall", /\[switch\]\$Uninstall/.test(register));

// --- Windows probe: run the real batch with `start` swapped for an echo ---
if (process.platform !== "win32") {
  console.log("SKIP  launcher probe (Windows only)");
} else {
  const root = mkdtempSync(join(tmpdir(), "dshsl-launcher-"));
  const stateDir = join(root, "state");
  const tempDir = join(root, "temp");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  const probe = join(root, "dsh-open.cmd");
  // CRLF keeps `call :label` reliable; `start` becomes an echo we can read.
  writeFileSync(probe, launcher.replace(/^start .*$/mu, "echo TARGET=%base%/?session=%id%").replace(/\r?\n/g, "\r\n"), "utf8");

  const baseEnv = { ...process.env, TEMP: tempDir, TMP: tempDir, DSH_SESSION_LINK_STATE_DIR: stateDir };
  delete baseEnv.DSH_SESSION_LINK_WEB_URL;

  function run(url, env = {}) {
    // Bare file name (cwd is the probe dir) keeps cmd's quote handling out of
    // the way; the URL is passed verbatim-quoted exactly as the registry
    // invokes the launcher.
    const result = spawnSync("cmd.exe", ["/d", "/c", `dsh-open.cmd "${url}"`], {
      cwd: root,
      encoding: "utf8",
      windowsVerbatimArguments: true,
      env: { ...baseEnv, ...env }
    });
    return (result.stdout ?? "").trim();
  }
  function lastLog() {
    try {
      return readFileSync(join(tempDir, "dsh-open.log"), "utf8").trim().split(/\r?\n/).at(-1);
    } catch {
      return "";
    }
  }

  const url = "dsh://session/session-abc123";
  const expected = (base) => `TARGET=${base}/?session=session-abc123`;

  check("probe: no state file falls back to 3080", run(url) === expected("http://127.0.0.1:3080"));
  check("probe: fallback logs source=default", lastLog().includes("source=default"));

  writeFileSync(join(stateDir, "web-url"), "http://127.0.0.1:3198/\r\n2026-10-13T00:00:00.000Z\r\n", "utf8");
  check("probe: state file wins and drops the trailing slash", run(url) === expected("http://127.0.0.1:3198"));
  check("probe: file run logs source=file", lastLog().includes("source=file"));

  writeFileSync(join(stateDir, "web-url"), "http://127.0.0.1:3199\n2026-10-13T00:00:00.000Z\n", "utf8");
  check("probe: LF-only state file still resolves", run(url) === expected("http://127.0.0.1:3199"));

  check("probe: env override wins over the state file", run(url, { DSH_SESSION_LINK_WEB_URL: "http://127.0.0.1:4444" }) === expected("http://127.0.0.1:4444"));
  check("probe: env run logs source=env", lastLog().includes("source=env"));

  writeFileSync(join(stateDir, "web-url"), "not-a-url\n", "utf8");
  check("probe: garbage state file falls back to 3080", run(url) === expected("http://127.0.0.1:3080"));
  check("probe: garbage run logs source=default-invalid", lastLog().includes("source=default-invalid"));

  check("probe: unrelated dsh:// links are ignored", run("dsh://settings/theme") === "");
  check("probe: ignored link is logged", lastLog().includes("ignored=dsh://settings/theme"));

  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
