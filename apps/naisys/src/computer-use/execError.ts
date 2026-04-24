export type ExecError = Error & {
  readonly code?: string;
  readonly stderr?: Buffer | string;
  readonly killed?: boolean;
  readonly signal?: NodeJS.Signals | null;
};
