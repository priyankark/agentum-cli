/**
 * VNC module exports
 * Screen sharing functionality for AirCodum-Agentum CLI
 */

// Types
export * from './types';

// Core components
export { ScreenCaptureManager } from './screen-capture';
export { VNCServer, createVNCServer } from './vnc-server';

// Input handling
export {
  initializeRobot,
  getScreenSize,
  handleMouseEvent,
  handleKeyboardEvent,
  typeString,
  isRobotAvailable,
} from './input-handler';

// Image utilities
export { createImage, resizeImage, encodeJpeg } from './image-utils';
