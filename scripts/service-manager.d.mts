export function resolvePm2(): any;
export function openPort(port: number): Promise<boolean>;
export function sanitize(text: unknown, root: string): string;
export function tailFile(file: string, lines?: number): string;
export class ServiceManager {
  constructor(
    root: string,
    pm2: any,
    options?: { fetch?: typeof fetch; portOpen?: (port: number) => Promise<boolean>; waitMs?: number },
  );
  app: any;
  connect(): Promise<void>;
  disconnect(): void;
  setup(): Promise<{ registered: boolean; started: boolean; initialStart?: string }>;
  start(restart?: boolean): Promise<any>;
  startAll(restart?: boolean): Promise<any>;
  stop(): Promise<{ stopped: boolean }>;
  remove(): Promise<{ removed: boolean }>;
  save(): Promise<{ saved: boolean }>;
  status(): Promise<any>;
  component(name: string, action: string): Promise<any>;
}
