"use strict";

// Compile only this owned N-API source with ALREADY installed Windows tools.
// No dependency downloads, environment edits or Blue/retail process startup.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
const execute = promisify(execFile), builds = new Map();
const source = path.join(__dirname, "native-clock", "windows_clock.c");
async function buildNativeClock({ cacheRoot = path.join(__dirname, "..", "data", "native-clock") } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Native client clock requires Windows x64.");
  const sourceBytes = fs.readFileSync(source), sourceSHA256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const digest = crypto.createHash("sha256").update(sourceBytes).update(`napi8-${process.arch}`).digest("hex");
  const directory = path.resolve(cacheRoot, digest), target = path.join(directory, "windows_clock.node");
  const identity = () => ({ target, sourceSHA256, bindingSHA256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex"), napi: 8 });
  const license = path.join(__dirname, "..", "src", "gamePort", "clientClock-LICENSE.txt");
  if (fs.existsSync(target)) { fs.copyFileSync(license, path.join(directory, "LICENSE.txt")); return identity(); }
  if (builds.has(target)) return builds.get(target);
  const work = (async () => {
    const cache = path.join(os.homedir(), "AppData", "Local", "node-gyp", "Cache", process.versions.node);
    const include = path.join(cache, "include", "node"), library = path.join(cache, "x64", "node.lib");
    if (!fs.existsSync(path.join(include, "node_api.h")) || !fs.existsSync(library)) throw new Error(`Installed Node headers/library are missing at ${cache}.`);
    const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (!fs.existsSync(vswhere)) throw new Error("Installed Visual Studio C++ discovery tool is missing.");
    const { stdout: found } = await execute(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { windowsHide: true });
    const installation = found.trim(), setup = path.join(installation, "Common7", "Tools", "VsDevCmd.bat");
    if (!installation || !fs.existsSync(setup)) throw new Error("An installed Visual Studio x64 C++ toolchain is required.");
    fs.mkdirSync(directory, { recursive: true });
    // Link in a private directory, then publish the completed DLL atomically:
    // another BFF must never require a half-written cached binding.
    const staging = fs.mkdtempSync(path.join(directory, "build-"));
    const builtTarget = path.join(staging, "windows_clock.node");
    const capturedSource = path.join(staging, "windows_clock.c");
    fs.writeFileSync(capturedSource, sourceBytes);
    fs.copyFileSync(license, path.join(directory, "LICENSE.txt"));
    // All interpolated paths are discovered fixed files/owned output. Refuse
    // cmd metacharacters/newlines rather than treating JSON quoting as escaping.
    const quote = value => { if (/["%\r\n&|<>^!]/.test(value)) throw new Error("Unsupported native-build path characters."); return `"${value}"`; };
    const script = path.join(staging, "build.cmd");
    const object = path.join(staging, "windows_clock.obj"), importLibrary = path.join(staging, "windows_clock.lib");
    const command = ["@echo off", `call ${quote(setup)} -arch=x64 -host_arch=x64 >nul`, "if errorlevel 1 exit /b 1", `cl.exe /nologo /O2 /LD /DNAPI_VERSION=8 /DNODE_GYP_MODULE_NAME=windows_clock /I${quote(include)} /Fo${quote(object)} ${quote(capturedSource)} /link /OUT:${quote(builtTarget)} /IMPLIB:${quote(importLibrary)} ${quote(library)}`, "exit /b %errorlevel%", ""].join("\r\n");
    fs.writeFileSync(script, command);
    try {
      const result = await execute("cmd.exe", ["/d", "/c", script], { windowsHide: true, cwd: staging, timeout: 120000, maxBuffer: 1024 * 1024 });
      fs.writeFileSync(path.join(directory, "build.log"), result.stdout + result.stderr);
    } catch (error) {
      fs.writeFileSync(path.join(directory, "build.log"), String(error.stdout || "") + String(error.stderr || ""));
      throw new Error(`Native client clock build failed; see ${path.join(directory, "build.log")}.`);
    }
    if (!fs.existsSync(builtTarget)) throw new Error("The native clock compiler produced no binding.");
    // A hard link is atomic and MUST NOT replace a concurrent winner. The
    // immutable published file is then the one both hash and require refer to.
    try { fs.linkSync(builtTarget, target); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    return identity();
  })();
  builds.set(target, work);
  try { return await work; } finally { if (builds.get(target) === work) builds.delete(target); }
}
module.exports = { buildNativeClock };
if (require.main === module) buildNativeClock().then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
