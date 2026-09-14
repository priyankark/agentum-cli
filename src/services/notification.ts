/**
 * Notification service for sending notifications via Agentum server
 */

import { WebSocket } from 'ws';
import { authHeaders } from '../auth';
import { MessageType } from '../types';

export interface NotificationOptions {
  title: string;
  body?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  type?: 'info' | 'warning' | 'error' | 'command_complete';
}

export interface NotificationTarget {
  host?: string;
  port?: number;
}

/**
 * Send a notification to connected mobile clients via the Agentum server
 */
export async function sendNotification(
  options: NotificationOptions,
  target?: NotificationTarget
): Promise<void> {
  const host = target?.host || '127.0.0.1';
  const port = target?.port || 11042;

  const ws = new WebSocket(`ws://${host}:${port}`, { headers: authHeaders() });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: MessageType.TRIGGER_NOTIFICATION,
        title: options.title,
        body: options.body || '',
        priority: options.priority || 'normal',
        notificationType: options.type || 'info',
        timestamp: Date.now(),
      }));
      // Close shortly after sending
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }, 200);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
