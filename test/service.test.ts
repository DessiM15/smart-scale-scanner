/**
 * The scan service: signing, the address guard, the queue, callbacks, and
 * one real scan through the HTTP interface against the fixture site.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { Chrome, DESKTOP, RefusedResponse } from "../src/browser.ts";
import { createService } from "../src/server.ts";
import { isPublicAddress, RefusedAddress, vetTarget } from "../src/service/guard.ts";
import { sign, signedHeaders, verify } from "../src/service/signing.ts";
import type { LeadReport } from "../src/types.ts";
import { startFixture } from "./fixture-server.ts";

const SECRET = "test-secret";

let fixture: Server;
let fixtureBase = "";

/** Collects signed callbacks the way the website would. */
let receiver: Server;
let receiverHost = "";
let receiverUrl = "";
let events: { scanId: string; event: string; step?: string; report?: LeadReport; failure?: { reason: string } }[] = [];

before(async () => {
  ({ server: fixture, base: fixtureBase } = await startFixture());
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const refused = verify(SECRET, req.headers, body);
      if (refused) {
        res.writeHead(401);
        return res.end(refused);
      }
      events.push(JSON.parse(body));
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  const port = (receiver.address() as { port: number }).port;
  receiverHost = `127.0.0.1:${port}`;
  receiverUrl = `http://${receiverHost}/api/wb/scan/callback`;
});
after(() => {
  fixture.close();
  receiver.close();
});

const listen = (server: Server) =>
  new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));

async function call(base: string, method: string, path: string, body = "", headers: Record<string, string> = signedHeaders(SECRET, body)) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : body });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const waitFor = async (test: () => boolean, ms = 60_000) => {
  const until = Date.now() + ms;
  while (!test()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("addresses: private, local and reserved ranges are not public", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "ff02::1", "not-an-ip"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "76.76.21.21", "172.32.0.1", "192.169.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test("vetTarget: refuses everything that is not a public website name", async () => {
  for (const input of ["localhost", "http://localhost/", "127.0.0.1", "http://10.0.0.1", "[::1]", "http://[::1]/", "example.com:8443", "ftp://example.com", "169.254.169.254", "metadata.google.internal", "intranet", "a.test", "user:pw@example.com", "not a url at all"]) {
    await assert.rejects(vetTarget(input), RefusedAddress, input);
  }
  const ok = await vetTarget("smartscaleagent.com");
  assert.equal(ok.base, "https://smartscaleagent.com");
  assert.ok(ok.addresses.length > 0 && ok.addresses.every(isPublicAddress));
});

test("signing: accepted, rejected, and expired", () => {
  const body = '{"a":1}';
  const headers = signedHeaders(SECRET, body);
  assert.equal(verify(SECRET, headers, body), null);
  assert.equal(verify(SECRET, headers, '{"a":2}'), "bad signature");
  assert.equal(verify("other", headers, body), "bad signature");
  assert.equal(verify(SECRET, {}, body), "missing signature");
  const old = String(Math.floor(Date.now() / 1000) - 600);
  assert.equal(verify(SECRET, { "x-ssa-timestamp": old, "x-ssa-signature": sign(SECRET, old, body) }, body), "expired signature");
});

test("browser: a response from a private address fails the navigation", async () => {
  const chrome = await Chrome.launch({ allowAddress: isPublicAddress });
  try {
    const page = await chrome.newPage(DESKTOP);
    await assert.rejects(page.goto(fixtureBase + "/", 200, 10_000), RefusedResponse);
    assert.equal(await page.evaluate("location.href"), "about:blank");
  } finally {
    await chrome.close();
  }
});

test("service: signatures, validation, idempotency, queue limit and callbacks", async () => {
  events = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fake: LeadReport = { version: 1, scanId: "", base: "https://example.com", label: "x", scannedAt: "", durationMs: 1, stack: "", pagesChecked: [], totals: { problems: 0, serious: 0 }, sections: [], top: [] };
  const { server, jobs } = createService({
    secret: SECRET,
    callbackHost: receiverHost,
    queueMax: 1,
    allowPrivate: true,
    runner: async (job, onStep) => {
      onStep("mobile");
      await gate;
      return { ...fake, scanId: job.scanId };
    },
  });
  const base = await listen(server);
  try {
    const good = JSON.stringify({ scanId: "s_first1", url: "example.com", callbackUrl: receiverUrl });

    assert.equal((await call(base, "GET", "/health", "", {})).status, 200);
    assert.equal((await call(base, "POST", "/scans", good, {})).status, 401);
    assert.equal((await call(base, "POST", "/scans", good, { "x-ssa-timestamp": "1", "x-ssa-signature": "nope" })).status, 401);
    assert.equal((await call(base, "POST", "/scans", "not json")).status, 400);
    assert.equal((await call(base, "POST", "/scans", JSON.stringify({ scanId: "bad id", url: "example.com", callbackUrl: receiverUrl }))).status, 400);
    assert.equal((await call(base, "POST", "/scans", JSON.stringify({ scanId: "s_other1", url: "example.com", callbackUrl: "http://evil.example/cb" }))).status, 400);

    const first = await call(base, "POST", "/scans", good);
    assert.equal(first.status, 202);
    assert.equal(first.json.scanId, "s_first1");
    const again = await call(base, "POST", "/scans", good);
    assert.equal(again.status, 200, "a repeated scanId does not start a second scan");

    // The first is running; one may wait; the next is refused.
    const second = await call(base, "POST", "/scans", JSON.stringify({ scanId: "s_second", url: "example.com", callbackUrl: receiverUrl }));
    assert.equal(second.status, 202);
    assert.equal(second.json.position, 1);
    const third = await call(base, "POST", "/scans", JSON.stringify({ scanId: "s_third1", url: "example.com", callbackUrl: receiverUrl }));
    assert.equal(third.status, 429);

    await waitFor(() => events.some((e) => e.scanId === "s_first1" && e.event === "progress"));
    release();
    await waitFor(() => events.filter((e) => e.event === "completed").length === 2);
    assert.deepEqual(events.filter((e) => e.scanId === "s_first1").map((e) => e.event), ["started", "progress", "completed"]);
    assert.equal(events.find((e) => e.scanId === "s_first1" && e.event === "completed")?.report?.scanId, "s_first1");

    const state = await call(base, "GET", "/scans/s_first1");
    assert.equal(state.status, 200);
    assert.equal(state.json.status, "completed");
    assert.equal(state.json.report.scanId, "s_first1");
    assert.equal((await call(base, "GET", "/scans/s_nobody")).status, 404);
    assert.equal((await call(base, "GET", "/scans/s_first1", "", {})).status, 401);
  } finally {
    jobs.close();
    server.close();
  }
});

test("service: a real scan of the fixture, by callback and by state", async () => {
  events = [];
  const { server, jobs } = createService({ secret: SECRET, callbackHost: receiverHost, allowPrivate: true });
  const base = await listen(server);
  try {
    const res = await call(base, "POST", "/scans", JSON.stringify({ scanId: "s_fixture", url: fixtureBase, label: "Fixture Cafe", callbackUrl: receiverUrl }));
    assert.equal(res.status, 202);
    await waitFor(() => events.some((e) => e.scanId === "s_fixture" && (e.event === "completed" || e.event === "failed")), 120_000);
    const done = events.find((e) => e.scanId === "s_fixture" && e.event !== "progress" && e.event !== "started")!;
    assert.equal(done.event, "completed", JSON.stringify(done.failure));
    assert.equal(done.report?.label, "Fixture Cafe");
    assert.ok(done.report!.totals.problems >= 10);
    assert.ok(events.some((e) => e.scanId === "s_fixture" && e.event === "progress" && e.step === "keyboard"));
    const state = await call(base, "GET", "/scans/s_fixture");
    assert.equal(state.json.status, "completed");
    assert.deepEqual(state.json.report.totals, done.report!.totals);
  } finally {
    jobs.close();
    server.close();
  }
});
