import { AbstractController } from "./abstract.mjs";

interface CallRecord {
  method: string;
  args: any;
  timestamp: string;
}

/**
 * Per-task scoped mock connector for ALOMA test workflows.
 *
 * State (responseMap, callLog) is keyed by ctx.taskId so concurrent
 * test tasks against the same Testing pod do not contaminate each
 * other's stubbed responses or recorded calls.
 *
 * Requires @aloma.io/integration-sdk ^3.8.67, which forwards
 * { taskId, namespace, sticky } as the second arg to controller
 * method handlers and to the __default fallback.
 *
 * Backward compatibility: when ctx is missing (legacy invocation or
 * non-task call from admin UI), state falls into the "__no_ctx__"
 * bucket so the connector does not crash. Isolation is NOT guaranteed
 * in that mode — it is degraded compatibility only.
 */
export default class Controller extends AbstractController {
  // Per-task scoped state — Maps keyed by taskId (insertion order = LRU order)
  private responseMapByTask: Map<string, Record<string, any>> = new Map();
  private callLogByTask: Map<string, CallRecord[]> = new Map();
  private recording: boolean = true;
  private defaultResponses: Record<string, any> = {};
  // Memory cap (LRU). Configurable via config.maxTasks; default 1000.
  private maxTasks: number = 1000;

  protected async start() {
    this.loadConfig();
  }

  private loadConfig() {
    const config = this.config;

    // Parse default responses from connector config — these seed each
    // task's bucket when first touched.
    if (config.responses) {
      try {
        this.defaultResponses =
          typeof config.responses === "string"
            ? JSON.parse(config.responses)
            : config.responses;
      } catch (e) {
        this.defaultResponses = {};
      }
    } else {
      this.defaultResponses = {};
    }

    this.recording = config.recordCalls !== "false";

    // Allow config-driven override of LRU cap. Default 1000 if not set
    // or not a positive number.
    const configured = Number(config.maxTasks);
    if (Number.isFinite(configured) && configured > 0) {
      this.maxTasks = Math.floor(configured);
    }
  }

  /**
   * Resolve the bucket key for the current invocation. When ctx is
   * absent or lacks taskId, falls back to a single shared bucket so
   * legacy / hand-rolled callers do not crash. Isolation is not
   * guaranteed in that mode.
   */
  private bucketKey(ctx?: { taskId?: string }): string {
    return ctx && ctx.taskId ? ctx.taskId : "__no_ctx__";
  }

  /**
   * LRU touch — ensures the bucket exists for the given key, evicting
   * the least-recently-used entry if the cap would be exceeded. Map
   * iteration order is insertion order; reinserting promotes a key to
   * "most recently used" position.
   */
  private touchTask(key: string) {
    // If not present and at cap, evict the oldest (insertion order)
    if (!this.responseMapByTask.has(key)) {
      if (this.responseMapByTask.size >= this.maxTasks) {
        const firstKey = this.responseMapByTask.keys().next().value as
          | string
          | undefined;
        if (firstKey !== undefined) {
          this.responseMapByTask.delete(firstKey);
          this.callLogByTask.delete(firstKey);
        }
      }
      this.responseMapByTask.set(key, { ...this.defaultResponses });
      this.callLogByTask.set(key, []);
    }
  }

  /**
   * Catch-all handler — registered as __default by the SDK via the
   * fallback override below. Looks up the response in the task-scoped
   * map, records the call in the task-scoped log, and returns the
   * configured response or a default stub acknowledgement.
   */
  private async handleStubCall(
    arg: any,
    ctx?: { taskId?: string },
  ): Promise<any> {
    const key = this.bucketKey(ctx);
    this.touchTask(key);

    const method = Array.isArray(arg?.__method)
      ? arg.__method.join(".")
      : arg?.__method || "unknown";

    if (this.recording) {
      const log = this.callLogByTask.get(key)!;
      log.push({
        method,
        args: { ...arg, __method: undefined },
        timestamp: new Date().toISOString(),
      });
    }

    const responseMap = this.responseMapByTask.get(key)!;
    if (responseMap[method] !== undefined) {
      return responseMap[method];
    }
    if (responseMap["default"] !== undefined) {
      return responseMap["default"];
    }

    return { stubbed: true, method };
  }

  /**
   * SDK override hook — invoked by AbstractController.__default with
   * the per-invocation ctx (taskId, namespace, sticky) as second arg.
   */
  protected fallback(arg: any, ctx?: { taskId?: string }): Promise<any> {
    return this.handleStubCall(arg, ctx);
  }

  /**
   * Returns recorded calls scoped to the current task.
   * @example
   * ```javascript
   * const log = await connectors.testing.getCallLog({})
   * // log.calls = [{method, args, timestamp}, ...] for THIS task only
   * ```
   */
  async getCallLog(_args: any, ctx?: { taskId?: string }) {
    const key = this.bucketKey(ctx);
    const calls = this.callLogByTask.get(key) || [];
    return { calls: [...calls], count: calls.length };
  }

  /**
   * Resets the call log for the current task only.
   * @example
   * ```javascript
   * await connectors.testing.clearCallLog({})
   * ```
   */
  async clearCallLog(_args: any, ctx?: { taskId?: string }) {
    const key = this.bucketKey(ctx);
    if (this.callLogByTask.has(key)) {
      this.callLogByTask.set(key, []);
    }
    return { cleared: true };
  }

  /**
   * Updates the response map for the current task at runtime.
   * @example
   * ```javascript
   * await connectors.testing.setResponses({
   *   responses: { "someConnector.create": { id: "456" } }
   * })
   * ```
   */
  async setResponses(args: any, ctx?: { taskId?: string }) {
    const key = this.bucketKey(ctx);
    this.touchTask(key);

    if (args?.responses) {
      try {
        const newResponses =
          typeof args.responses === "string"
            ? JSON.parse(args.responses)
            : args.responses;
        const existing = this.responseMapByTask.get(key)!;
        this.responseMapByTask.set(key, { ...existing, ...newResponses });
      } catch (e) {
        // ignore parse errors — leave existing map untouched
      }
    }

    return {
      updated: true,
      responseCount: Object.keys(this.responseMapByTask.get(key)!).length,
    };
  }
}
