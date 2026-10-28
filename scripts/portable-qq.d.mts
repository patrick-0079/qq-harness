export function inspectPortable(directory: string): string;
export function verifyPortable(directory: string): {
  version: string;
  files: number;
  bytes: number;
  verified: boolean;
};
export function preparePortable(source: string, target: string): ReturnType<typeof verifyPortable>;
