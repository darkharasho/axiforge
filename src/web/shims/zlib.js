// Browser stand-in for the tiny subset of node:zlib that @axiapps/code/fileCodec
// uses (gzipSync/gunzipSync). Backed by pako. Returns Buffer (Buffer is polyfilled
// in the web entry, see src/web/main-web.js).
import { gzip, ungzip } from "pako";

export function gzipSync(buf) {
  return Buffer.from(gzip(buf instanceof Uint8Array ? buf : Buffer.from(buf)));
}
export function gunzipSync(buf) {
  return Buffer.from(ungzip(buf instanceof Uint8Array ? buf : Buffer.from(buf)));
}
export default { gzipSync, gunzipSync };
