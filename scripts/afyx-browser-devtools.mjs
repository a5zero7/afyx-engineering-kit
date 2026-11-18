#!/usr/bin/env node

/**
 * AFYX Browser DevTools â€” Native Browser Engineering & Diagnostics Engine
 *
 * Provides lightweight, zero-third-party Chrome DevTools Protocol (CDP) orchestration
 * for web application debugging, live DOM inspection, console/network telemetry,
 * JavaScript evaluation, and visual snapshotting.
 *
 * Architecture Principles:
 * - Standalone by Design: Independent lifecycle manager decoupled from heavy automation frameworks (no Puppeteer/Playwright dependency).
 * - Integrated by Contract: Exposes standard MCP and CLI contracts for universal agent host compatibility.
 * - Activated by Need: Lazy process activation with deterministic teardown and strict profile isolation.
 * - Security & Privacy: Never touches personal browser profiles; runs in isolated ephemeral sandbox by default.
 *
 * Part of AFYX Engineering Kit (AFYX-190, AFYX-105, AFYX-320).
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// globalThis.WebSocket is available natively in Node.js 21+

// =============================================================================
// Chrome Binary Detection
// =============================================================================

export function findChromeBinary(platform = process.platform, env = process.env) {
  if (env.CHROME_BIN && existsSync(env.CHROME_BIN)) {
    return env.CHROME_BIN;
  }
  if (env.CHROME_PATH && existsSync(env.CHROME_PATH)) {
    return env.CHROME_PATH;
  }

  const candidates = [];

  if (platform === 'win32') {
    const prefixes = [
      env['PROGRAMFILES(X86)'],
      env.PROGRAMFILES,
      env.LOCALAPPDATA,
    ].filter(Boolean);

    for (const prefix of prefixes) {
      candidates.push(
        join(prefix, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(prefix, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
        join(prefix, 'Chromium', 'Application', 'chrome.exe'),
        join(prefix, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    // Linux / POSIX
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export const AFYX_BROWSER_CONTRACT = 'AfyxBrowser/v1';
const LIMIT = 256;
const sensitive = /(?:authorization|cookie|password|passwd|secret|token|api.?key|credential)/i;
function redact(value) {
  return String(value ?? '').replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|credential)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]').slice(0, 4096);
}
function safeUrl(value) {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '[invalid-url]'; }
}
function integer(value, fallback, maximum = 30_000) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('BROWSER_INVALID_LIMIT');
  return value;
}
function scopedPath(root, target, mustExist = true) {
  if (!root || !isAbsolute(target)) throw new Error('BROWSER_FILE_SCOPE_REQUIRED');
  const resolvedRoot = realpathSync(root);
  const delta = relative(resolvedRoot, resolve(target));
  if (!delta || isAbsolute(delta) || delta === '..' || delta.startsWith('..\\') || delta.startsWith('../')) throw new Error('BROWSER_PATH_OUTSIDE_SCOPE');
  let current = resolvedRoot;
  const parts = delta.split(/[\\/]/);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    if (!existsSync(current)) {
      if (mustExist || i !== parts.length - 1) throw new Error('BROWSER_FILE_NOT_FOUND');
    } else if (lstatSync(current).isSymbolicLink()) throw new Error('BROWSER_SYMLINK_DENIED');
  }
  return current;
}

/** One owned CDP session manager. Constructor options are trusted host policy,
 * never options taken from model-supplied command JSON. No attach API exists. */
export class AfyxBrowserSession {
  constructor(options = {}) {
    this.chromePath = options.chromePath || findChromeBinary();
    this.headless = options.headless !== false;
    if (options.port || options.wsUrl || options.userDataDir) throw new Error('BROWSER_EXTERNAL_ATTACH_DENIED');
    const origins = (options.allowedOrigins ?? []).map((value) => {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href !== `${url.origin}/`) throw new Error('BROWSER_EXACT_ORIGIN_REQUIRED');
      return url.origin;
    });
    this.policy = Object.freeze({ origins: Object.freeze(origins), allowEvaluation: options.allowEvaluation === true,
      fileRoot: options.fileRoot ? realpathSync(options.fileRoot) : null,
      uploadRoot: options.uploadRoot ? realpathSync(options.uploadRoot) : null,
      exportRoot: options.exportRoot ? realpathSync(options.exportRoot) : null,
      maxCommands: integer(options.maxCommands, 2000, 10000),
      sessionTimeoutMs: integer(options.sessionTimeoutMs, 300000, 1800000),
      maxTraceBytes: integer(options.maxTraceBytes, 2_000_000, 8_000_000) });
    this.process = null; this.userDataDir = null; this.ws = null; this.port = 0; this.wsUrl = null;
    this.isAttached = false; this.pendingCallbacks = new Map(); this.messageId = 1;
    this.pages = new Map(); this.selectedPage = null; this.consoleLogs = []; this.networkRequests = [];
    this.dialog = null; this.trace = null; this.commandCount = 0; this._queue = Promise.resolve();
    this.interceptionDiagnostics = { staleRequests: 0, closedPageSessions: 0, fatalErrors: 0 };
    this.budgetDiagnostics = {
      sessionTimeoutMs: this.policy.sessionTimeoutMs,
      startedAt: null,
      deadline: null,
      closureReason: null,
      interruptionSource: null,
    };
    // Serialize public operations so page selection/navigation cannot race.
    for (const name of ['launch', 'close', 'listPages', 'newPage', 'selectPage', 'closePage', 'navigate', 'waitFor',
      'evaluate', 'inspectPage', 'snapshot', 'findElements', 'click', 'clickAt', 'drag', 'hover', 'fillForm', 'typeText', 'pressKey', 'handleDialog',
      'uploadFile', 'getComputedStyles', 'takeScreenshot', 'resourceTiming', 'performanceMetrics', 'traceStart', 'traceStop', 'exportTrace', 'emulate']) {
      const operation = this[name].bind(this);
      this[name] = (...args) => { const next = this._queue.then(() => operation(...args)); this._queue = next.catch(() => {}); return next; };
    }
  }

  _allowed(value) {
    const url = new URL(value);
    if (url.href === 'about:blank') return true;
    if (url.protocol === 'file:' && this.policy.fileRoot) { scopedPath(this.policy.fileRoot, fileURLToPath(url)); return true; }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid URL scheme: BROWSER_URL_DENIED');
    if (url.username || url.password || !this.policy.origins.includes(url.origin)) throw new Error('BROWSER_ORIGIN_DENIED');
    return true;
  }

  async launch() {
    if (this.process) throw new Error('BROWSER_ALREADY_RUNNING');
    if (!this.chromePath) throw new Error('BROWSER_EXECUTABLE_NOT_FOUND');
    this.commandCount = 0; this.consoleLogs = []; this.networkRequests = []; this.dialog = null; this.trace = null;
    this.interceptionDiagnostics = { staleRequests: 0, closedPageSessions: 0, fatalErrors: 0 };
    this.budgetDiagnostics.startedAt = Date.now();
    this.budgetDiagnostics.deadline = this.budgetDiagnostics.startedAt + this.policy.sessionTimeoutMs;
    this.budgetDiagnostics.closureReason = null;
    this.budgetDiagnostics.interruptionSource = null;
    this.userDataDir = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-browser-session-'));
    const flags = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${this.userDataDir}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-default-apps',
      '--disable-sync', '--disable-component-update', '--disable-extensions', '--disable-domain-reliability',
      '--disable-client-side-phishing-detection', '--safebrowsing-disable-auto-update',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--window-size=1280,800'];
    if (this.headless) flags.push('--headless=new');
    flags.push('about:blank');
    try {
      this.process = spawn(this.chromePath, flags, { stdio: 'ignore', windowsHide: true });
      const ownedChild = this.process;
      this._processExited = new Promise((done) => {
        this.process.once('exit', () => { this.isAttached = false; this._rejectPending('BROWSER_PROCESS_EXITED'); done();
          if (this.process === ownedChild) void this._close().catch(() => {}); });
        this.process.once('error', () => { this.isAttached = false; this._rejectPending('BROWSER_PROCESS_ERROR'); done(); });
      });
      const activePort = join(this.userDataDir, 'DevToolsActivePort');
      const deadline = Date.now() + 15000;
      let activePortContent = '';
      while (true) {
        if (!this.process || this.process.exitCode !== null || Date.now() > deadline) throw new Error('BROWSER_LAUNCH_FAILED');
        if (existsSync(activePort)) {
          try {
            activePortContent = readFileSync(activePort, 'utf8').trim();
            if (activePortContent.includes('\n')) break;
          } catch (e) {
            if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
          }
        }
        await delay(50);
      }
      if (lstatSync(activePort).isSymbolicLink()) throw new Error('BROWSER_ENDPOINT_OWNERSHIP_FAILED');
      const [port, endpoint] = activePortContent.split(/\r?\n/);
      if (!/^\d+$/.test(port) || +port < 1 || +port > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint)) throw new Error('BROWSER_ENDPOINT_OWNERSHIP_FAILED');
      this.port = +port; this.wsUrl = `ws://127.0.0.1:${port}${endpoint}`;
      await this._connect();
      const version = await this.send('Browser.getVersion');
      await this.send('Browser.setDownloadBehavior', { behavior: 'deny' });
      await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      const targets = await this.send('Target.getTargets');
      for (const target of targets.targetInfos.filter((item) => item.type === 'page')) {
        if (!this.pages.has(target.targetId)) {
          const { sessionId } = await this.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
          await this._attach(sessionId, target);
        }
      }
      await this._settleAttachments();
      this.selectedPage = this.pages.keys().next().value;
      this._expiry = setTimeout(() => {
        this.budgetDiagnostics.closureReason = 'TIMEOUT';
        this.budgetDiagnostics.interruptionSource = 'AFYX_SESSION_TIMEOUT';
        void this._close();
      }, this.policy.sessionTimeoutMs); this._expiry.unref();
      this._exitCleanup = () => { this.process?.kill(); };
      process.once('exit', this._exitCleanup);
      return { port: this.port, wsUrl: this.wsUrl, browser: version.product, protocolVersion: version.protocolVersion,
        pageId: this.selectedPage, profile: 'ISOLATED_EPHEMERAL',
        budget: { sessionTimeoutMs: this.policy.sessionTimeoutMs, maxCommands: this.policy.maxCommands } };
    } catch (error) { await this._close(); throw error; }
  }

  async _connect() {
    if (!globalThis.WebSocket) throw new Error('BROWSER_NATIVE_WEBSOCKET_REQUIRED');
    await new Promise((done, fail) => {
      const socket = new WebSocket(this.wsUrl); this.ws = socket;
      const timer = setTimeout(() => { socket.close(); fail(new Error('BROWSER_CONNECT_TIMEOUT')); }, 5000);
      socket.onopen = () => { clearTimeout(timer); this.isAttached = true; done(); };
      socket.onerror = () => { clearTimeout(timer); fail(new Error('BROWSER_CONNECT_FAILED')); };
      socket.onclose = () => { this.isAttached = false; this._rejectPending('BROWSER_CDP_DISCONNECTED'); };
      socket.onmessage = ({ data }) => { try { this._handleMessage(JSON.parse(data)); } catch {} };
    });
  }

  _rejectPending(reason) { for (const entry of this.pendingCallbacks.values()) { clearTimeout(entry.timer); entry.reject(new Error(reason)); } this.pendingCallbacks.clear(); }

  async send(method, params = {}, sessionId = undefined) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('BROWSER_CDP_DISCONNECTED');
    if (++this.commandCount > this.policy.maxCommands) throw new Error('BROWSER_COMMAND_BUDGET_EXHAUSTED');
    const id = this.messageId++;
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => { this.pendingCallbacks.delete(id); reject(new Error(`BROWSER_CDP_TIMEOUT:${method}`)); }, 10000);
      this.pendingCallbacks.set(id, { resolve: resolveCommand, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pendingCallbacks.delete(id); reject(error); }
    });
  }

  _handleMessage(message) {
    if (message.id && this.pendingCallbacks.has(message.id)) {
      const entry = this.pendingCallbacks.get(message.id); clearTimeout(entry.timer); this.pendingCallbacks.delete(message.id);
      if (message.error) {
        const error = new Error(`BROWSER_CDP_ERROR:${message.error.code}`);
        error.cdpCode = message.error.code; error.cdpMessage = message.error.message;
        entry.reject(error);
      } else entry.resolve(message.result ?? {});
      return;
    }
    const event = message.params ?? {};
    if (message.method === 'Target.attachedToTarget') {
      const promise = this._attach(event.sessionId, event.targetInfo).catch(() => { void this._close(); });
      this._attachments ??= new Set(); this._attachments.add(promise); void promise.finally(() => this._attachments.delete(promise));
    } else if (message.method === 'Target.detachedFromTarget') {
      for (const [id, page] of this.pages) if (page.sessionId === event.sessionId) this.pages.delete(id);
    } else if (message.method === 'Fetch.requestPaused') {
      try { this._allowed(event.request.url); void this.send('Fetch.continueRequest', { requestId: event.requestId }, message.sessionId).catch((error) => this._interceptionFailure(error, message.sessionId)); }
      catch { void this.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch((error) => this._interceptionFailure(error, message.sessionId)); }
    } else if (message.method === 'Page.javascriptDialogOpening') {
      this.dialog = { type: event.type, message: redact(event.message), sessionId: message.sessionId };
      for (const done of this._dialogWaiters ?? []) done();
    } else if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown') {
      const text = message.method === 'Runtime.exceptionThrown' ? event.exceptionDetails?.text
        : event.args?.map((arg) => typeof arg.value === 'string' ? arg.value : arg.type === 'number' ? arg.value : `[${arg.type}]`).join(' ');
      this.consoleLogs.push({ type: event.type ?? 'error', text: redact(text), timestamp: event.timestamp ?? null });
      if (this.consoleLogs.length > LIMIT) this.consoleLogs.shift();
    } else if (message.method === 'Network.requestWillBeSent') {
      this.networkRequests.push({ requestId: event.requestId, pageSession: message.sessionId, url: safeUrl(event.request?.url),
        method: event.request?.method, type: event.type, timestamp: event.timestamp, redirected: Boolean(event.redirectResponse) });
      if (this.networkRequests.length > LIMIT) this.networkRequests.shift();
    } else if (message.method === 'Network.responseReceived' || message.method === 'Network.loadingFailed') {
      const item = this.networkRequests.findLast((value) => value.requestId === event.requestId && value.pageSession === message.sessionId);
      if (item) Object.assign(item, event.response ? { status: event.response.status, mimeType: event.response.mimeType,
        protocol: event.response.protocol } : { failed: true, error: redact(event.errorText), blockedReason: event.blockedReason });
    } else if (message.method === 'Tracing.dataCollected' && this.trace?.active) {
      for (const item of event.value ?? []) {
        const clean = { name: redact(item.name), cat: redact(item.cat), ph: item.ph, ts: item.ts, dur: item.dur, pid: item.pid, tid: item.tid };
        const bytes = Buffer.byteLength(JSON.stringify(clean));
        if (this.trace.bytes + bytes > this.policy.maxTraceBytes) { this.trace.truncated = true; break; }
        this.trace.events.push(clean); this.trace.bytes += bytes;
      }
    } else if (message.method === 'Tracing.tracingComplete') { this.trace?.complete?.(); }
  }

  _interceptionFailure(error, sessionId) {
    // These exact responses were reproduced against owned Chrome: canceled
    // requests cannot be resumed, and closed page sessions no longer exist.
    // Neither response disables Fetch or authorizes another request. Keep all
    // other protocol errors, timeouts and budget failures fail-closed.
    if (error?.cdpCode === -32602 && error.cdpMessage === 'Invalid InterceptionId.') {
      this.interceptionDiagnostics.staleRequests++; return;
    }
    if (error?.cdpCode === -32001 && error.cdpMessage === 'Session with given id not found.') {
      this.interceptionDiagnostics.closedPageSessions++;
      for (const [id, page] of this.pages) if (page.sessionId === sessionId) {
        this.pages.delete(id); if (this.selectedPage === id) this.selectedPage = this.pages.keys().next().value;
      }
      return;
    }
    this.interceptionDiagnostics.fatalErrors++;
    void this._close().catch(() => {});
  }

  async _attach(sessionId, target) {
    if (target.type !== 'page') { await this.send('Target.closeTarget', { targetId: target.targetId }); return; }
    if (this.pages.has(target.targetId)) return;
    if (this.pages.size >= 8) { await this.send('Target.closeTarget', { targetId: target.targetId }); return; }
    this.pages.set(target.targetId, { sessionId, ready: false });
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'DOM.enable']) await this.send(method, {}, sessionId);
    await this.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
    await this.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*', 'ftp://*'] }, sessionId);
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId);
    await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    const page = this.pages.get(target.targetId); if (page) page.ready = true;
  }
  async _settleAttachments() { await Promise.all([...(this._attachments ?? [])]); }
  _page() {
    if (this.budgetDiagnostics.closureReason === 'TIMEOUT') {
      throw new Error(`BROWSER_PAGE_NOT_AVAILABLE: Session terminated due to session timeout (${this.policy.sessionTimeoutMs}ms reached)`);
    }
    const page = this.pages.get(this.selectedPage); if (!page?.ready) throw new Error('BROWSER_PAGE_NOT_AVAILABLE'); return page.sessionId;
  }
  async _eval(expression) {
    if (this.dialog?.sessionId === this._page()) throw new Error('BROWSER_DIALOG_REQUIRES_DECISION');
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 5000 }, this._page());
    if (response.exceptionDetails) throw new Error('BROWSER_EVALUATION_FAILED');
    const value = response.result?.value;
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > 131072) throw new Error('BROWSER_OUTPUT_BUDGET_EXCEEDED');
    return value;
  }

  async listPages() {
    const { targetInfos } = await this.send('Target.getTargets');
    return targetInfos.filter((item) => this.pages.has(item.targetId)).map((item) => ({ pageId: item.targetId,
      selected: item.targetId === this.selectedPage, url: safeUrl(item.url), title: redact(item.title) }));
  }
  async newPage(url = 'about:blank') {
    this._allowed(url); if (this.pages.size >= 8) throw new Error('BROWSER_PAGE_LIMIT');
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const deadline = Date.now() + 5000;
    while (!this.pages.get(targetId)?.ready) { if (Date.now() > deadline) throw new Error('BROWSER_PAGE_ATTACH_TIMEOUT'); await delay(20); }
    this.selectedPage = targetId;
    if (url !== 'about:blank') await this._navigate(url);
    return { pageId: targetId };
  }
  async selectPage(pageId) { if (!this.pages.get(pageId)?.ready) throw new Error('BROWSER_PAGE_NOT_AVAILABLE'); this.selectedPage = pageId; return { pageId }; }
  async closePage(pageId = this.selectedPage) {
    if (!this.pages.has(pageId)) throw new Error('BROWSER_PAGE_NOT_AVAILABLE');
    await this.send('Target.closeTarget', { targetId: pageId }); this.pages.delete(pageId);
    if (pageId === this.selectedPage) this.selectedPage = this.pages.keys().next().value;
    return { closed: pageId };
  }
  async _navigate(url, { waitUntil = 'load', timeoutMs = 10000 } = {}) {
    this._allowed(url); integer(timeoutMs, 10000);
    if (!['load', 'domcontentloaded', 'none'].includes(waitUntil)) throw new Error('BROWSER_INVALID_WAIT');
    const result = await this.send('Page.navigate', { url }, this._page());
    if (result.errorText) throw new Error(`BROWSER_NAVIGATION_FAILED:${redact(result.errorText)}`);
    if (waitUntil !== 'none') {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const state = await this._eval('({ready:document.readyState,url:location.href})');
        this._allowed(state.url);
        if ((waitUntil === 'load' && state.ready === 'complete') || (waitUntil === 'domcontentloaded' && state.ready !== 'loading')) break;
        if (Date.now() > deadline) throw new Error('BROWSER_NAVIGATION_TIMEOUT'); await delay(50);
      }
    }
    return { frameId: result.frameId, url: safeUrl(url) };
  }
  async navigate(url, options) { return this._navigate(url, options); }
  async evaluate(expression) {
    if (!this.policy.allowEvaluation) throw new Error('BROWSER_EVALUATION_HOST_AUTHORIZATION_REQUIRED');
    if (typeof expression !== 'string' || expression.length > 16384) throw new Error('BROWSER_INVALID_EXPRESSION');
    return this._eval(expression);
  }
  _selector(selector) { if (typeof selector !== 'string' || !selector.trim() || selector.length > 1024) throw new Error('BROWSER_INVALID_SELECTOR'); return JSON.stringify(selector); }
  async waitFor(selector, { timeoutMs = 5000 } = {}) {
    integer(timeoutMs, 5000); const code = this._selector(selector); const deadline = Date.now() + timeoutMs;
    while (!await this._eval(`Boolean(document.querySelector(${code}))`)) { if (Date.now() > deadline) throw new Error('BROWSER_ELEMENT_TIMEOUT'); await delay(50); }
    return { found: true };
  }
  async findElements(selector) {
    const elements = await this._eval(`Array.from(document.querySelectorAll(${this._selector(selector)})).slice(0,100).map((e)=>({tag:e.tagName,id:e.id,role:e.getAttribute('role'),text:e.matches('input,textarea,[contenteditable]')?'[REDACTED_INPUT]':(e.textContent||'').slice(0,256),disabled:!!e.disabled}))`);
    return elements.map((item) => ({ ...item, text: redact(item.text) }));
  }
  async _element(selector) {
    const result = await this._eval(`(()=>{const e=document.querySelector(${this._selector(selector)});if(!e||!e.isConnected)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,disabled:!!e.disabled};})()`);
    if (!result || !result.width || !result.height || result.disabled) throw new Error('BROWSER_ELEMENT_MISSING_OR_DETACHED'); return result;
  }
  async _mouse(params) {
    let opened;
    const dialog = new Promise((done) => { opened = done; });
    this._dialogWaiters ??= new Set(); this._dialogWaiters.add(opened);
    const command = this.send('Input.dispatchMouseEvent', params, this._page());
    try { await Promise.race([command, dialog]); }
    finally { this._dialogWaiters.delete(opened); }
  }
  async click(selector) { const { x, y } = await this._element(selector); for (const type of ['mousePressed', 'mouseReleased']) await this._mouse({ type, x, y, button: 'left', clickCount: 1 }); return { clicked: true, dialogOpen: Boolean(this.dialog) }; }
  async clickAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 3840 || y > 2160) throw new Error('BROWSER_INVALID_COORDINATES');
    for (const type of ['mousePressed', 'mouseReleased']) await this._mouse({ type, x, y, button: 'left', clickCount: 1 });
    return { clicked: true };
  }
  async drag(from, to) {
    const start = await this._element(from); const end = await this._element(to);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 }, this._page());
    try { for (let step = 1; step <= 8; step++) await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, button: 'left', buttons: 1 }, this._page()); }
    finally { await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 }, this._page()); }
    return { dragged: true, assurance: 'POINTER_DRAG_NOT_HTML5_DATA_TRANSFER' };
  }
  async hover(selector) { const { x, y } = await this._element(selector); await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, this._page()); return { hovered: true }; }
  async typeText(selector, text) {
    if (typeof text !== 'string' || text.length > 16384) throw new Error('BROWSER_INVALID_TEXT');
    const element = this._selector(selector);
    const ready = await this._eval(`(()=>{const e=document.querySelector(${element});if(!e||!e.isConnected||e.disabled||e.readOnly||!e.matches('input:not([type=file]),textarea,[contenteditable=true]'))return false;e.focus();if('value'in e)e.value='';else e.textContent='';return true;})()`);
    if (!ready) throw new Error('BROWSER_ELEMENT_NOT_EDITABLE'); await this.send('Input.insertText', { text }, this._page()); return { entered: true, characters: text.length };
  }
  async fillForm(fields) {
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > 32 || fields.some((field) => !field || typeof field.selector !== 'string'
      || typeof field.value !== 'string' || field.value.length > 16384)) throw new Error('BROWSER_INVALID_FORM');
    // Validation is complete before changing any field; no claim of transactionality.
    for (const field of fields) this._selector(field.selector);
    let filled = 0;
    for (const field of fields) {
      // Call the original implementation to keep this one serialized operation.
      await AfyxBrowserSession.prototype.typeText.call(this, field.selector, field.value); filled++;
    }
    return { filled, atomic: false };
  }
  async pressKey(key) {
    const keys = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
    if (!(key in keys)) throw new Error('BROWSER_UNSUPPORTED_KEY');
    for (const type of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: keys[key] }, this._page()); return { pressed: key };
  }
  async handleDialog({ accept = false, promptText = '' } = {}) {
    if (!this.dialog || this.dialog.sessionId !== this._page()) throw new Error('BROWSER_NO_DIALOG');
    if (typeof accept !== 'boolean' || typeof promptText !== 'string' || promptText.length > 4096) throw new Error('BROWSER_INVALID_DIALOG_INPUT');
    await this.send('Page.handleJavaScriptDialog', { accept, promptText }, this._page()); this.dialog = null; return { handled: true };
  }
  async uploadFile(selector, path) {
    const file = scopedPath(this.policy.uploadRoot, path);
    if (!lstatSync(file).isFile() || lstatSync(file).size > 10_000_000) throw new Error('BROWSER_UPLOAD_SIZE_DENIED');
    const { root } = await this.send('DOM.getDocument', {}, this._page());
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector: JSON.parse(this._selector(selector)) }, this._page());
    if (!nodeId) throw new Error('BROWSER_ELEMENT_MISSING_OR_DETACHED');
    const { attributes } = await this.send('DOM.getAttributes', { nodeId }, this._page());
    if (!attributes.some((value, index) => value === 'type' && attributes[index + 1] === 'file')) throw new Error('BROWSER_NOT_FILE_INPUT');
    await this.send('DOM.setFileInputFiles', { files: [file], nodeId }, this._page()); return { uploaded: true, bytes: lstatSync(file).size };
  }
  async inspectPage() {
    const page = await this._eval('({url:location.href,title:document.title,summary:{links:document.links.length,forms:document.forms.length,buttons:document.querySelectorAll("button").length}})');
    page.url = safeUrl(page.url); page.title = redact(page.title); return { ...page, summary: { ...page.summary, consoleMessages: this.consoleLogs.length, networkRequests: this.networkRequests.length } };
  }
  async snapshot({ limit = 100 } = {}) {
    integer(limit, 100, 200);
    const { nodes } = await this.send('Accessibility.getFullAXTree', { depth: 8 }, this._page());
    return { kind: 'ACCESSIBILITY_SNAPSHOT_UNTRUSTED_PAGE_DATA', nodes: nodes.filter((node) => !node.ignored).slice(0, limit).map((node) => ({ nodeId: node.nodeId,
      role: node.role?.value, name: node.role?.value === 'textbox' || sensitive.test(node.name?.value ?? '') ? '[REDACTED_INPUT]' : redact(node.name?.value),
      childIds: node.childIds?.slice(0, 30) })), truncated: nodes.length > limit };
  }
  async getComputedStyles(selector, properties = ['display', 'color', 'background-color', 'font-size', 'width', 'height']) {
    if (!Array.isArray(properties) || properties.length > 32 || properties.some((value) => typeof value !== 'string' || !/^[a-z-]{1,64}$/.test(value))) throw new Error('BROWSER_INVALID_STYLE_PROPERTIES');
    return this._eval(`(()=>{const e=document.querySelector(${this._selector(selector)});if(!e)return null;const s=getComputedStyle(e);return Object.fromEntries(${JSON.stringify(properties)}.map(p=>[p,s.getPropertyValue(p).slice(0,256)]));})()`);
  }
  async takeScreenshot({ format = 'png', quality = 80 } = {}) {
    if (!['png', 'jpeg'].includes(format)) throw new Error('BROWSER_INVALID_SCREENSHOT_FORMAT');
    integer(quality, 80, 100);
    // Mask editable values before capture; arbitrary visible page text remains
    // sensitive page data and requires the host's explicit capture decision.
    const styleId = `afyx-capture-${randomUUID()}`;
    await this._eval(`(()=>{const s=document.createElement('style');s.id=${JSON.stringify(styleId)};s.textContent='input,textarea,[contenteditable]{visibility:hidden!important}';document.documentElement.appendChild(s);return true;})()`);
    try {
      const response = await this.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), captureBeyondViewport: false }, this._page());
      if (!response.data || response.data.length > 4_000_000) throw new Error('BROWSER_SCREENSHOT_BUDGET_EXCEEDED'); return response.data;
    } finally { await this._eval(`document.getElementById(${JSON.stringify(styleId)})?.remove()`); }
  }
  getConsoleMessages({ limit = 100 } = {}) { integer(limit, 100, LIMIT); return this.consoleLogs.slice(-limit).map((item) => ({ ...item })); }
  getNetworkRequests({ limit = 100, filter = '', failedOnly = false } = {}) {
    integer(limit, 100, LIMIT); if (typeof filter !== 'string' || filter.length > 256) throw new Error('BROWSER_INVALID_FILTER');
    return this.networkRequests.filter((item) => (!failedOnly || item.failed) && item.url.includes(filter)).slice(-limit).map(({ pageSession, ...item }) => ({ ...item }));
  }
  getNetworkRequest(requestId) {
    if (typeof requestId !== 'string' || requestId.length > 256) throw new Error('BROWSER_INVALID_REQUEST_ID');
    const item = this.getNetworkRequests({ limit: LIMIT }).findLast((entry) => entry.requestId === requestId);
    if (!item) throw new Error('BROWSER_NETWORK_REQUEST_NOT_FOUND'); return item;
  }
  async resourceTiming() {
    const entries = await this._eval(`performance.getEntriesByType('resource').slice(-100).map(e=>({name:e.name,duration:e.duration,transferSize:e.transferSize,initiatorType:e.initiatorType}))`);
    return entries.map((entry) => ({ ...entry, name: safeUrl(entry.name) }));
  }
  async performanceMetrics() { await this.send('Performance.enable', {}, this._page()); const { metrics } = await this.send('Performance.getMetrics', {}, this._page()); return metrics.filter((item) => /^(Timestamp|Documents|Frames|Nodes|JSHeapUsedSize|JSHeapTotalSize|TaskDuration|ScriptDuration|LayoutDuration|RecalcStyleDuration)$/.test(item.name)); }
  async emulate({ width = 1280, height = 800, deviceScaleFactor = 1, mobile = false, offline = false } = {}) {
    integer(width, 1280, 3840); integer(height, 800, 2160);
    if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 0.5 || deviceScaleFactor > 3 || typeof mobile !== 'boolean' || typeof offline !== 'boolean') throw new Error('BROWSER_INVALID_EMULATION');
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile }, this._page());
    await this.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, this._page()); return { width, height, mobile, offline };
  }
  async traceStart() {
    if (this.trace?.active) throw new Error('BROWSER_TRACE_ALREADY_ACTIVE');
    this.trace = { active: true, events: [], bytes: 0, truncated: false };
    try { await this.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', options: 'record-as-much-as-possible', transferMode: 'ReportEvents' }); }
    catch (error) { this.trace.active = false; throw error; }
    this._traceExpiry = setTimeout(() => { void this.traceStop().catch(() => this._close()); }, 10000); this._traceExpiry.unref();
    return { recording: true, maxDurationMs: 10000, maxBytes: this.policy.maxTraceBytes };
  }
  async traceStop({ includeEvents = false } = {}) {
    if (typeof includeEvents !== 'boolean') throw new Error('BROWSER_INVALID_TRACE_OPTIONS');
    if (!this.trace?.active) throw new Error('BROWSER_TRACE_NOT_ACTIVE');
    clearTimeout(this._traceExpiry);
    let timer;
    const completed = new Promise((done, fail) => { this.trace.complete = done; timer = setTimeout(() => fail(new Error('BROWSER_TRACE_STOP_TIMEOUT')), 5000); });
    void completed.catch(() => {});
    try { await this.send('Tracing.end'); await completed; }
    finally { clearTimeout(timer); this.trace.active = false; delete this.trace.complete; }
    const longTasks = this.trace.events.filter((item) => item.dur > 50000).length;
    return { ...(includeEvents ? { events: this.trace.events } : {}), eventCount: this.trace.events.length,
      truncated: this.trace.truncated, bytes: this.trace.bytes, analysis: { longTasks,
      assurance: 'BOUNDED_CDP_EVENTS_NOT_FULL_PERFORMANCE_AUDIT' } };
  }
  async exportTrace(path) {
    if (!this.trace || this.trace.active) throw new Error('BROWSER_COMPLETED_TRACE_REQUIRED');
    const file = scopedPath(this.policy.exportRoot, path, false);
    const body = JSON.stringify({ traceEvents: this.trace.events, truncated: this.trace.truncated });
    writeFileSync(file, body, { flag: 'wx', mode: 0o600 }); return { path: file, bytes: Buffer.byteLength(body) };
  }
  async _close() {
    clearTimeout(this._expiry); clearTimeout(this._traceExpiry);
    if (this._exitCleanup) process.removeListener('exit', this._exitCleanup);
    if (!this.budgetDiagnostics.closureReason) {
      this.budgetDiagnostics.closureReason = 'CLOSED';
      this.budgetDiagnostics.interruptionSource = 'HOST_REQUEST';
    }
    const child = this.process; this.process = null;
    this.ws?.close(); this.ws = null; this.isAttached = false; this._rejectPending('BROWSER_SESSION_CLOSED');
    if (child && child.exitCode === null) { child.kill(); await Promise.race([this._processExited, delay(3000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await Promise.race([this._processExited, delay(2000)]); } }
    if (child && child.exitCode === null && child.signalCode === null) { this.process = child; throw new Error('BROWSER_PROCESS_STOP_FAILED'); }
    if (this.userDataDir) {
      const owned = this.userDataDir;
      if (dirname(owned) !== realpathSync(tmpdir()) || !owned.includes('afyx-browser-session-') || lstatSync(owned).isSymbolicLink()) throw new Error('BROWSER_PROFILE_OWNERSHIP_FAILED');
      rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); this.userDataDir = null;
    }
    this.pages.clear(); this.selectedPage = null;
    return { closed: true, processExited: true, profileRemoved: this.userDataDir === null };
  }
  async close() { return this._close(); }
}

// =============================================================================
// Standalone CLI Runner
// =============================================================================

async function runCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
AFYX Browser DevTools â€” Native Browser Engineering & Diagnostics

Usage:
  node scripts/afyx-browser-devtools.mjs [options]

Commands & Options:
  --detect             Detect available Chrome/Chromium installation on host
  --inspect <url>      Launch isolated session, navigate, and print diagnostics
  --screenshot <url>   Capture screenshot of target URL to output file
  --out <file>         Destination file path for screenshot
  --allow-origin <url> Explicit trusted HTTP(S) origin (repeatable); other origins denied
  --session-timeout-ms <ms> Session lifetime budget in ms (300000..1800000, default: 300000)
  --headless           Run in headless mode (default: true)
  --no-headless        Run with visible browser window
  --version            Display version information
`);
    process.exit(0);
  }

  if (args.includes('--detect')) {
    const found = findChromeBinary();
    if (found) {
      console.log(`[DETECT] Compatible browser binary: ${found}`);
      process.exit(0);
    } else {
      console.error('[DETECT] No compatible Chrome/Chromium executable detected on host.');
      process.exit(1);
    }
  }

  const inspectIdx = args.indexOf('--inspect');
  const allowedOrigins = args.flatMap((value, index) => value === '--allow-origin' ? [args[index + 1]] : []);
  if (inspectIdx !== -1 && args[inspectIdx + 1]) {
    const targetUrl = args[inspectIdx + 1];
    const session = new AfyxBrowserSession({ headless: !args.includes('--no-headless'), allowedOrigins });
    try {
      console.log(`Launching isolated AFYX browser session...`);
      const info = await session.launch();
      console.log(`Connected to ${info.browser} on port ${info.port}`);
      console.log(`Navigating to ${targetUrl}...`);
      await session.navigate(targetUrl);
      const inspection = await session.inspectPage();
      console.log('\n--- Page Inspection ---');
      console.log(`URL:   ${inspection.url}`);
      console.log(`Title: ${inspection.title}`);
      console.log(`DOM:   ${JSON.stringify(inspection.summary)}`);
      console.log(`\nConsole logs captured: ${session.getConsoleMessages().length}`);
      console.log(`Network requests captured: ${session.getNetworkRequests().length}`);
      await session.close();
      console.log('Session closed cleanly.');
    } catch (err) {
      await session.close();
      console.error(`Browser inspection failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  const screenIdx = args.indexOf('--screenshot');
  if (screenIdx !== -1 && args[screenIdx + 1]) {
    const targetUrl = args[screenIdx + 1];
    const outIdx = args.indexOf('--out');
    const outFile = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : 'screenshot.png';

    const session = new AfyxBrowserSession({ headless: true, allowedOrigins });
    try {
      await session.launch();
      await session.navigate(targetUrl);
      const b64 = await session.takeScreenshot();
      writeFileSync(outFile, Buffer.from(b64, 'base64'), { flag: 'wx', mode: 0o600 });
      console.log(`Screenshot saved to ${outFile}`);
      await session.close();
    } catch (err) {
      await session.close();
      console.error(`Screenshot failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  console.log('AFYX Browser DevTools engine ready. Run with --help for available options.');
}

if (process.argv[1] && process.argv[1].endsWith('afyx-browser-devtools.mjs')) {
  runCli().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
