import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

/**
 * One task = one node push attempt within a deployment batch.
 * Failure keeps the node on its previous active cert; the row
 * records what actually happened.
 */
@Entity('deployment_tasks')
@Unique('uq_task_deploy_node', ['deploymentId', 'nodeId'])
export class DeploymentTask {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'deployment_id' })
  deploymentId: string;

  @Index()
  @Column({ type: 'uuid', name: 'node_id' })
  nodeId: string;

  @Column({ type: 'int', name: 'batch_index' })
  batchIndex: number;

  @Column({ type: 'text' })
  env: string;

  /** pending | in_flight | succeeded | failed | timeout */
  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'int', name: 'attempt_count', default: 0 })
  attemptCount: number;

  /** idempotency key of the latest push attempt */
  @Column({ type: 'text', name: 'last_request_id', nullable: true })
  lastRequestId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
