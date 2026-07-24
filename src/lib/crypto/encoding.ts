/** Encoding helpers used across the crypto stack. Browser + server safe. */

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  if (typeof btoa !== "undefined") return btoa(s);
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(input: string): Uint8Array {
  if (typeof atob !== "undefined") {
    const s = atob(input);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(input, "base64"));
}

/** RFC 4648 base64url without padding — the native Rust host's wire format. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Decode RFC 4648 base64url with or without padding. */
export function fromBase64Url(input: string): Uint8Array {
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  return fromBase64(padded);
}

/** Postgres bytea hex format: '\x' + hex. */
export function toPgHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return "\\x" + hex;
}

export function fromPgHex(input: string): Uint8Array {
  const hex = input.startsWith("\\x") ? input.slice(2) : input;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function fromMaybeBytea(input: string | Uint8Array | null | undefined): Uint8Array | null {
  if (input == null) return null;
  if (input instanceof Uint8Array) return input;
  if (typeof input === "string") {
    if (input.startsWith("\\x")) return fromPgHex(input);
    return fromBase64(input);
  }
  return null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = {
  encode: (s: string) => enc.encode(s),
  decode: (b: Uint8Array) => dec.decode(b),
};

/** Constant-time equality. */
export function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
