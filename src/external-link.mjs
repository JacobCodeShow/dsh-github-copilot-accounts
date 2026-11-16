import { execFile } from "node:child_process";
import { join } from "node:path";

export class VerificationLinkError extends Error {
  constructor(message = "Cannot open verification link") { super(message); this.name = "VerificationLinkError"; this.code = "VERIFICATION_LINK_FAILED"; }
}
export function verificationLink(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f"'`<>]/.test(value)) throw new VerificationLinkError("Invalid verification URL");
  let url;
  try { url = new URL(value); } catch { throw new VerificationLinkError("Invalid verification URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !(url.hostname === "github.com" || url.hostname.endsWith(".ghe.com"))) throw new VerificationLinkError("Invalid verification URL");
  return url.href;
}
// argv-only OS opener for a validated OAuth verification URL. Never concatenate
// a command string, invoke a shell or print an error containing that URL.
export function openVerificationLink(value, { run = execFile, platform = process.platform,
  windowsRoot = process.env.SystemRoot ?? "C:\\Windows" } = {}) {
  const url = verificationLink(value);
  const [file, args] = platform === "win32"
    ? [join(windowsRoot, "System32", "rundll32.exe"), ["url.dll,FileProtocolHandler", url]]
    : platform === "darwin" ? ["/usr/bin/open", ["--", url]] : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    try { run(file, args, { windowsHide: true, shell: false }, (error) => error ? reject(new VerificationLinkError()) : resolve()); }
    catch { reject(new VerificationLinkError()); }
  });
}
