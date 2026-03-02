// ----------------------------------------------------------------------------
// WebSocket Connection Manager for STT/TTS
// Manages WebSocket connections with automatic reconnection, exponential
// backoff, send queueing, and SSR safety.
// ----------------------------------------------------------------------------

export type WSState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed'
  | 'suspended';

export interface WebSocketManagerOptions {
  url: string | (() => string | Promise<string>);
  /** Max reconnection attempts before entering FAILED state. Default: 5 */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms. Default: 1000 */
  initialDelay?: number;
  /** Max reconnect delay in ms. Default: 30000 */
  maxDelay?: number;
  /** Connection timeout in ms. Default: 5000 */
  connectTimeoutMs?: number;
  /** Protocols to pass to WebSocket constructor */
  protocols?: string | string[];
  /** Debug logging */
  debug?: boolean;
  /** Label for logging (e.g., 'STT', 'TTS') */
  label?: string;
}

type MessagePayload = string | ArrayBuffer | Blob;

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY = 1000;
const DEFAULT_MAX_DELAY = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const MAX_QUEUE_SIZE = 50;

interface ListenerRefs {
  onOpen: () => void;
  onClose: (e: CloseEvent) => void;
  onError: (e: Event) => void;
  onMessage: (e: MessageEvent) => void;
}

export class WebSocketManager {
  // ── Options (resolved with defaults) ────────────────────────────────
  private readonly _url: string | (() => string | Promise<string>);
  private readonly _maxReconnectAttempts: number;
  private readonly _initialDelay: number;
  private readonly _maxDelay: number;
  private readonly _connectTimeoutMs: number;
  private readonly _protocols: string | string[] | undefined;
  private readonly _debug: boolean;
  private readonly _label: string;

  // ── Internal state ──────────────────────────────────────────────────
  private _state: WSState = 'disconnected';
  private _socket: WebSocket | null = null;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  // ── Listener references (for proper cleanup) ──────────────────────
  private _listenerRefs = new WeakMap<WebSocket, ListenerRefs>();

  // ── Send queue ──────────────────────────────────────────────────────
  private _queue: MessagePayload[] = [];

  // ── Event listeners ─────────────────────────────────────────────────
  private _onOpenCallbacks: Set<() => void> = new Set();
  private _onCloseCallbacks: Set<(code: number, reason: string) => void> = new Set();
  private _onMessageCallbacks: Set<(data: MessageEvent) => void> = new Set();
  private _onErrorCallbacks: Set<(error: Event) => void> = new Set();
  private _onStateChangeCallbacks: Set<(state: WSState, previous: WSState) => void> = new Set();

  // ── Constructor ─────────────────────────────────────────────────────

  constructor(options: WebSocketManagerOptions) {
    this._url = options.url;
    this._maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this._initialDelay = options.initialDelay ?? DEFAULT_INITIAL_DELAY;
    this._maxDelay = options.maxDelay ?? DEFAULT_MAX_DELAY;
    this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._protocols = options.protocols;
    this._debug = options.debug ?? false;
    this._label = options.label ?? 'WS';
  }

  // ── Public getters ──────────────────────────────────────────────────

  /** Current connection state */
  get state(): WSState {
    return this._state;
  }

  /** The underlying WebSocket (null if not connected) */
  get socket(): WebSocket | null {
    return this._socket;
  }

  // ── Connection lifecycle ────────────────────────────────────────────

  /** Connect to the WebSocket server */
  async connect(): Promise<void> {
    if (this._destroyed) {
      this._log('Cannot connect — manager is destroyed');
      return;
    }

    // SSR guard
    if (typeof WebSocket === 'undefined') {
      this._log('WebSocket is not available in this environment');
      return;
    }

    // If already connected or connecting, no-op
    if (this._state === 'connected' || this._state === 'connecting') {
      this._log(`Already in state "${this._state}", ignoring connect()`);
      return;
    }

    // A manual connect() call from FAILED state resets the attempt counter
    if (this._state === 'failed') {
      this._reconnectAttempts = 0;
    }

    this._setState('connecting');
    await this._attemptConnection();
  }

  /** Gracefully close the connection */
  close(code?: number, reason?: string): void {
    this._log('close() called');
    this._clearTimers();
    this._reconnectAttempts = 0;

    if (this._socket) {
      // Remove listeners before closing to prevent the close handler from
      // triggering reconnection logic.
      this._detachSocketListeners(this._socket);
      try {
        this._socket.close(code ?? 1000, reason ?? 'Client closed');
      } catch {
        // Socket may already be closed; ignore.
      }
      this._socket = null;
    }

    this._setState('disconnected');
  }

  /**
   * Send data through the WebSocket.
   * - If state is `connecting` or `reconnecting`, the message is queued.
   * - If state is `connected`, the message is sent immediately.
   * - If state is `failed` or `suspended`, an error is thrown.
   * - If state is `disconnected`, the message is queued (a reconnect may follow).
   */
  send(data: MessagePayload): void {
    if (this._state === 'failed') {
      throw new Error(
        `[GuideKit:WS:${this._label}] Cannot send — connection is in FAILED state. Call connect() to retry.`,
      );
    }

    if (this._state === 'suspended') {
      throw new Error(
        `[GuideKit:WS:${this._label}] Cannot send — connection is SUSPENDED. Call resume() first.`,
      );
    }

    if (this._state === 'connected' && this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send(data);
      return;
    }

    // Queue the message for later delivery
    this._enqueue(data);
  }

  // ── Suspend / Resume ────────────────────────────────────────────────

  /** Suspend reconnection (e.g., during confirmed offline). No reconnection attempts. */
  suspend(): void {
    if (this._state === 'failed' || this._state === 'suspended') {
      this._log(`suspend() ignored — already in "${this._state}"`);
      return;
    }

    this._log('Suspending');
    this._clearTimers();

    // If there is an active socket, close it
    if (this._socket) {
      this._detachSocketListeners(this._socket);
      try {
        this._socket.close(1000, 'Suspended');
      } catch {
        // ignore
      }
      this._socket = null;
    }

    this._setState('suspended');
  }

  /** Resume from suspended state. Triggers reconnection. */
  resume(): void {
    if (this._state !== 'suspended') {
      this._log(`resume() ignored — not in SUSPENDED state (current: "${this._state}")`);
      return;
    }

    this._log('Resuming');
    this._reconnectAttempts = 0;
    this._setState('reconnecting');
    this._scheduleReconnect();
  }

  // ── Event registration ──────────────────────────────────────────────

  /** Register an onOpen handler. Returns an unsubscribe function. */
  onOpen(callback: () => void): () => void {
    this._onOpenCallbacks.add(callback);
    return () => {
      this._onOpenCallbacks.delete(callback);
    };
  }

  /** Register an onClose handler. Returns an unsubscribe function. */
  onClose(callback: (code: number, reason: string) => void): () => void {
    this._onCloseCallbacks.add(callback);
    return () => {
      this._onCloseCallbacks.delete(callback);
    };
  }

  /** Register an onMessage handler. Returns an unsubscribe function. */
  onMessage(callback: (data: MessageEvent) => void): () => void {
    this._onMessageCallbacks.add(callback);
    return () => {
      this._onMessageCallbacks.delete(callback);
    };
  }

  /** Register an onError handler. Returns an unsubscribe function. */
  onError(callback: (error: Event) => void): () => void {
    this._onErrorCallbacks.add(callback);
    return () => {
      this._onErrorCallbacks.delete(callback);
    };
  }

  /** Register a state change handler. Returns an unsubscribe function. */
  onStateChange(callback: (state: WSState, previous: WSState) => void): () => void {
    this._onStateChangeCallbacks.add(callback);
    return () => {
      this._onStateChangeCallbacks.delete(callback);
    };
  }

  // ── Destroy ─────────────────────────────────────────────────────────

  /** Destroy the manager and clean up all resources */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._log('Destroying');

    this.close();
    this._queue = [];
    this._onOpenCallbacks.clear();
    this._onCloseCallbacks.clear();
    this._onMessageCallbacks.clear();
    this._onErrorCallbacks.clear();
    this._onStateChangeCallbacks.clear();
  }

  // ── Private: Connection logic ───────────────────────────────────────

  private async _resolveUrl(): Promise<string> {
    if (typeof this._url === 'function') {
      return await this._url();
    }
    return this._url;
  }

  private async _attemptConnection(): Promise<void> {
    // SSR guard
    if (typeof WebSocket === 'undefined') return;

    let url: string;
    try {
      url = await this._resolveUrl();
    } catch (err) {
      this._log(`URL resolution failed: ${err}`);
      this._handleConnectionFailure();
      return;
    }

    this._log(`Connecting to ${url}`);

    let ws: WebSocket;
    try {
      ws = this._protocols ? new WebSocket(url, this._protocols) : new WebSocket(url);
    } catch (err) {
      this._log(`WebSocket constructor threw: ${err}`);
      this._handleConnectionFailure();
      return;
    }

    // Binary type: arraybuffer is generally more useful than blob
    ws.binaryType = 'arraybuffer';

    this._socket = ws;

    // ── Connection timeout ──────────────────────────────────────────
    this._connectTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        this._log('Connection timed out');
        // Force-close the socket; the close handler will trigger reconnection.
        ws.close();
      }
    }, this._connectTimeoutMs);

    // ── Socket event handlers ───────────────────────────────────────
    const onOpen = () => {
      this._clearConnectTimer();
      this._reconnectAttempts = 0;
      this._setState('connected');
      this._log('Connected');

      // Notify listeners
      for (const cb of this._onOpenCallbacks) {
        try {
          cb();
        } catch {
          // Swallow listener errors
        }
      }

      // Flush queued messages
      this._flushQueue();
    };

    const onClose = (event: CloseEvent) => {
      this._clearConnectTimer();
      this._log(`Socket closed — code=${event.code} reason="${event.reason}"`);

      // Notify close listeners
      for (const cb of this._onCloseCallbacks) {
        try {
          cb(event.code, event.reason);
        } catch {
          // Swallow listener errors
        }
      }

      // Clean up this socket reference if it is the current one
      if (this._socket === ws) {
        this._socket = null;
      }

      // Only attempt reconnection if the manager hasn't been destroyed or
      // intentionally closed (state would be 'disconnected' in that case).
      if (
        !this._destroyed &&
        this._state !== 'disconnected' &&
        this._state !== 'suspended' &&
        this._state !== 'failed'
      ) {
        this._setState('disconnected');
        this._handleConnectionFailure();
      }
    };

    const onError = (event: Event) => {
      this._log('Socket error');
      for (const cb of this._onErrorCallbacks) {
        try {
          cb(event);
        } catch {
          // Swallow listener errors
        }
      }
      // The `close` event will follow the `error` event, so reconnection
      // logic is handled there.
    };

    const onMessage = (event: MessageEvent) => {
      for (const cb of this._onMessageCallbacks) {
        try {
          cb(event);
        } catch {
          // Swallow listener errors
        }
      }
    };

    ws.addEventListener('open', onOpen);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    ws.addEventListener('message', onMessage);

    // Store references for later removal
    this._listenerRefs.set(ws, { onOpen, onClose, onError, onMessage });
  }

  private _detachSocketListeners(ws: WebSocket): void {
    const listeners = this._listenerRefs.get(ws);
    if (!listeners) return;
    ws.removeEventListener('open', listeners.onOpen);
    ws.removeEventListener('close', listeners.onClose);
    ws.removeEventListener('error', listeners.onError);
    ws.removeEventListener('message', listeners.onMessage);
    this._listenerRefs.delete(ws);
  }

  // ── Private: Reconnection ───────────────────────────────────────────

  private _handleConnectionFailure(): void {
    if (this._destroyed || this._state === 'suspended') return;

    this._reconnectAttempts++;

    if (this._reconnectAttempts > this._maxReconnectAttempts) {
      this._log(
        `Max reconnect attempts (${this._maxReconnectAttempts}) reached — entering FAILED state`,
      );
      this._setState('failed');
      return;
    }

    this._setState('reconnecting');
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;

    const delay = this._calculateBackoff(this._reconnectAttempts - 1);
    this._log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroyed || this._state === 'suspended' || this._state === 'failed') return;

      this._setState('connecting');
      await this._attemptConnection();
    }, delay);
  }

  /**
   * Exponential backoff with jitter.
   * delay = initialDelay * 2^attempt, capped at maxDelay, with +/-25% jitter.
   */
  private _calculateBackoff(attempt: number): number {
    const exponential = this._initialDelay * Math.pow(2, attempt);
    const capped = Math.min(exponential, this._maxDelay);
    // Jitter: random value between 0.75 and 1.25 of the capped delay
    const jitter = 0.75 + Math.random() * 0.5;
    return Math.round(capped * jitter);
  }

  // ── Private: Send queue ─────────────────────────────────────────────

  private _enqueue(data: MessagePayload): void {
    if (this._queue.length >= MAX_QUEUE_SIZE) {
      this._log('Send queue full — dropping oldest message');
      this._queue.shift();
    }
    this._queue.push(data);
  }

  private _flushQueue(): void {
    if (
      this._queue.length === 0 ||
      !this._socket ||
      this._socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    this._log(`Flushing ${this._queue.length} queued message(s)`);
    const pending = this._queue.slice();
    this._queue = [];

    for (const msg of pending) {
      try {
        this._socket.send(msg);
      } catch (err) {
        this._log(`Failed to send queued message: ${err}`);
        // Re-queue remaining messages on failure
        // The current message is lost but remaining ones are preserved.
        break;
      }
    }
  }

  // ── Private: State management ───────────────────────────────────────

  private _setState(next: WSState): void {
    const prev = this._state;
    if (prev === next) return;

    this._state = next;
    this._log(`State: ${prev} -> ${next}`);

    for (const cb of this._onStateChangeCallbacks) {
      try {
        cb(next, prev);
      } catch {
        // Swallow listener errors
      }
    }
  }

  // ── Private: Timer management ───────────────────────────────────────

  private _clearTimers(): void {
    this._clearConnectTimer();
    this._clearReconnectTimer();
  }

  private _clearConnectTimer(): void {
    if (this._connectTimer !== null) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  // ── Private: Logging ────────────────────────────────────────────────

  private _log(message: string): void {
    if (this._debug) {
      console.log(`[GuideKit:WS:${this._label}] ${message}`);
    }
  }
}
