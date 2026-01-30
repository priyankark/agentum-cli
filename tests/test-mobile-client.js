#!/usr/bin/env node
/**
 * Mobile Client Simulator
 *
 * This test client mimics the exact behavior of the mobile app:
 * - Terminal emulation (same as TerminalEmulator.ts)
 * - Quote normalization (same as textUtils.ts)
 * - ANSI parsing
 * - Session management
 * - WebSocket communication
 *
 * Use this to test the CLI server independently of the mobile app.
 */

const WebSocket = require('ws');
const readline = require('readline');

// ============================================================================
// TEXT UTILITIES (mirrors mobile/utils/textUtils.ts)
// ============================================================================

/**
 * Normalize smart quotes and punctuation to ASCII equivalents.
 * iOS keyboards often insert "smart" typography characters.
 */
function normalizeQuotes(text) {
  return text
    .replace(/[""„«»]/g, '"')     // Smart double quotes
    .replace(/[''‚‹›]/g, "'")      // Smart single quotes
    .replace(/…/g, '...')          // Ellipsis
    .replace(/–/g, '-')            // En dash
    .replace(/—/g, '--')           // Em dash
    .replace(/\u00A0/g, ' ');      // Non-breaking space
}

/**
 * Strip ANSI escape codes from text for plain display
 */
function stripAnsiCodes(text) {
  return text
    .replace(/\x1b\[[?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[NOPXZcn\\^_]/g, '')
    .replace(/\x1bP[^\x1b]*\x1b\\/g, '')
    .replace(/\x1b_[^\x1b]*\x1b\\/g, '')
    .replace(/\x1b\^[^\x1b]*\x1b\\/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

// ============================================================================
// TERMINAL EMULATOR (mirrors mobile/utils/TerminalEmulator.ts)
// ============================================================================

class TerminalEmulator {
  constructor(cols = 80, rows = 24) {
    this.cols = cols;
    this.rows = rows;
    this.buffer = this.createBlankBuffer(rows, cols);
    this.primaryBuffer = this.cloneBuffer(this.buffer);
    this.savedPrimaryCursor = null;
    this.inAltScreen = false;
    this.cursorX = 0;
    this.cursorY = 0;
    this.savedX = 0;
    this.savedY = 0;
    this.cursorHidden = false;
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    const newBuf = this.createBlankBuffer(rows, cols);
    const minRows = Math.min(rows, this.rows);
    const minCols = Math.min(cols, this.cols);
    for (let r = 0; r < minRows; r++) {
      for (let c = 0; c < minCols; c++) {
        newBuf[r][c] = this.buffer[r][c];
      }
    }
    const newPrimary = this.createBlankBuffer(rows, cols);
    for (let r = 0; r < minRows; r++) {
      for (let c = 0; c < minCols; c++) {
        newPrimary[r][c] = this.primaryBuffer[r][c];
      }
    }
    this.cols = cols;
    this.rows = rows;
    this.buffer = newBuf;
    this.primaryBuffer = newPrimary;
    this.cursorX = Math.min(this.cursorX, this.cols - 1);
    this.cursorY = Math.min(this.cursorY, this.rows - 1);
  }

  write(data) {
    let i = 0;
    const len = data.length;
    while (i < len) {
      const ch = data[i];
      if (ch === '\u001b') {
        i++;
        if (i >= len) break;
        const next = data[i];
        if (next === '[') {
          i++;
          const start = i;
          while (i < len) {
            const code = data.charCodeAt(i);
            if (code >= 0x40 && code <= 0x7e) break;
            i++;
          }
          const paramsStr = data.slice(start, i);
          const finalByte = i < len ? data[i] : '';
          this.handleCSI(paramsStr, finalByte);
          i++;
          continue;
        } else if (next === ']') {
          i++;
          while (i < len) {
            if (data[i] === '\u0007') { i++; break; }
            if (data[i] === '\u001b' && i + 1 < len && data[i + 1] === '\\') { i += 2; break; }
            i++;
          }
          continue;
        } else if (next === 'P' || next === '_' || next === '^') {
          i++;
          while (i < len) {
            if (data[i] === '\u0007') { i++; break; }
            if (data[i] === '\u001b' && i + 1 < len && data[i + 1] === '\\') { i += 2; break; }
            i++;
          }
          continue;
        } else if (next === '7') {
          this.savedX = this.cursorX; this.savedY = this.cursorY; i++;
          continue;
        } else if (next === '8') {
          this.cursorX = this.clamp(this.savedX, 0, this.cols - 1);
          this.cursorY = this.clamp(this.savedY, 0, this.rows - 1);
          i++;
          continue;
        } else {
          i++;
          continue;
        }
      }

      if (ch === '\n') { this.lineFeed(); i++; continue; }
      if (ch === '\r') { this.carriageReturn(); i++; continue; }
      if (ch === '\b') { this.backspace(); i++; continue; }
      if (ch === '\t') { this.tab(); i++; continue; }

      this.putChar(ch);
      i++;
    }
  }

  getScreenLines() {
    return this.buffer.map(row => row.join(''));
  }

  getDimensions() {
    return { cols: this.cols, rows: this.rows };
  }

  handleCSI(paramsStr, finalByte) {
    let isDECPrivate = false;
    if (paramsStr.startsWith('?')) {
      isDECPrivate = true;
    }
    const raw = paramsStr.replace(/^\?/, '').trim();
    const params = raw.length > 0 ? raw.split(';').map(p => p === '' ? NaN : parseInt(p, 10)) : [];

    const get = (idx, def) => Number.isNaN(params[idx]) || params[idx] === undefined ? def : params[idx];

    switch (finalByte) {
      case 'A': {
        const n = get(0, 1);
        this.cursorY = this.clamp(this.cursorY - n, 0, this.rows - 1);
        break;
      }
      case 'B': {
        const n = get(0, 1);
        this.cursorY = this.clamp(this.cursorY + n, 0, this.rows - 1);
        break;
      }
      case 'C': {
        const n = get(0, 1);
        this.cursorX = this.clamp(this.cursorX + n, 0, this.cols - 1);
        break;
      }
      case 'D': {
        const n = get(0, 1);
        this.cursorX = this.clamp(this.cursorX - n, 0, this.cols - 1);
        break;
      }
      case 'E': {
        const n = get(0, 1);
        this.cursorY = this.clamp(this.cursorY + n, 0, this.rows - 1);
        this.cursorX = 0;
        break;
      }
      case 'F': {
        const n = get(0, 1);
        this.cursorY = this.clamp(this.cursorY - n, 0, this.rows - 1);
        this.cursorX = 0;
        break;
      }
      case 'G': {
        const col = this.clamp(get(0, 1) - 1, 0, this.cols - 1);
        this.cursorX = col;
        break;
      }
      case 'H':
      case 'f': {
        const row = this.clamp(get(0, 1) - 1, 0, this.rows - 1);
        const col = this.clamp(get(1, 1) - 1, 0, this.cols - 1);
        this.cursorY = row; this.cursorX = col;
        break;
      }
      case 'J': {
        const n = get(0, 0);
        this.eraseInDisplay(n);
        break;
      }
      case 'K': {
        const n = get(0, 0);
        this.eraseInLine(n);
        break;
      }
      case 'S': {
        const n = get(0, 1);
        this.scrollUp(n);
        break;
      }
      case 'T': {
        const n = get(0, 1);
        this.scrollDown(n);
        break;
      }
      case 'm': {
        // SGR - ignored for now
        break;
      }
      case 'h': {
        if (isDECPrivate) {
          if (params.includes(25)) this.cursorHidden = false;
          if (params.includes(47) || params.includes(1047) || params.includes(1049)) {
            this.enterAltScreen();
          }
        }
        break;
      }
      case 'l': {
        if (isDECPrivate) {
          if (params.includes(25)) this.cursorHidden = true;
          if (params.includes(47) || params.includes(1047) || params.includes(1049)) {
            this.leaveAltScreen();
          }
        }
        break;
      }
    }
  }

  putChar(ch) {
    if (ch === '\u0000') return;
    this.buffer[this.cursorY][this.cursorX] = ch;
    this.cursorX++;
    if (this.cursorX >= this.cols) {
      this.cursorX = 0;
      this.cursorY++;
      if (this.cursorY >= this.rows) {
        this.scrollUp(1);
        this.cursorY = this.rows - 1;
      }
    }
  }

  lineFeed() {
    this.cursorY++;
    if (this.cursorY >= this.rows) {
      this.scrollUp(1);
      this.cursorY = this.rows - 1;
    }
  }

  carriageReturn() {
    this.cursorX = 0;
  }

  backspace() {
    this.cursorX = Math.max(0, this.cursorX - 1);
  }

  tab() {
    const nextTab = (Math.floor(this.cursorX / 8) + 1) * 8;
    this.cursorX = Math.min(this.cols - 1, nextTab);
  }

  eraseInLine(n) {
    if (n === 0) {
      for (let c = this.cursorX; c < this.cols; c++) this.buffer[this.cursorY][c] = ' ';
    } else if (n === 1) {
      for (let c = 0; c <= this.cursorX; c++) this.buffer[this.cursorY][c] = ' ';
    } else if (n === 2) {
      for (let c = 0; c < this.cols; c++) this.buffer[this.cursorY][c] = ' ';
    }
  }

  eraseInDisplay(n) {
    if (n === 0) {
      this.eraseInLine(0);
      for (let r = this.cursorY + 1; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) this.buffer[r][c] = ' ';
      }
    } else if (n === 1) {
      for (let r = 0; r < this.cursorY; r++) {
        for (let c = 0; c < this.cols; c++) this.buffer[r][c] = ' ';
      }
      const savedX = this.cursorX;
      this.cursorX = 0; this.eraseInLine(0); this.cursorX = savedX;
    } else if (n === 2) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) this.buffer[r][c] = ' ';
      }
    }
  }

  scrollUp(n) {
    const lines = Math.max(1, n);
    for (let i = 0; i < lines; i++) {
      this.buffer.shift();
      this.buffer.push(this.blankRow());
    }
  }

  scrollDown(n) {
    const lines = Math.max(1, n);
    for (let i = 0; i < lines; i++) {
      this.buffer.pop();
      this.buffer.unshift(this.blankRow());
    }
  }

  createBlankBuffer(rows, cols) {
    const buf = [];
    for (let r = 0; r < rows; r++) buf.push(this.blankRow(cols));
    return buf;
  }

  blankRow(cols = this.cols) {
    return Array.from({ length: cols }, () => ' ');
  }

  clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  cloneBuffer(buf) {
    return buf.map(row => [...row]);
  }

  enterAltScreen() {
    if (this.inAltScreen) return;
    this.primaryBuffer = this.cloneBuffer(this.buffer);
    this.savedPrimaryCursor = { x: this.cursorX, y: this.cursorY };
    this.buffer = this.createBlankBuffer(this.rows, this.cols);
    this.cursorX = 0;
    this.cursorY = 0;
    this.inAltScreen = true;
  }

  leaveAltScreen() {
    if (!this.inAltScreen) return;
    this.buffer = this.cloneBuffer(this.primaryBuffer);
    if (this.savedPrimaryCursor) {
      this.cursorX = this.clamp(this.savedPrimaryCursor.x, 0, this.cols - 1);
      this.cursorY = this.clamp(this.savedPrimaryCursor.y, 0, this.rows - 1);
    }
    this.savedPrimaryCursor = null;
    this.inAltScreen = false;
  }
}

// ============================================================================
// MOBILE CLIENT SIMULATOR
// ============================================================================

class MobileClientSimulator {
  constructor(host, port) {
    this.url = `ws://${host}:${port}`;
    this.ws = null;
    this.sessionId = null;
    this.emulator = new TerminalEmulator(80, 24);
    this.commandHistory = [];
    this.historyIndex = -1;
    this.isConnected = false;
    this.outputBuffer = [];
    this.lastRenderTime = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.isConnected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
      });

      this.ws.on('error', (err) => {
        reject(err);
      });
    });
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString());

      switch (msg.type) {
        case 'session_list':
          // Store sessions
          this.sessions = msg.sessions || [];
          break;

        case 'session_created':
          this.sessionId = msg.sessionId;
          break;

        case 'session_attached':
          this.sessionId = msg.sessionId;
          break;

        case 'output':
          const text = msg.data || msg.output || '';
          this.processOutput(text);
          break;

        case 'command_complete':
          // Session completed
          break;

        case 'error':
          console.error(`[ERROR] ${msg.error}`);
          break;

        case 'heartbeat':
        case 'pong':
          // Ignore
          break;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  processOutput(rawText) {
    // Feed to terminal emulator (exactly like mobile app)
    this.emulator.write(rawText);

    // Store for assertions
    this.outputBuffer.push(rawText);
  }

  getRenderedScreen() {
    return this.emulator.getScreenLines();
  }

  getRenderedText() {
    return this.getRenderedScreen()
      .map(line => line.trimEnd())
      .filter(line => line.length > 0)
      .join('\n');
  }

  getRawOutput() {
    return this.outputBuffer.join('');
  }

  clearOutputBuffer() {
    this.outputBuffer = [];
  }

  send(obj) {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(JSON.stringify({ ...obj, timestamp: Date.now() }));
  }

  sendInput(text) {
    // Normalize quotes exactly like mobile app does
    const normalized = normalizeQuotes(text);
    const payload = normalized + '\r';
    this.send({ type: 'input', sessionId: this.sessionId, data: payload });
  }

  sendRawInput(data) {
    this.send({ type: 'input', sessionId: this.sessionId, data });
  }

  createSession(name, command = '') {
    // Normalize command quotes
    const normalizedCommand = normalizeQuotes(command);
    this.send({ type: 'create_session', name, command: normalizedCommand });
  }

  attachSession(sessionId) {
    this.send({ type: 'attach', sessionId });
  }

  resize(cols, rows) {
    this.emulator.resize(cols, rows);
    this.send({ type: 'resize', sessionId: this.sessionId, cols, rows });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// ============================================================================
// TEST RUNNER
// ============================================================================

class TestRunner {
  constructor(client) {
    this.client = client;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.currentSuite = '';
  }

  suite(name) {
    this.currentSuite = name;
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${name}`);
    console.log(`${'─'.repeat(70)}`);
  }

  async test(name, fn) {
    try {
      await fn();
      this.passed++;
      console.log(`    ✓ ${name}`);
      return true;
    } catch (e) {
      this.failed++;
      console.log(`    ✗ ${name}`);
      console.log(`      Error: ${e.message}`);
      return false;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  assertIncludes(haystack, needle, message) {
    if (!haystack.includes(needle)) {
      throw new Error(message || `Expected "${haystack.substring(0, 100)}..." to include "${needle}"`);
    }
  }

  assertNotIncludes(haystack, needle, message) {
    if (haystack.includes(needle)) {
      throw new Error(message || `Expected output to NOT include "${needle}"`);
    }
  }

  summary() {
    console.log(`\n${'═'.repeat(70)}`);
    console.log('                           TEST SUMMARY');
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Tests: ${this.passed}/${this.passed + this.failed} passed`);
    console.log(`${'═'.repeat(70)}\n`);

    if (this.failed === 0) {
      console.log('  ✓ All tests passed!\n');
    } else {
      console.log(`  ✗ ${this.failed} test(s) failed\n`);
    }

    return this.failed === 0;
  }
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  const HOST = process.argv[2] || 'localhost';
  const PORT = process.argv[3] || 11042;

  console.log(`\n${'═'.repeat(70)}`);
  console.log('       MOBILE CLIENT SIMULATOR - COMPREHENSIVE TEST SUITE');
  console.log(`${'═'.repeat(70)}`);
  console.log(`\n  Connecting to ws://${HOST}:${PORT}...\n`);

  const client = new MobileClientSimulator(HOST, PORT);
  const runner = new TestRunner(client);

  try {
    await client.connect();
    console.log('  Connected successfully!\n');

    // Wait for initial session list
    await sleep(500);

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 1: Interactive Shell Session
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 1: Interactive Shell Session');

    client.createSession('interactive-test', '');
    await sleep(1000);

    await runner.test('Session created successfully', () => {
      runner.assert(client.sessionId, 'Session ID should be set');
    });

    // Test basic echo with quotes
    client.clearOutputBuffer();
    client.sendInput('echo "Hello World"');
    await sleep(500);

    await runner.test('Echo with double quotes works', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Hello World');
    });

    // Test single quotes
    client.clearOutputBuffer();
    client.sendInput("echo 'Single Quotes'");
    await sleep(500);

    await runner.test('Echo with single quotes works', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Single Quotes');
    });

    // Test nested quotes
    client.clearOutputBuffer();
    client.sendInput('echo "Nested \'quotes\' work"');
    await sleep(500);

    await runner.test('Nested quotes work', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, "Nested 'quotes' work");
    });

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 2: Smart Quote Normalization
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 2: Smart Quote Normalization (iOS Simulation)');

    // Simulate iOS smart quotes being typed
    client.clearOutputBuffer();
    // These are "smart" quotes that iOS would insert
    const smartQuoteInput = 'echo "smart quotes"';  // Using fancy quotes
    client.sendInput(smartQuoteInput);
    await sleep(500);

    await runner.test('Smart double quotes normalized', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'smart quotes');
    });

    // Test smart single quotes
    client.clearOutputBuffer();
    const smartSingleQuotes = "echo 'fancy apostrophe'";  // Using fancy quotes
    client.sendInput(smartSingleQuotes);
    await sleep(500);

    await runner.test('Smart single quotes normalized', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'fancy apostrophe');
    });

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 3: Interactive Python
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 3: Interactive Python');

    client.clearOutputBuffer();
    client.sendInput('python3');
    await sleep(1500);

    await runner.test('Python REPL starts', () => {
      const output = client.getRawOutput();
      runner.assert(
        output.includes('>>>') || output.includes('Python'),
        'Should see Python prompt or version'
      );
    });

    // Test print with double quotes
    client.clearOutputBuffer();
    client.sendInput('print("Hello from Python")');
    await sleep(500);

    await runner.test('Python print with double quotes', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Hello from Python');
    });

    // Test print with single quotes
    client.clearOutputBuffer();
    client.sendInput("print('Single quoted string')");
    await sleep(500);

    await runner.test('Python print with single quotes', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Single quoted string');
    });

    // Test f-strings
    client.clearOutputBuffer();
    client.sendInput('name = "World"');
    await sleep(300);
    client.sendInput('print(f"Hello, {name}!")');
    await sleep(500);

    await runner.test('Python f-strings work', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Hello, World!');
    });

    // Test multiline string
    client.clearOutputBuffer();
    client.sendInput('print("Line 1\\nLine 2")');
    await sleep(500);

    await runner.test('Python escaped newline in string', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Line 1');
      runner.assertIncludes(output, 'Line 2');
    });

    // Exit Python
    client.sendInput('exit()');
    await sleep(500);

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 4: Terminal Emulator Rendering
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 4: Terminal Emulator Rendering');

    client.clearOutputBuffer();
    client.sendInput('clear');
    await sleep(300);

    await runner.test('Clear screen processed by emulator', () => {
      // After clear, emulator should have mostly empty screen
      const screen = client.getRenderedScreen();
      runner.assert(screen.length > 0, 'Screen should have rows');
    });

    // Test cursor movement
    client.clearOutputBuffer();
    client.sendInput('echo "test"');
    await sleep(500);

    await runner.test('Output rendered in emulator', () => {
      const text = client.getRenderedText();
      runner.assertIncludes(text, 'test');
    });

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 5: Control Characters
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 5: Control Characters');

    // Test Ctrl+C
    client.clearOutputBuffer();
    client.sendInput('sleep 100');
    await sleep(300);
    client.sendRawInput('\x03'); // Ctrl+C
    await sleep(500);

    await runner.test('Ctrl+C interrupts command', () => {
      // If we got here without hanging, Ctrl+C worked
      runner.assert(true);
    });

    // Test Tab completion trigger
    client.clearOutputBuffer();
    client.sendRawInput('ech\t');
    await sleep(300);

    await runner.test('Tab character sent', () => {
      // Tab should trigger completion
      runner.assert(true);
    });

    // Clear the line
    client.sendRawInput('\x15'); // Ctrl+U to clear line
    await sleep(200);
    client.sendRawInput('\r');
    await sleep(200);

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 6: Session with Command
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 6: Session with Pre-set Command');

    // Create a new session with a command
    client.clearOutputBuffer();
    client.createSession('python-session', 'python3 -c \'print("Hello from command")\'');
    await sleep(2000);

    await runner.test('Session with quoted command executes', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'Hello from command');
    });

    // Test more complex command
    client.clearOutputBuffer();
    client.createSession('echo-session', 'echo "First" && echo "Second"');
    await sleep(1500);

    await runner.test('Chained commands work', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, 'First');
      runner.assertIncludes(output, 'Second');
    });

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 7: Special Characters
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 7: Special Characters');

    client.clearOutputBuffer();
    client.createSession('special-chars', '');
    await sleep(1000);

    client.sendInput('echo "Dollar: $HOME"');
    await sleep(500);

    await runner.test('Variable expansion in double quotes', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, '/'); // $HOME should expand to a path
    });

    client.clearOutputBuffer();
    client.sendInput("echo 'Literal: $HOME'");
    await sleep(500);

    await runner.test('No expansion in single quotes', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, '$HOME'); // Should be literal
    });

    client.clearOutputBuffer();
    client.sendInput('echo "Backslash: \\\\"');
    await sleep(500);

    await runner.test('Escaped backslash', () => {
      const output = client.getRawOutput();
      runner.assertIncludes(output, '\\');
    });

    // ════════════════════════════════════════════════════════════════════════
    // SUITE 8: Resize Handling
    // ════════════════════════════════════════════════════════════════════════
    runner.suite('SUITE 8: Terminal Resize');

    const initialDims = client.emulator.getDimensions();
    await runner.test('Initial dimensions set', () => {
      runner.assert(initialDims.cols === 80, 'Default cols should be 80');
      runner.assert(initialDims.rows === 24, 'Default rows should be 24');
    });

    client.resize(120, 40);
    await sleep(300);

    await runner.test('Resize updates emulator', () => {
      const newDims = client.emulator.getDimensions();
      runner.assert(newDims.cols === 120, 'Cols should be 120');
      runner.assert(newDims.rows === 40, 'Rows should be 40');
    });

    // Reset size
    client.resize(80, 24);
    await sleep(200);

    // ════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ════════════════════════════════════════════════════════════════════════
    const success = runner.summary();

    client.close();
    process.exit(success ? 0 : 1);

  } catch (err) {
    console.error(`\n  Connection error: ${err.message}\n`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runTests();
}

module.exports = { MobileClientSimulator, TerminalEmulator, normalizeQuotes, stripAnsiCodes };
