import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { logger } from '../utils/logger';

export interface UploadProgressUpdate {
  uploadId: string;
  fileName: string;
  progress: number;
  uploadedChunks: number;
  totalChunks: number;
  status: string;
  speed?: number;
  eta?: number;
  error?: string;
}

export interface WebSocketMessage {
  type: 'upload_progress' | 'system_status' | 'error';
  data: any;
  timestamp: string;
}

// Store active WebSocket connections
const activeConnections = new Set<WebSocket>();

// Setup WebSocket handlers
export function setupWebSocket(server: FastifyInstance) {
  server.register(async function (server) {
    server.get('/ws', { websocket: true }, (socket, request) => {
      logger.info(`WebSocket connection established from ${request.ip}`);
      
      // Add to active connections
      activeConnections.add(socket);

      // Send initial connection message
      sendMessage(socket, {
        type: 'system_status',
        data: { connected: true, timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      });

      // Handle incoming messages
      socket.on('message', (message) => {
        try {
          const parsedMessage = JSON.parse(message.toString());
          handleIncomingMessage(socket, parsedMessage);
        } catch (error) {
          logger.error('Failed to parse WebSocket message:', error);
          sendError(socket, 'Invalid message format');
        }
      });

      // Handle connection close
      socket.on('close', (code, reason) => {
        logger.info(`WebSocket connection closed: ${code} - ${reason}`);
        activeConnections.delete(socket);
      });

      // Handle connection errors
      socket.on('error', (error) => {
        logger.error('WebSocket error:', error);
        activeConnections.delete(socket);
      });

      // Send periodic ping to keep connection alive
      const pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000); // 30 seconds

      // Clean up interval on close
      socket.on('close', () => {
        clearInterval(pingInterval);
      });
    });
  });
}

// Handle incoming WebSocket messages
function handleIncomingMessage(socket: WebSocket, message: any) {
  switch (message.type) {
    case 'subscribe_upload':
      // Subscribe to specific upload progress
      if (message.uploadId) {
        logger.info(`Client subscribed to upload ${message.uploadId}`);
        // Store subscription info in socket metadata
        (socket as any).uploadSubscriptions = (socket as any).uploadSubscriptions || new Set();
        (socket as any).uploadSubscriptions.add(message.uploadId);
      }
      break;

    case 'unsubscribe_upload':
      // Unsubscribe from upload progress
      if (message.uploadId && (socket as any).uploadSubscriptions) {
        (socket as any).uploadSubscriptions.delete(message.uploadId);
        logger.info(`Client unsubscribed from upload ${message.uploadId}`);
      }
      break;

    case 'ping':
      // Respond to ping
      sendMessage(socket, {
        type: 'system_status',
        data: { pong: true },
        timestamp: new Date().toISOString(),
      });
      break;

    default:
      logger.warn(`Unknown WebSocket message type: ${message.type}`);
      sendError(socket, `Unknown message type: ${message.type}`);
  }
}

// Send message to a specific WebSocket connection
function sendMessage(socket: WebSocket, message: WebSocketMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send WebSocket message:', error);
    }
  }
}

// Send error message to a specific WebSocket connection
function sendError(socket: WebSocket, errorMessage: string) {
  sendMessage(socket, {
    type: 'error',
    data: { error: errorMessage },
    timestamp: new Date().toISOString(),
  });
}

// Broadcast upload progress to all subscribed connections
export async function broadcastUploadProgress(update: UploadProgressUpdate) {
  const message: WebSocketMessage = {
    type: 'upload_progress',
    data: update,
    timestamp: new Date().toISOString(),
  };

  // Send to all connections subscribed to this upload
  for (const socket of activeConnections) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        const subscriptions = (socket as any).uploadSubscriptions;
        
        // Send to connections subscribed to this specific upload or all uploads
        if (!subscriptions || subscriptions.has(update.uploadId) || subscriptions.has('*')) {
          sendMessage(socket, message);
        }
      } else {
        // Remove inactive connections
        activeConnections.delete(socket);
      }
    } catch (error) {
      logger.error('Failed to broadcast upload progress:', error);
      activeConnections.delete(socket);
    }
  }

  logger.debug(`Broadcast upload progress for ${update.uploadId} to ${activeConnections.size} connections`);
}

// Broadcast system status updates
export async function broadcastSystemStatus(status: any) {
  const message: WebSocketMessage = {
    type: 'system_status',
    data: status,
    timestamp: new Date().toISOString(),
  };

  await broadcastToAll(message);
}

// Broadcast message to all active connections
export async function broadcastToAll(message: WebSocketMessage) {
  const connectionsToRemove: WebSocket[] = [];

  for (const socket of activeConnections) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        sendMessage(socket, message);
      } else {
        connectionsToRemove.push(socket);
      }
    } catch (error) {
      logger.error('Failed to broadcast message:', error);
      connectionsToRemove.push(socket);
    }
  }

  // Clean up inactive connections
  for (const socket of connectionsToRemove) {
    activeConnections.delete(socket);
  }

  logger.debug(`Broadcast message to ${activeConnections.size} active connections`);
}

// Get active connection statistics
export function getConnectionStats() {
  return {
    activeConnections: activeConnections.size,
    connections: Array.from(activeConnections).map(socket => ({
      readyState: socket.readyState,
      subscriptions: Array.from((socket as any).uploadSubscriptions || []),
    })),
  };
}

// Gracefully close all WebSocket connections
export async function closeAllConnections() {
  logger.info(`Closing ${activeConnections.size} WebSocket connections`);

  const closePromises = Array.from(activeConnections).map(socket => {
    return new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1001, 'Server shutting down');
        socket.once('close', () => resolve());
        
        // Force close after timeout
        setTimeout(() => {
          if (socket.readyState !== WebSocket.CLOSED) {
            socket.terminate();
          }
          resolve();
        }, 5000);
      } else {
        resolve();
      }
    });
  });

  await Promise.all(closePromises);
  activeConnections.clear();
  logger.info('All WebSocket connections closed');
}

// Periodic cleanup of inactive connections
setInterval(() => {
  const inactiveConnections: WebSocket[] = [];
  
  for (const socket of activeConnections) {
    if (socket.readyState !== WebSocket.OPEN) {
      inactiveConnections.push(socket);
    }
  }

  for (const socket of inactiveConnections) {
    activeConnections.delete(socket);
  }

  if (inactiveConnections.length > 0) {
    logger.debug(`Cleaned up ${inactiveConnections.length} inactive WebSocket connections`);
  }
}, 60000); // Every minute

export default {
  setupWebSocket,
  broadcastUploadProgress,
  broadcastSystemStatus,
  broadcastToAll,
  getConnectionStats,
  closeAllConnections,
};