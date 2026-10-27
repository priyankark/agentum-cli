import { isAbsolute, resolve } from 'path';
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
  if (addon.getPermissions().accessibility === false) {
    throw new Error('Rusty Robot needs Accessibility permission for the Agentum host process');
  }
  const held = new Set<MouseButton>();
  return {
    getScreenSize: () => addon.getScreenSize(),
    moveMouse(x, y) {
      const button = [...held].at(-1);
      if (button) addon.dragMouse(x, y, button);
      else addon.moveMouse(x, y);
    },
    mouseToggle(state, button) {
      addon.mouseToggle(state, button);
      // Change state only after a successful native event; failed releases can retry.
      if (state === 'down') held.add(button);
      else held.delete(button);
    },
    scrollMouse: (x, y) => addon.scrollMouse(x, y),
    keyTap: (key, modifiers) => addon.keyTap(key, modifiers),
    keyToggle: (key, state, modifiers) => addon.keyToggle(key, state, modifiers),
    typeString: text => addon.typeString(text),
  };
}

export function loadRustBackend(): InputBackend {
  const configured = process.env.AGENTUM_RUSTY_ROBOT_PATH;
  if (configured && !isAbsolute(configured)) {
    throw new Error('AGENTUM_RUSTY_ROBOT_PATH must be an absolute path to a trusted .node addon');
  }
  const path = configured || resolve(__dirname, '../../native/rusty-robot/agentum-rusty-robot.node');
  return createRustBackend(require(path) as RustAddon);
}
