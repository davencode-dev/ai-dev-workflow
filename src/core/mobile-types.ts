export type MobileVerificationStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'MANUAL_REQUIRED'
  | 'DRY_RUN';

export type MobileCommand = {
  command: string;
  args?: string[];
  timeoutMs?: number;
};

export type MobileCheck = {
  id: string;
  command: MobileCommand;
};

export type EmulatorRole = {
  avd?: string;
  serial?: string;
  port?: number;
  required?: boolean;
  start?: boolean;
};

export type MaestroConfig = {
  command: MobileCommand;
  deviceFlag?: string;
  roots: string[];
  include?: string[];
  exclude?: string[];
  testOutputDir?: string;
};

export type MobileVerificationManifest = {
  schemaVersion: 1;
  platform: 'android';
  appId: string;
  launchActivity?: string;
  checks: MobileCheck[];
  build: MobileCommand & { artifact: string };
  devices: {
    primary: EmulatorRole;
    secondary?: EmulatorRole;
    bootTimeoutMs?: number;
    isolation?: 'dedicated' | 'reuse';
  };
  maestro: MaestroConfig;
  manualWorkflows?: Array<{
    id: string;
    title: string;
    reason: string;
    documentation?: string;
  }>;
  documentation: {
    inventory: string;
    verification: string;
    evidenceDir: string;
  };
};

export type MobileCommandResult = {
  command: string;
  exitCode: number;
  output: string;
  status: MobileVerificationStatus;
};

export type MobileFlowResult = {
  flow: string;
  status: MobileVerificationStatus;
  command?: string;
  output?: string;
};

export type MobileVerificationReport = {
  schemaVersion: 1;
  repository: string;
  manifest: string;
  startedAt: string;
  endedAt?: string;
  dryRun: boolean;
  status: MobileVerificationStatus;
  checks: MobileCommandResult[];
  build?: MobileCommandResult;
  devices: Array<{ role: string; serial?: string; status: MobileVerificationStatus; reason?: string }>;
  flows: MobileFlowResult[];
  manualWorkflows: MobileFlowResult[];
  reportPath?: string;
};
