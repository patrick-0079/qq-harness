export function loadLaunch(root: string): {
  dataDir: string;
  baseUrl: string;
  port: number;
  concurrency: number;
  token: string;
  allowedChats?: string[];
  snowlumaDirectory?: string;
  releaseDirectory:string;
  extensionDirectory?:string;
};
export function releaseDirectory(root:string,selected?:unknown):string;
export function managedExtensionDirectory(root:string,selected:unknown):string;
export function liveEnvironment(root: string, inherited?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
