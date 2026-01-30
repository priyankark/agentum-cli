/**
 * VNC-specific type definitions for screen sharing functionality
 */

/**
 * VNC quality settings for adaptive screen capture
 */
export interface VNCQualitySettings {
  width: number;
  jpegQuality: number;
  fps: number;
}

/**
 * Screen dimensions
 */
export interface ScreenDimensions {
  width: number;
  height: number;
}

/**
 * VNC mouse event types
 */
export type VNCMouseEventType = 'down' | 'up' | 'move';

/**
 * VNC mouse event from client
 */
export interface VNCMouseEvent {
  type: 'vnc_mouse_event';
  x: number;
  y: number;
  eventType: VNCMouseEventType;
  screenWidth: number;
  screenHeight: number;
  timestamp: number;
}

/**
 * VNC keyboard event from client
 */
export interface VNCKeyboardEvent {
  type: 'vnc_keyboard_event';
  key: string;
  modifier?: string | string[];
  timestamp: number;
}

/**
 * VNC type text event from client (for typing strings)
 */
export interface VNCTypeEvent {
  type: 'vnc_type';
  text: string;
  timestamp: number;
}

/**
 * VNC quality update from client
 */
export interface VNCQualityUpdate {
  type: 'vnc_quality_update';
  width?: number;
  jpegQuality?: number;
  fps?: number;
  timestamp: number;
}

/**
 * VNC screen update to client
 */
export interface VNCScreenUpdate {
  type: 'vnc_screen_update';
  image: string;  // Base64-encoded JPEG
  dimensions: ScreenDimensions;
  timestamp: number;
}

/**
 * VNC start message from client
 */
export interface VNCStartMessage {
  type: 'vnc_start';
  timestamp: number;
}

/**
 * VNC stop message from client
 */
export interface VNCStopMessage {
  type: 'vnc_stop';
  timestamp: number;
}

/**
 * VNC started confirmation to client
 */
export interface VNCStartedMessage {
  type: 'vnc_started';
  dimensions: ScreenDimensions;
  timestamp: number;
}

/**
 * VNC stopped confirmation to client
 */
export interface VNCStoppedMessage {
  type: 'vnc_stopped';
  timestamp: number;
}

/**
 * VNC error message
 */
export interface VNCErrorMessage {
  type: 'vnc_error';
  error: string;
  timestamp: number;
}

/**
 * Union type for all VNC messages from client
 */
export type VNCClientMessage =
  | VNCMouseEvent
  | VNCKeyboardEvent
  | VNCTypeEvent
  | VNCQualityUpdate
  | VNCStartMessage
  | VNCStopMessage;

/**
 * Union type for all VNC messages to client
 */
export type VNCServerMessage =
  | VNCScreenUpdate
  | VNCStartedMessage
  | VNCStoppedMessage
  | VNCErrorMessage;

/**
 * Frame callback type for screen capture subscribers
 */
export type FrameCallback = (
  frame: Buffer,
  dimensions: ScreenDimensions
) => void;

/**
 * VNC client connection state
 */
export interface VNCClientState {
  id: string;
  connectedAt: number;
  lastActivity: number;
  isStreaming: boolean;
}
