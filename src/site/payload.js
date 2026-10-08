// Decode an encrypted .enc payload. v1: base64 text of IV | AES-GCM(JSON) | tag.
// v2: 00 'A' 'X' 02 | IV | AES-GCM(gzip(JSON)) | tag, as raw bytes. The header
// sits outside the cipher, so the format is known before decrypting.
export const NEWER_FORMAT_MESSAGE = "This link was published by a newer AxiForge — refresh the page.";

export class PayloadVersionError extends Error {
  constructor(version) {
    super(`Unsupported payload version ${version}`);
    this.name = "PayloadVersionError";
    this.version = version;
  }
}

export function payloadVersion(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x41 && bytes[2] === 0x58) return bytes[3];
  return 1;
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function aesDecrypt(base64urlKey, iv, ciphertext) {
  const cryptoKey = await crypto.subtle.importKey("raw", base64urlDecode(base64urlKey), { name: "AES-GCM" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
}

export async function decodePayload(buffer, base64urlKey) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const version = payloadVersion(bytes);
  if (version === 1) {
    const text = new TextDecoder().decode(bytes).trim();
    const combined = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const plain = await aesDecrypt(base64urlKey, combined.slice(0, 12), combined.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  if (version !== 2) throw new PayloadVersionError(version);
  const plain = await aesDecrypt(base64urlKey, bytes.slice(4, 16), bytes.slice(16));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

export async function fetchPayload(url, base64urlKey, fetchImpl = fetch) {
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return decodePayload(await res.arrayBuffer(), base64urlKey);
}
