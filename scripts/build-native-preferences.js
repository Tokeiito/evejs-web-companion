"use strict";

const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
const execute = promisify(execFile), builds = new Map();
const sources = ["python_runtime.c", "atomic_files.c", "atomic_files.h"];
async function buildNativePreferences({ cacheRoot = path.join(__dirname, "..", "data", "native-preferences", "bindings") } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Native client preferences require Windows x64.");
  // Capture every compilation input before the first await. Build and hash
  // that snapshot; another session changing a source cannot change its identity.
  const captured = sources.map(name => [name, fs.readFileSync(path.join(__dirname, "native-prefs", name))]);
  const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  const digest = hash(Buffer.concat(captured.flatMap(([name, bytes]) => [Buffer.from(name + "\0"), bytes, Buffer.from("\0")]).concat(Buffer.from(`napi8-${process.arch}`))));
  const directory = path.resolve(cacheRoot, digest), target = path.join(directory, "client_preferences.node");
  const identity = () => ({ target, sources: captured.map(([name, bytes]) => ({ name, sha256: hash(bytes) })), bindingSHA256: hash(fs.readFileSync(target)), napi: 8 });
  const license = fs.readFileSync(path.join(__dirname, "..", "src", "gamePort", "clientPreferences-LICENSE.txt"));
  if (fs.existsSync(target)) { fs.writeFileSync(path.join(directory, "LICENSE.txt"), license); return identity(); }
  if (builds.has(target)) return builds.get(target);
  const work = (async () => {
    const cache = path.join(os.homedir(), "AppData", "Local", "node-gyp", "Cache", process.versions.node);
    const include = path.join(cache, "include", "node"), library = path.join(cache, "x64", "node.lib");
    if (!fs.existsSync(path.join(include, "node_api.h")) || !fs.existsSync(library)) throw new Error(`Installed Node headers/library are missing at ${cache}.`);
    const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (!fs.existsSync(vswhere)) throw new Error("Installed Visual Studio C++ discovery tool is missing.");
    const { stdout } = await execute(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { windowsHide: true });
    const installation = stdout.trim(), setup = path.join(installation, "Common7", "Tools", "VsDevCmd.bat");
    if (!installation || !fs.existsSync(setup)) throw new Error("An installed Visual Studio x64 C++ toolchain is required.");
    fs.mkdirSync(directory, { recursive: true });
    const staging = fs.mkdtempSync(path.join(directory, "build-"));
    for (const [name, bytes] of captured) fs.writeFileSync(path.join(staging, name), bytes);
    fs.writeFileSync(path.join(directory, "LICENSE.txt"), license);
    const quote = value => { if (/["%\r\n&|<>^!]/.test(value)) throw new Error("Unsupported native-build path characters."); return `"${value}"`; };
    const script = path.join(staging, "build.cmd"), built = path.join(staging, "client_preferences.node");
    const command = ["@echo off", `call ${quote(setup)} -arch=x64 -host_arch=x64 >nul`, "if errorlevel 1 exit /b 1", `cl.exe /nologo /O2 /LD /DNAPI_VERSION=8 /DNODE_GYP_MODULE_NAME=client_preferences /I${quote(include)} ${quote(path.join(staging, "python_runtime.c"))} ${quote(path.join(staging, "atomic_files.c"))} /link /OUT:${quote(built)} /IMPLIB:${quote(path.join(staging, "client_preferences.lib"))} ${quote(library)}`, "exit /b %errorlevel%", ""].join("\r\n");
    fs.writeFileSync(script, command);
    try {
      const result = await execute("cmd.exe", ["/d", "/c", script], { windowsHide: true, cwd: staging, timeout: 120000, maxBuffer: 1024 * 1024 });
      fs.writeFileSync(path.join(staging, "build.log"), result.stdout + result.stderr);
    } catch (error) {
      fs.writeFileSync(path.join(staging, "build.log"), String(error.stdout || "") + String(error.stderr || ""));
      throw new Error(`Native client preference build failed; see ${path.join(staging, "build.log")}.`);
    }
    if (!fs.existsSync(built)) throw new Error("The native preference compiler produced no binding.");
    try { fs.linkSync(built, target); } catch (error) { if (error.code !== "EEXIST") throw error; }
    return identity();
  })();
  builds.set(target, work);
  try { return await work; } finally { if (builds.get(target) === work) builds.delete(target); }
}
module.exports = { buildNativePreferences };
if (require.main === module) buildNativePreferences().then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
