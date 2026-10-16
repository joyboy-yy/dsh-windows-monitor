//#region src/harness.d.ts
/**
 * Structural declarations for the DeepSeek Harness seams this plugin consumes.
 *
 * DSH ships its own service type declarations inside the harness install rather
 * than on npm, so a third-party plugin cannot import them. Declaring only the
 * surface actually called keeps this package dependency-free and still
 * type-checked: a drifted signature fails here instead of at runtime.
 *
 * These are deliberately structural, not nominal — any compatible harness
 * implementation satisfies them.
 */
/** Sandbox modes the harness policy seam accepts. */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
/** A resolved sandbox policy handle, opaque to the plugin. */
type ResolvedSandboxPolicy = unknown;
/** Disposer returned by every Cordis lifecycle registration. */
type Disposable = () => void;
/** Captured stream of a finished shell command. */
interface ShellStream {
  readonly text: string;
}
/** Result of one shell invocation. */
interface ShellResult {
  readonly exitCode: number;
  readonly stdout: ShellStream;
  readonly stderr: ShellStream;
}
/** Request accepted by {@link ShellService.resolve}. */
interface ShellRequest {
  readonly command: string;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly sandboxPolicy: ResolvedSandboxPolicy;
}
/** Fully resolved, executable shell specification. */
interface ShellSpec extends ShellRequest {
  readonly [key: string]: unknown;
}
/**
 * Handle for one prepared execution.
 *
 * Awaiting its `result()` projection is what makes a command a foreground run;
 * "foreground" is a property of what the caller awaits, not of the spawn.
 */
interface ShellExecution {
  /** Resolves when the command settles. Rejects only for infrastructure failures. */
  result(): Promise<ShellResult>;
}
/**
 * Command execution seam.
 *
 * Both entry points are optional because DSH renamed them: `execute(spec)` is
 * the current one and resolves with a handle, while `run(spec)` is the older
 * one that returned the result directly. Declaring only one would make this
 * plugin silently wrong against the harness versions that expose the other, so
 * the caller probes and prefers `execute`.
 */
interface ShellService {
  resolve(request: ShellRequest): ShellSpec;
  /** Current entry point. */
  execute?(spec: ShellSpec): Promise<ShellExecution>;
  /** Entry point used before the rename. */
  run?(spec: ShellSpec): Promise<ShellResult>;
}
/** Sandbox policy seam. */
interface SandboxPolicyService {
  resolve(request: {
    readonly mode: SandboxMode;
  }): ResolvedSandboxPolicy;
}
/** Minimal inbound request surface used by the snapshot route. */
interface HttpRequestLike {
  readonly method?: string;
}
/** Minimal outbound response surface used by the snapshot route. */
interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}
/** Exact-path route registration accepted by the web server seam. */
interface WebServerRoute {
  readonly kind: 'exact';
  readonly path: string;
  handler(req: HttpRequestLike, res: HttpResponseLike): void | Promise<void>;
}
/** Web server route registry. */
interface WebServerService {
  register(route: WebServerRoute): Disposable;
}
/** The Cordis context slice this plugin is applied with. */
interface PluginContext {
  effect(callback: () => Disposable | void, label?: string): Disposable;
  readonly shell: ShellService;
  readonly sandboxPolicy: SandboxPolicyService;
  readonly webServer: WebServerService;
}
//#endregion
//#region src/index.d.ts
/** Cordis services this plugin cannot start without. */
export declare const inject: readonly ["shell", "sandboxPolicy", "webServer"];
/**
 * Mount the snapshot route for the lifetime of this plugin.
 *
 * @param ctx - the Cordis context slice.
 * @param platform - the platform to collect for. Defaults to the running host
 *   process, and is injectable so the unsupported-platform path can be
 *   exercised on a machine that does have a collector. Cordis always calls this
 *   with one argument, so the default is what ships.
 */
export declare function apply(ctx: PluginContext, platform?: string): void;
//#endregion