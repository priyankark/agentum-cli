/**
 * Input handler for VNC mouse and keyboard events
 * Uses @hurdlegroup/robotjs for native input simulation
 *
 * World-class implementation with:
 * - Robust key name mapping for cross-platform compatibility
 * - Full support for special keys, modifiers, and key combinations
 * - Comprehensive error handling and logging
 */

import type { VNCMouseEvent, VNCScrollEvent, VNCKeyboardEvent, ScreenDimensions } from './types';

// Lazy load robotjs to avoid issues if not installed
let robot: typeof import('@hurdlegroup/robotjs') | null = null;

/**
 * Key name mapping from client-friendly names to robotjs-compatible names
 * robotjs uses specific key names that differ from common naming conventions
 */
const KEY_MAP: Record<string, string> = {
  // Special keys
  'backspace': 'backspace',
  'delete': 'delete',
  'enter': 'enter',         // Native RobotJS key table uses 'enter'.
  'return': 'enter',
  'tab': 'tab',
  'escape': 'escape',
  'esc': 'escape',
  'space': 'space',

  // Arrow keys
  'up': 'up',
  'down': 'down',
  'left': 'left',
  'right': 'right',
  'arrowup': 'up',
  'arrowdown': 'down',
  'arrowleft': 'left',
  'arrowright': 'right',

  // Navigation keys
  'home': 'home',
  'end': 'end',
  'pageup': 'pageup',
  'pagedown': 'pagedown',
  'insert': 'insert',

  // Function keys
  'f1': 'f1',
  'f2': 'f2',
  'f3': 'f3',
  'f4': 'f4',
  'f5': 'f5',
  'f6': 'f6',
  'f7': 'f7',
  'f8': 'f8',
  'f9': 'f9',
  'f10': 'f10',
  'f11': 'f11',
  'f12': 'f12',

  // Modifier keys (for standalone key taps)
  'shift': 'shift',
  'control': 'control',
  'ctrl': 'control',
  'alt': 'alt',
  'option': 'alt',
  'command': 'command',
  'cmd': 'command',
  'meta': 'command',
  'win': 'command',

  // Numpad keys
  'numpad0': 'numpad_0',
  'numpad1': 'numpad_1',
  'numpad2': 'numpad_2',
  'numpad3': 'numpad_3',
  'numpad4': 'numpad_4',
  'numpad5': 'numpad_5',
  'numpad6': 'numpad_6',
  'numpad7': 'numpad_7',
  'numpad8': 'numpad_8',
  'numpad9': 'numpad_9',

  // Media keys
  'volumeup': 'audio_vol_up',
  'volumedown': 'audio_vol_down',
  'volumemute': 'audio_mute',
  'playpause': 'audio_play',
  'nexttrack': 'audio_next',
  'prevtrack': 'audio_prev',
};

/**
 * Modifier name mapping to robotjs-compatible modifier names
 */
const MODIFIER_MAP: Record<string, string> = {
  'shift': 'shift',
  'control': 'control',
  'ctrl': 'control',
  'alt': 'alt',
  'option': 'alt',
  'command': 'command',
  'cmd': 'command',
  'meta': 'command',
  'win': 'command',
};

/**
 * Initialize robotjs module
 * Returns true if successful, false otherwise
 */
export function initializeRobot(): boolean {
  if (robot) return true;

  try {
    // Dynamic import to handle cases where native module isn't available
    robot = require('@hurdlegroup/robotjs');
    console.log('[VNC Input] robotjs loaded successfully');
    return true;
  } catch (error) {
    console.error('[VNC Input] Failed to load robotjs:', error);
    return false;
  }
}

/**
 * Get screen size from robotjs
 */
export function getScreenSize(): ScreenDimensions {
  if (!robot && !initializeRobot()) {
    return { width: 1920, height: 1080 }; // Fallback
  }

  return robot!.getScreenSize();
}

/**
 * Handle mouse event from VNC client
 * Scales coordinates from client screen space to actual screen space
 */
export function handleMouseEvent(event: VNCMouseEvent): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for mouse events');
    return;
  }

  try {
    const screenSize = robot!.getScreenSize();

    // Scale coordinates from client space to actual screen coordinates
    const actualX = Math.floor((event.x / event.screenWidth) * screenSize.width);
    const actualY = Math.floor((event.y / event.screenHeight) * screenSize.height);

    // Clamp coordinates to screen bounds
    const clampedX = Math.max(0, Math.min(actualX, screenSize.width - 1));
    const clampedY = Math.max(0, Math.min(actualY, screenSize.height - 1));

    // Move mouse to position
    robot!.moveMouse(clampedX, clampedY);

    // Handle click events
    switch (event.eventType) {
      case 'down':
        robot!.mouseToggle('down', event.button || 'left');
        break;
      case 'up':
        robot!.mouseToggle('up', event.button || 'left');
        break;
      case 'move':
        // Already moved above
        break;
    }
  } catch (error) {
    console.error('[VNC Input] Error handling mouse event:', error);
  }
}

/**
 * Normalize key name to robotjs-compatible format
 */
function normalizeKeyName(key: string): string {
  const lowercaseKey = key.toLowerCase();

  // Check if it's a mapped special key
  if (KEY_MAP[lowercaseKey]) {
    return KEY_MAP[lowercaseKey];
  }

  // Single character keys are used as-is (lowercase)
  if (key.length === 1) {
    return key.toLowerCase();
  }

  // Unknown key, try as-is
  return lowercaseKey;
}

/**
 * Normalize modifier names to robotjs-compatible format
 */
function normalizeModifiers(modifiers: string | string[] | undefined): string[] {
  if (!modifiers) return [];

  const modArray = Array.isArray(modifiers) ? modifiers : [modifiers];
  return modArray
    .map(mod => MODIFIER_MAP[mod.toLowerCase()] || mod.toLowerCase())
    .filter((mod, index, self) => self.indexOf(mod) === index); // Remove duplicates
}

/**
 * Handle keyboard event from VNC client
 * Supports modifier keys (shift, ctrl, alt, meta/command)
 *
 * Key features:
 * - Automatic key name normalization for cross-platform compatibility
 * - Support for all common special keys
 * - Proper modifier key handling
 */
export function handleKeyboardEvent(event: VNCKeyboardEvent): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for keyboard events');
    return;
  }

  try {
    const { key, modifier } = event;

    // Normalize the key name
    const normalizedKey = normalizeKeyName(key);
    const normalizedModifiers = normalizeModifiers(modifier);


    if (normalizedModifiers.length > 0) {
      try {
        robot!.keyTap(normalizedKey, normalizedModifiers as any);
      } finally {
        // Clear modifier flags before subsequent Unicode typeString events on macOS.
        for (const modifier of normalizedModifiers) robot!.keyToggle(modifier, 'up');
      }
    } else {
      robot!.keyTap(normalizedKey);
    }
  } catch (error) {
    console.error(`[VNC Input] Error handling keyboard event for key "${event.key}":`, error);
  }
}

/**
 * Type text string using typeString for regular text
 * This is more reliable for multi-character input
 */
export function typeString(text: string): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for typing');
    return;
  }

  try {
    robot!.typeString(text);
  } catch (error) {
    console.error('[VNC Input] Error typing string:', error);
  }
}

/**
 * Type a single character using keyTap
 * More reliable for special characters that typeString may not handle
 */
export function typeCharacter(char: string): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for typing character');
    return;
  }

  try {
    // Check if it's a character that needs shift
    const needsShift = /[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(char);
    const shiftedChars: Record<string, string> = {
      '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
      '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
      '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
      ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
      '~': '`',
    };

    if (needsShift) {
      const baseChar = shiftedChars[char] || char.toLowerCase();
      robot!.keyTap(baseChar, ['shift']);
    } else {
      robot!.keyTap(char.toLowerCase());
    }
  } catch (error) {
    console.error('[VNC Input] Error typing character:', error);
    // Fallback to typeString
    try {
      robot!.typeString(char);
    } catch {
      // Silent fail
    }
  }
}

/**
 * Type a single character or string and optionally press enter
 */
export function typeText(text: string, pressEnter: boolean = false): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for typing');
    return;
  }

  try {
    robot!.typeString(text);
    if (pressEnter) {
      robot!.keyTap('enter');
    }
  } catch (error) {
    console.error('[VNC Input] Error typing text:', error);
  }
}

/**
 * Perform a key combination (e.g., Cmd+C, Ctrl+V)
 */
export function keyCombo(key: string, modifiers: string[]): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for key combo');
    return;
  }

  try {
    const normalizedKey = normalizeKeyName(key);
    const normalizedModifiers = normalizeModifiers(modifiers);
    robot!.keyTap(normalizedKey, normalizedModifiers as any);
  } catch (error) {
    console.error('[VNC Input] Error performing key combo:', error);
  }
}

/**
 * Hold a key down (for drag operations or continuous input)
 */
export function keyToggle(key: string, down: boolean, modifiers?: string[]): void {
  if (!robot && !initializeRobot()) {
    console.error('[VNC Input] robotjs not available for key toggle');
    return;
  }

  try {
    const normalizedKey = normalizeKeyName(key);
    const normalizedModifiers = normalizeModifiers(modifiers);
    const state = down ? 'down' : 'up';

    if (normalizedModifiers.length > 0) {
      robot!.keyToggle(normalizedKey, state, normalizedModifiers as any);
    } else {
      robot!.keyToggle(normalizedKey, state);
    }
  } catch (error) {
    console.error('[VNC Input] Error toggling key:', error);
  }
}

/**
 * Check if robotjs is available
 */
export function isRobotAvailable(): boolean {
  return robot !== null || initializeRobot();
}

export default {
  initializeRobot,
  getScreenSize,
  handleMouseEvent,
  handleKeyboardEvent,
  typeString,
  typeCharacter,
  typeText,
  keyCombo,
  keyToggle,
  isRobotAvailable,
};

/** Release without moving the pointer back to the original drag position. */
export function releaseMouseButton(button: 'left' | 'right' | 'middle'): void {
  if (!robot) return;
  try { robot.mouseToggle('up', button); } catch { /* Best effort on driver teardown. */ }
}

export function nativeScrollDelta(ticks: number, platform: string = process.platform): number {
  return ticks * (platform === 'win32' ? 120 : platform === 'darwin' ? 12 : 1);
}

export function handleScrollEvent(event: VNCScrollEvent): void {
  if (!robot && !initializeRobot()) return;
  handleMouseEvent({ ...event, type: 'vnc_mouse_event', eventType: 'move' });
  robot!.scrollMouse(nativeScrollDelta(event.deltaX), nativeScrollDelta(event.deltaY));
}
