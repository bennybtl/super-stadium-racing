/**
 * Best-effort Safari / Apple-WebKit detection.
 *
 * Safari's WebGL implementation performs very poorly for this game (single-digit
 * FPS vs ~60 in Chromium), so the title screen warns Safari users.
 *
 * UA sniffing is imperfect but adequate here: Chrome/Edge/Firefox all include
 * "Safari" in their UA, and their iOS builds (CriOS/FxiOS/EdgiOS) run on WebKit
 * too — so we require Apple's vendor string AND the absence of every other known
 * browser marker.
 */
export function isSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";

  const isAppleVendor = vendor.includes("Apple");
  const looksLikeSafari = /Safari/.test(ua);
  const isOtherBrowser = /Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|Opera/.test(ua);

  return isAppleVendor && looksLikeSafari && !isOtherBrowser;
}
