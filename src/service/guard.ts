/**
 * The service opens addresses strangers typed in a real browser, on a
 * machine that may sit next to other machines. Nothing here may reach a
 * private network, the machine itself, or a cloud metadata service.
 *
 * Two checks, because one is not enough:
 *   1. Before a scan, the hostname is resolved and every address it maps
 *      to must be public. The resolved address is then pinned in Chrome
 *      (--host-resolver-rules), so a name that changes its answer after
 *      the check (DNS rebinding) still lands on the vetted address.
 *   2. During the scan, the address every response came from is checked
 *      as it arrives, which covers redirects and embedded frames to other
 *      hosts. One private address fails the scan.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** IPv4 ranges that are never a public website. */
const PRIVATE_V4: [number, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([ip, bits]) => [v4ToInt(ip as string), bits as number]);

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function v4IsPublic(ip: string): boolean {
  const n = v4ToInt(ip);
  return PRIVATE_V4.every(([start, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) !== start;
  });
}

/** The 16 bytes of an IPv6 address, or null when it does not parse. */
export function v6ToBytes(ip: string): number[] | null {
  let text = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // An IPv4 tail (::ffff:10.0.0.1) becomes two hextets.
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToInt(v4[1]);
    text = text.slice(0, -v4[1].length) + ((n >>> 16).toString(16) + ":" + (n & 0xffff).toString(16));
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const hextets = [...head, ...Array(missing).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const h of hextets) {
    if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function v6IsPublic(ip: string): boolean {
  const b = v6ToBytes(ip);
  if (!b) return false;
  const allZeroThrough = (n: number) => b.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (allZeroThrough(15) && b[15] <= 1) return false;
  // ::ffff:a.b.c.d, an IPv4 address in IPv6 form: judge the IPv4 part.
  if (allZeroThrough(10) && b[10] === 0xff && b[11] === 0xff) return v4IsPublic(b.slice(12).join("."));
  // 64:ff9b::/96, NAT64: the IPv4 part again.
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return v4IsPublic(b.slice(12).join("."));
  // 100::/64 discard, 2001:db8::/32 documentation
  if (b[0] === 0x01 && b[1] === 0 && b.slice(2, 8).every((x) => x === 0)) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false;
  // fc00::/7 unique local, fe80::/10 link local, fec0::/10 site local, ff00::/8 multicast
  if ((b[0] & 0xfe) === 0xfc) return false;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return false;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return false;
  if (b[0] === 0xff) return false;
  return true;
}

/** True when the address could belong to a public website. Anything unparseable is not public. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4IsPublic(ip);
  if (kind === 6) return v6IsPublic(ip);
  return false;
}

/** Hostnames that only ever mean "this machine" or "this network". */
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|home|lan|intranet|corp|localdomain|test|example|invalid)$/i;

export class RefusedAddress extends Error {}

/**
 * Checks that a visitor's address is a public website, and returns the
 * site's origin with the addresses it resolved to.
 */
export async function vetTarget(input: string): Promise<{ base: string; host: string; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new RefusedAddress("That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RefusedAddress("Only http and https addresses can be checked.");
  if (url.port) throw new RefusedAddress("Addresses with a port number cannot be checked.");
  if (url.username || url.password) throw new RefusedAddress("Addresses with a username cannot be checked.");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, ""))) throw new RefusedAddress("Use the site's name, not an IP address.");
  if (!host.includes(".") || LOCAL_NAMES.test(host)) throw new RefusedAddress("That is not a public website address.");

  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, order: "verbatim" });
  } catch {
    throw new RefusedAddress("That address does not exist.");
  }
  const addresses = records.map((r) => r.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new RefusedAddress("That address is not on the public internet.");
  return { base: `${url.protocol}//${host}`, host, addresses };
}
