export type TransportState = 'idle' | 'connecting' | 'connected' | 'disconnected';

export type TransportEvent =
  | { type: 'open' }
  | { type: 'close'; code: number; reason: string }
  | { type: 'message'; data: string }
  | { type: 'error'; error: Error };
