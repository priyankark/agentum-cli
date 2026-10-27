import { loadRustAddon } from './native-addon';
import type { ScreenDimensions } from './types';

export type MouseButton = 'left' | 'right' | 'middle';
export interface InputBackend {
  getScreenSize(): ScreenDimensions;
  moveMouse(x: number, y: number): void;
  mouseToggle(state: 'down' | 'up', button: MouseButton): void;
  scrollMouse(x: number, y: number): void;
  keyTap(key: string, modifiers?: string[]): void;
  keyToggle(key: string, state: 'down' | 'up', modifiers?: string[]): void;
  typeString(text: string): void;
}
interface RustAddon extends InputBackend {
  dragMouse(x: number, y: number, button: MouseButton): void;
  getPermissions(): { accessibility?: boolean | null; screenCapture?: boolean | null };
}

/** Translate RobotJS move-while-held semantics into Rust's explicit drag API. */
export function createRustBackend(addon: RustAddon): InputBackend {
  for (const method of ['getScreenSize', 'moveMouse', 'dragMouse', 'mouseToggle',
    'scrollMouse', 'keyTap', 'keyToggle', 'typeString', 'getPermissions'] as const) {
    if (typeof addon?.[method] !== 'function') throw new Error(`Rusty Robot addon is missing ${method}`);
  }
  const ensureInputPermission = () => {
    if (addon.getPermissions().accessibility === false) throw new Error('Grant Accessibility permission to the Agentum host in System Settings → Privacy & Security → Accessibility');
  };
  const held = new Set<MouseButton>();
  return {
    getScreenSize: () => addon.getScreenSize(),
    moveMouse(x, y) {
      ensureInputPermission();
      const button = [...held].at(-1);
      if (button) addon.dragMouse(x, y, button);
      else addon.moveMouse(x, y);
    },
    mouseToggle(state, button) {
      ensureInputPermission();
      addon.mouseToggle(state, button);
      // Change state only after a successful native event; failed releases can retry.
      if (state === 'down') held.add(button);
      else held.delete(button);
    },
    scrollMouse: (x, y) => { ensureInputPermission(); addon.scrollMouse(x, y); },
    keyTap: (key, modifiers) => { ensureInputPermission(); addon.keyTap(key, modifiers); },
    keyToggle: (key, state, modifiers) => { ensureInputPermission(); addon.keyToggle(key, state, modifiers); },
    typeString: (text) => { ensureInputPermission(); addon.typeString(text); },
  };
}

export function loadRustBackend(): InputBackend {
  return createRustBackend(loadRustAddon<RustAddon>());
}
