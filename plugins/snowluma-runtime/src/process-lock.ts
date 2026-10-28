import { lockDirectory } from '@qq-harness/files';
export function lockInstallation(directory: string, lockRoot?: string): () => void {
  return lockDirectory(directory, lockRoot, 'SnowLuma');
}
