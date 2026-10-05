/**
 * The scan service: what the website calls to run a free website check.
 *
 *   POST /scans          { scanId, url, label?, callbackUrl }  → 202 { scanId, position }
 *   GET  /scans/{scanId}                                        → the job's state and report
 *   GET  /health                                                → { ok: true }, unsigned
 *
 * Every other request carries X-SSA-Timestamp and X-SSA-Signature (see
 * service/signing.ts). Settings come from the environment:
 *
 *   SSA_WORKER_SECRET   shared with the website; refuses to start without it
 *   SSA_CALLBACK_HOST   the only host callbacks are sent to (smartscaleagent.com)
 *   SSA_QUEUE_MAX       scans allowed to wait, default 10
 *   SSA_NO_SANDBOX      1 to run Chrome without its sandbox (see browser.ts)
 *   PORT                default 8080
 *
 * Run it:  node src/server.ts
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { RefusedAddress } from "./service/guard.ts";
import { BadCallback, Jobs, QueueFull, type JobsOptions } from "./service/jobs.ts";
import { verify } from "./service/signing.ts";
import { TOOL_NAME, TOOL_VERSION } from "./types.ts";

const BODY_LIMIT = 16 * 1024;
const SCAN_ID = /^[A-Za-z0-9_-]{6,64}$/;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json), "cache-control": "no-store" });
  res.end(json);
}

export interface ServiceOptions extends JobsOptions {}

/** The HTTP server and its queue, not yet listening. */
export function createService(options: ServiceOptions): { server: Server; jobs: Jobs } {
  const jobs = new Jobs(options);
  const log = options.log ?? (() => {});

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, version: TOOL_VERSION });

      const body = await readBody(req);
      const refused = verify(options.secret, req.headers, body);
      if (refused) return send(res, 401, { ok: false, error: refused });

      if (req.method === "POST" && url.pathname === "/scans") {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(body);
        } catch {
          return send(res, 400, { ok: false, error: "body must be JSON" });
        }
        const { scanId, url: target, label, callbackUrl } = input;
        if (typeof scanId !== "string" || !SCAN_ID.test(scanId)) return send(res, 400, { ok: false, error: "scanId must be 6 to 64 letters, digits, - or _" });
        if (typeof target !== "string" || !target.trim()) return send(res, 400, { ok: false, error: "url is required" });
        if (typeof callbackUrl !== "string") return send(res, 400, { ok: false, error: "callbackUrl is required" });
        if (label !== undefined && typeof label !== "string") return send(res, 400, { ok: false, error: "label must be a string" });
        try {
          const { job, created } = await jobs.submit({ scanId, url: target.trim().slice(0, 500), label: label?.slice(0, 160), callbackUrl });
          return send(res, created ? 202 : 200, { scanId: job.scanId, status: job.status, position: job.position ?? 0 });
        } catch (e) {
          if (e instanceof QueueFull) return send(res, 429, { ok: false, error: "the scanner is busy; try again in a few minutes" });
          if (e instanceof RefusedAddress) return send(res, 422, { ok: false, error: e.message, reason: "unreachable" });
          if (e instanceof BadCallback) return send(res, 400, { ok: false, error: e.message });
          throw e;
        }
      }

      const m = url.pathname.match(/^\/scans\/([A-Za-z0-9_-]{6,64})$/);
      if (req.method === "GET" && m) {
        const job = jobs.get(m[1]);
        if (!job) return send(res, 404, { ok: false, error: "no such scan" });
        return send(res, 200, job);
      }

      return send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      log(`request failed: ${(e as Error).message}`);
      if (!res.headersSent) send(res, 500, { ok: false, error: "scan service error" });
    }
  });

  server.on("close", () => jobs.close());
  return { server, jobs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const secret = process.env.SSA_WORKER_SECRET;
  const callbackHost = process.env.SSA_CALLBACK_HOST;
  if (!secret || !callbackHost) {
    process.stderr.write("SSA_WORKER_SECRET and SSA_CALLBACK_HOST must be set. Refusing to start.\n");
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8080);
  const log = (m: string) => process.stderr.write(`${new Date().toISOString()} ${m}\n`);
  const { server, jobs } = createService({ secret, callbackHost, queueMax: Number(process.env.SSA_QUEUE_MAX ?? 10), log });
  server.listen(port, () => log(`${TOOL_NAME} service v${TOOL_VERSION} listening on ${port}; callbacks to ${callbackHost}`));
  const stop = () => {
    log("stopping");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // On Fly the machine must not be stopped from outside: the proxy only
  // sees open requests, so it stopped the machine in the middle of scans
  // nobody was watching (2026-10-05). The service decides for itself. After
  // a quiet spell with nothing running or waiting it exits, the machine
  // stops, and the next request starts it again.
  const idleSeconds = Number(process.env.SSA_IDLE_EXIT_SECONDS ?? 0);
  if (idleSeconds > 0) {
    let lastActive = Date.now();
    server.on("request", (req) => {
      if (!req.url?.startsWith("/health")) lastActive = Date.now();
    });
    setInterval(() => {
      if (jobs.busy) lastActive = Date.now();
      else if (Date.now() - lastActive > idleSeconds * 1000) {
        log(`idle for ${idleSeconds}s`);
        stop();
      }
    }, 5000).unref();
  }
}
