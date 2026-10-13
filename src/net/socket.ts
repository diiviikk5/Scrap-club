import type { Wire } from './netgame';

/** WebSocket connection to the Scrap Club relay server. */
export class NetSocket implements Wire {
  ws: WebSocket | null = null;
  onMessage: ((msg: any) => void) | null = null;
  /** lobby-level listeners (independent of the in-game handler) */
  listeners = new Set<(msg: any) => void>();
  onClose: ((reason: string) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
  }

  static defaultUrl() {
    const env = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
    if (env) return env;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // vite dev server runs on 5173; the game server listens on 8787
    const host = location.port === '5173' ? `${location.hostname}:8787` : location.host;
    return `${proto}//${host}/ws`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false;
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      const timer = setTimeout(() => {
        if (!opened) {
          this.ws?.close();
          reject(new Error('Connection timed out'));
        }
      }, 6000);
      this.ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        if (!opened) {
          clearTimeout(timer);
          reject(new Error('Could not reach the arena server'));
        }
      };
      this.ws.onclose = () => {
        if (opened) this.onClose?.('Connection lost');
      };
      this.ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        for (const l of this.listeners) l(msg);
        this.onMessage?.(msg);
      };
    });
  }

  send(msg: any) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.onClose = null;
    this.ws?.close();
    this.ws = null;
  }
}
