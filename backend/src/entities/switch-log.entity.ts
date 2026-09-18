import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type SwitchAction = 'deploy' | 'rollback';

/**
 * Append-only record of what a node actually switched to.
 * This drives "每个节点最终使用的指纹".
 */
@Entity('switch_log')
export class SwitchLog {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'node_id' })
  nodeId: string;

  @Column({ type: 'uuid', name: 'from_cert_id', nullable: true })
  fromCertId: string | null;

  @Index()
  @Column({ type: 'uuid', name: 'to_cert_id', nullable: true })
  toCertId: string | null;

  @Column({ type: 'text', name: 'to_fingerprint', nullable: true })
  toFingerprint: string | null;

  /** deploy | rollback */
  @Column({ type: 'text' })
  action: SwitchAction;

  @Column({ type: 'uuid', name: 'related_deployment_id', nullable: true })
  relatedDeploymentId: string | null;

  @Column({ type: 'uuid', name: 'receipt_id', nullable: true })
  receiptId: string | null;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'switched_at' })
  switchedAt: Date;
}
