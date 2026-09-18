export type NodeEnv = 'test' | 'canary' | 'prod';

export type DeploymentStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export type TaskStatus =
  | 'pending'
  | 'in_flight'
  | 'succeeded'
  | 'failed'
  | 'timeout';

export type SimMode = 'normal' | 'fail' | 'flaky' | 'timeout' | 'duplicate';
