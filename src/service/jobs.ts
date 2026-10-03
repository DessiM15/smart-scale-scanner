/**
 * The scan queue: one scan at a time (Chrome is the memory cost), a cap on
 * how many can wait, and a signed callback to the website at each step.
 *
 * A job's state outlives it for an hour, so a lost callback can be made
 * good by asking for the state (GET /scans/{id}).
 */
import { isPublicAddress, RefusedAddress, vetTarget } from "./guard.ts";
import { signedHeaders } from "./signing.ts";
import { buildLeadReport } from "../lead.ts";
import { runLeadScan, ScanFailure, type FailureReason, type LeadStep } from "../scan.ts";
import { RefusedResponse } from "../browser.ts";
import { TOOL_VERSION, type LeadReport } from "../types.ts";

export type JobEvent = "started" | "progress" | "completed" | "failed";

export interface JobInput {
  scanId: string;
  url: string;
  label?: string;
  callbackUrl: string;
}

export interface JobState {
  scanId: string;
  url: string;
  label?: string;
  callbackUrl: string;
  status: "queued" | "running" | "completed" | "failed";
  /** Place in line while queued: 1 is next. */
  position?: number;
  step?: LeadStep;
  stepIndex?: number;
  stepCount: number;
  report?: LeadReport;
  failure?: { reason: FailureReason; detail: string };
  createdAt: string;
  updatedAt: string;
}

const STEPS: LeadStep[] = ["load", "mobile", "keyboard", "search", "report"];
const KEEP_MS = 60 * 60 * 1000;
const CALLBACK_TIMEOUT_MS = 10_000;
const CALLBACK_DELAYS_MS = [1000, 4000, 10_000];

export const USER_AGENT_SUFFIX = `SmartScaleScanner/${TOOL_VERSION} (+https://smartscaleagent.com/check)`;

export interface JobsOptions {
  secret: string;
  /** Callbacks go only to this host. */
  callbackHost: string;
  queueMax?: number;
  log?: (message: string) => void;
  /** Test seam: replaces the real scan. */
  runner?: (job: JobState, onStep: (step: LeadStep) => void) => Promise<LeadReport>;
  /** Test seam: lets the fixture site (a private address) through the guard. */
  allowPrivate?: boolean;
}

export class QueueFull extends Error {}
export class BadCallback extends Error {}

export class Jobs {
  private readonly options: JobsOptions;
  private readonly jobs = new Map<string, JobState>();
  private readonly queue: string[] = [];
  private running = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: JobsOptions) {
    this.options = options;
  }

  get(scanId: string): JobState | undefined {
    return this.jobs.get(scanId);
  }

  /** The number waiting, not counting the one running. */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Accepts a scan. The same scanId twice returns the existing job without
   * starting another, so a retried request is harmless.
   */
  async submit(input: JobInput): Promise<{ job: JobState; created: boolean }> {
    const existing = this.jobs.get(input.scanId);
    if (existing) return { job: existing, created: false };

    let callback: URL;
    try {
      callback = new URL(input.callbackUrl);
    } catch {
      throw new BadCallback("callbackUrl is not a URL");
    }
    if (callback.host !== this.options.callbackHost) throw new BadCallback(`callbacks go to ${this.options.callbackHost} only`);
    if (callback.protocol !== "https:" && !this.options.allowPrivate) throw new BadCallback("callbackUrl must be https");

    if (!this.options.allowPrivate) await vetTarget(input.url); // throws RefusedAddress
    if (this.queue.length >= (this.options.queueMax ?? 10)) throw new QueueFull("the queue is full");

    const now = new Date().toISOString();
    const job: JobState = { ...input, status: "queued", stepCount: STEPS.length, createdAt: now, updatedAt: now };
    this.jobs.set(job.scanId, job);
    this.queue.push(job.scanId);
    this.renumber();
    this.log(job, `queued, position ${job.position}`);
    void this.pump();
    return { job, created: true };
  }

  private renumber() {
    this.queue.forEach((id, i) => {
      const job = this.jobs.get(id);
      if (job) job.position = i + 1;
    });
  }

  private log(job: JobState, message: string) {
    let host = job.url;
    try {
      host = new URL(job.url.includes("://") ? job.url : `https://${job.url}`).host;
    } catch {}
    this.options.log?.(`[${job.scanId}] ${host}: ${message}`);
  }

  private async pump() {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) return;
    this.running = true;
    this.renumber();
    const job = this.jobs.get(id)!;
    try {
      await this.run(job);
    } finally {
      this.running = false;
      const keep = setTimeout(() => {
        this.jobs.delete(id);
        this.timers.delete(keep);
      }, KEEP_MS);
      this.timers.add(keep);
      void this.pump();
    }
  }

  private async run(job: JobState) {
    const started = Date.now();
    job.status = "running";
    job.position = undefined;
    const touch = (step: LeadStep) => {
      job.step = step;
      job.stepIndex = STEPS.indexOf(step) + 1;
      job.updatedAt = new Date().toISOString();
    };
    touch("load");
    await this.callback(job, "started");
    const onStep = (step: LeadStep) => {
      if (step === "load") return;
      touch(step);
      void this.callback(job, "progress");
    };
    try {
      const report = this.options.runner ? await this.options.runner(job, onStep) : await this.scan(job, onStep);
      job.status = "completed";
      job.report = report;
      job.updatedAt = new Date().toISOString();
      this.log(job, `completed in ${Math.round((Date.now() - started) / 1000)}s, ${report.totals.problems} problems`);
      await this.callback(job, "completed");
    } catch (e) {
      const failure = toFailure(e);
      job.status = "failed";
      job.failure = failure;
      job.updatedAt = new Date().toISOString();
      this.log(job, `failed (${failure.reason}): ${failure.detail}`);
      await this.callback(job, "failed");
    }
  }

  private async scan(job: JobState, onStep: (step: LeadStep) => void): Promise<LeadReport> {
    const launch = { userAgentSuffix: USER_AGENT_SUFFIX, allowAddress: this.options.allowPrivate ? undefined : isPublicAddress };
    let hostResolverRules: string | undefined;
    if (!this.options.allowPrivate) {
      const vetted = await vetTarget(job.url);
      hostResolverRules = `MAP ${vetted.host} ${vetted.addresses[0]}`;
    }
    const result = await runLeadScan({ target: job.url, label: job.label, onStep, launch: { ...launch, hostResolverRules } });
    return buildLeadReport(result, job.scanId);
  }

  /** Sends one event to the website, retrying a few times. Never throws. */
  private async callback(job: JobState, event: JobEvent) {
    const body = JSON.stringify({
      scanId: job.scanId,
      event,
      step: job.step,
      stepIndex: job.stepIndex,
      stepCount: job.stepCount,
      report: event === "completed" ? job.report : undefined,
      failure: event === "failed" ? job.failure : undefined,
      at: new Date().toISOString(),
    });
    for (let attempt = 0; attempt <= CALLBACK_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetch(job.callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json", ...signedHeaders(this.options.secret, body) },
          body,
          signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
        });
        if (res.ok) return;
        this.log(job, `callback ${event} answered ${res.status}`);
      } catch (e) {
        this.log(job, `callback ${event} failed: ${(e as Error).message}`);
      }
      if (attempt < CALLBACK_DELAYS_MS.length) await new Promise((r) => setTimeout(r, CALLBACK_DELAYS_MS[attempt]));
    }
  }

  /** For tests and shutdown: drop the keep-alive timers. */
  close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

function toFailure(e: unknown): { reason: FailureReason; detail: string } {
  if (e instanceof ScanFailure) return { reason: e.reason, detail: e.message };
  if (e instanceof RefusedAddress || e instanceof RefusedResponse) return { reason: "blocked", detail: "The address points somewhere this scanner does not go." };
  return { reason: "timeout", detail: String((e as Error)?.message ?? e).slice(0, 200) };
}
