/**
 * A very small Chrome driver over the DevTools Protocol.
 *
 * Why not Puppeteer or Playwright: they are 300MB of dependencies to do
 * the six things this scanner needs (open a page, resize it, run script,
 * press Tab, emulate a media feature, take a screenshot). Node 22 ships a
 * WebSocket client, macOS and most servers ship a Chrome, and the protocol
 * is stable. Fewer moving parts means the scan runs the same on a laptop,
 * a cron box, and a serverless job.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.SSA_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/chrome",
].filter((p): p is string => Boolean(p));

export function findChrome(): string {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "No Chrome found. Install Google Chrome or set SSA_CHROME to the browser executable.",
    );
  }
  return found;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CdpMessage = { id?: number; method?: string; params?: unknown; sessionId?: string; result?: any; error?: { message: string } };

export interface Viewport {
  width: number;
  height: number;
  mobile: boolean;
}

/** A response came from an address the launch options refuse (a private network, the machine itself). */
export class RefusedResponse extends Error {}

/** What a navigation produced. `loadMs` is null when the load event never fired inside the timeout. */
export interface NavResult {
  status: number | null;
  mimeType: string;
  loadMs: number | null;
  /** Bytes over the wire for everything fetched up to the end of the settle period. */
  bytes: number;
}

export interface LaunchOptions {
  /** Pass --no-sandbox. Defaults to the SSA_NO_SANDBOX environment variable. */
  noSandbox?: boolean;
  /** Chrome's --host-resolver-rules value, to pin a hostname to a vetted address. */
  hostResolverRules?: string;
  /** Appended to Chrome's own user agent, so a site owner can see who visited. */
  userAgentSuffix?: string;
  /**
   * Called with the address each response came from. Return false to
   * refuse it: the navigation fails and the page is not read.
   */
  allowAddress?: (ip: string, url: string) => boolean;
}

export const DESKTOP: Viewport = { width: 1366, height: 900, mobile: false };
export const MOBILE: Viewport = { width: 390, height: 844, mobile: true };
/** 320px wide is what a 1280px desktop looks like at 400% zoom: the WCAG reflow test. */
export const REFLOW: Viewport = { width: 320, height: 800, mobile: false };

export class Chrome {
  private readonly proc: ChildProcess;
  private readonly ws: WebSocket;
  private readonly profileDir: string;

  /** The full user agent pages send, when a suffix was asked for. */
  userAgent: string | undefined;

  private constructor(proc: ChildProcess, ws: WebSocket, profileDir: string, options: LaunchOptions) {
    this.proc = proc;
    this.ws = ws;
    this.profileDir = profileDir;
    this.options = options;
  }

  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: CdpMessage) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Map<string, Set<(params: any) => void>>();

  /** Set per browser at launch; pages read them. */
  readonly options: LaunchOptions;

  static async launch(options: LaunchOptions = {}): Promise<Chrome> {
    const exe = findChrome();
    const profileDir = mkdtempSync(join(tmpdir(), "ssa-chrome-"));
    // The sandbox stays on unless asked otherwise: a scan opens strangers'
    // pages. Set SSA_NO_SANDBOX=1 where the sandbox cannot run (a container
    // without user namespaces, or running as root).
    const noSandbox = options.noSandbox ?? process.env.SSA_NO_SANDBOX === "1";
    const proc = spawn(
      exe,
      [
        "--headless=new",
        "--disable-gpu",
        ...(noSandbox ? ["--no-sandbox"] : []),
        ...(options.hostResolverRules ? [`--host-resolver-rules=${options.hostResolverRules}`] : []),
        "--hide-scrollbars",
        "--mute-audio",
        "--no-first-run",
        "--disable-extensions",
        // Port 0 lets Chrome pick a free port and write it to the profile
        // folder, so two scans (or two browsers in one scan) never collide.
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDir}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    let wsUrl = "";
    // Up to 30 seconds: on a machine that has just woken from a stop, the
    // first Chrome start reads the whole binary from a cold disk and takes
    // about 12 seconds (measured on Fly, shared-cpu-2x). Warm, it is under one.
    for (let i = 0; i < 120 && !wsUrl; i++) {
      try {
        const port = Number(readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").split("\n")[0]);
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        wsUrl = (await r.json()).webSocketDebuggerUrl;
      } catch {
        await sleep(250);
      }
    }
    if (!wsUrl) {
      proc.kill();
      throw new Error("Chrome started but never answered on the debugging port.");
    }
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not connect to Chrome."));
    });
    const chrome = new Chrome(proc, ws, profileDir, options);
    ws.onmessage = (ev) => chrome.onMessage(JSON.parse(String(ev.data)));
    // A scanned page must never leave a file behind.
    await chrome.send("Browser.setDownloadBehavior", { behavior: "deny" });
    if (options.userAgentSuffix) {
      const { userAgent } = await chrome.send("Browser.getVersion");
      chrome.userAgent = `${userAgent} ${options.userAgentSuffix}`;
    }
    return chrome;
  }

  private onMessage(m: CdpMessage) {
    if (m.id !== undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m);
      return;
    }
    if (m.method) {
      const key = `${m.sessionId ?? ""}:${m.method}`;
      this.listeners.get(key)?.forEach((fn) => fn(m.params));
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (m) => resolve(m.result), reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(sessionId: string, method: string, fn: (params: any) => void): () => void {
    const key = `${sessionId}:${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }

  async newPage(viewport: Viewport): Promise<Page> {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    if (this.userAgent) await page.send("Network.setUserAgentOverride", { userAgent: this.userAgent });
    await page.setViewport(viewport);
    return page;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    this.proc.kill();
    await sleep(200);
    try {
      rmSync(this.profileDir, { recursive: true, force: true });
    } catch {}
  }
}

export class Page {
  private readonly chrome: Chrome;
  readonly targetId: string;
  readonly sessionId: string;

  constructor(chrome: Chrome, targetId: string, sessionId: string) {
    this.chrome = chrome;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return this.chrome.send(method, params, this.sessionId);
  }

  async setViewport(v: Viewport) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: v.width,
      height: v.height,
      deviceScaleFactor: 1,
      mobile: v.mobile,
    });
    if (v.mobile) {
      await this.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    }
  }

  /** Emulate `prefers-reduced-motion: reduce` (or clear it with null). */
  async setReducedMotion(reduce: boolean) {
    await this.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
    });
  }

  /**
   * Navigate and wait for the load event, then a settle period for the
   * animations and lazy content that real visitors also wait through.
   */
  async goto(url: string, settleMs = 4000, timeoutMs = 30000): Promise<NavResult> {
    let status: number | null = null;
    let mimeType = "";
    let bytes = 0;
    let loadMs: number | null = null;
    let refused: string | null = null;
    const allow = this.chrome.options.allowAddress;
    const offResp = this.chrome.on(this.sessionId, "Network.responseReceived", (p) => {
      const ip = p?.response?.remoteIPAddress;
      if (allow && ip && !allow(String(ip).replace(/^\[|\]$/g, ""), String(p.response?.url ?? ""))) {
        refused = refused ?? String(p.response?.url ?? ip).slice(0, 120);
        // Stop reading from a place the scan must not see.
        this.send("Page.stopLoading").catch(() => {});
      }
      if (p?.type === "Document" && status === null) {
        status = p.response?.status ?? null;
        mimeType = p.response?.mimeType ?? "";
      }
    });
    const offBytes = this.chrome.on(this.sessionId, "Network.loadingFinished", (p) => {
      bytes += Number(p?.encodedDataLength) || 0;
    });
    await this.send("Network.enable");
    const started = Date.now();
    const loaded = new Promise<void>((resolve) => {
      const off = this.chrome.on(this.sessionId, "Page.loadEventFired", () => {
        off();
        loadMs = Date.now() - started;
        resolve();
      });
    });
    const nav = await this.send("Page.navigate", { url });
    if (nav?.errorText) {
      offResp();
      offBytes();
      throw new Error(`Navigation failed: ${nav.errorText}`);
    }
    await Promise.race([loaded, sleep(timeoutMs)]);
    await sleep(settleMs);
    offResp();
    offBytes();
    if (refused) {
      await this.send("Page.navigate", { url: "about:blank" }).catch(() => {});
      throw new RefusedResponse(refused);
    }
    return { status, mimeType, loadMs, bytes };
  }

  /** Run an expression in the page and return its JSON value. Promises are awaited. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 90000,
    });
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`Page script failed: ${d.exception?.description ?? d.text}`);
    }
    return r?.result?.value as T;
  }

  /** Inject a script (such as axe) without caring about its return value. */
  async inject(source: string) {
    await this.send("Runtime.evaluate", { expression: source });
  }

  async pressKey(key: "Tab" | "Escape" | "Enter", shift = false) {
    const codes: Record<string, number> = { Tab: 9, Escape: 27, Enter: 13 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async screenshot(): Promise<string> {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    return r.data as string;
  }

  async close() {
    try {
      await this.chrome.send("Target.closeTarget", { targetId: this.targetId });
    } catch {}
  }
}
