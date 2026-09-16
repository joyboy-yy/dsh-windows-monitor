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
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** A resolved sandbox policy handle, opaque to the plugin. */
export type ResolvedSandboxPolicy = unknown

/** Disposer returned by every Cordis lifecycle registration. */
export type Disposable = () => void

/** Captured stream of a finished shell command. */
export interface ShellStream {
  readonly text: string
}

/** Result of one shell invocation. */
export interface ShellResult {
  readonly exitCode: number
  readonly stdout: ShellStream
  readonly stderr: ShellStream
}

/** Request accepted by {@link ShellService.resolve}. */
export interface ShellRequest {
  readonly command: string
  readonly timeoutMs: number
  readonly stdoutMaxBytes: number
  readonly sandboxPolicy: ResolvedSandboxPolicy
}

/** Fully resolved, executable shell specification. */
export interface ShellSpec extends ShellRequest {
  readonly [key: string]: unknown
}

/** Command execution seam. */
export interface ShellService {
  resolve(request: ShellRequest): ShellSpec
  run(spec: ShellSpec): Promise<ShellResult>
}

/** Sandbox policy seam. */
export interface SandboxPolicyService {
  resolve(request: { readonly mode: SandboxMode }): ResolvedSandboxPolicy
}

/** Minimal inbound request surface used by the snapshot route. */
export interface HttpRequestLike {
  readonly method?: string
}

/** Minimal outbound response surface used by the snapshot route. */
export interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** Exact-path route registration accepted by the web server seam. */
export interface WebServerRoute {
  readonly kind: 'exact'
  readonly path: string
  handler(req: HttpRequestLike, res: HttpResponseLike): void | Promise<void>
}

/** Web server route registry. */
export interface WebServerService {
  register(route: WebServerRoute): Disposable
}

/** The Cordis context slice this plugin is applied with. */
export interface PluginContext {
  effect(callback: () => Disposable | void, label?: string): Disposable
  readonly shell: ShellService
  readonly sandboxPolicy: SandboxPolicyService
  readonly webServer: WebServerService
}
