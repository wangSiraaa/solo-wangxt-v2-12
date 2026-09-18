import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Raw node acknowledgements ("回执"). `request_id` is the idempotency
 * key: the simulator can send duplicates and we only accept the first.
 */
@Entity('node_receipts')
export class NodeReceipt {
  @PrimaryColumn('uuid')
  id: string;

  /** correlation id sent with the push; duplicates share this id */
  @Index()
  @Column({ type: 'text', name: 'request_id' })
  requestId: string;

  @Index()
  @Column({ type: 'uuid', name: 'node_id' })
  nodeId: string;

  /** deployment_id may be null for simulator-originated noise */
  @Column({ type: 'uuid', name: 'deployment_id', nullable: true })
  deploymentId: string | null;

  @Column({ type: 'uuid', name: 'cert_id' })
  certId: string;

  /** fingerprint the node reports it is actually serving */
  @Column({ type: 'text', name: 'reported_fingerprint' })
  reportedFingerprint: string;

  /** success | error | duplicate */
  @Column({ type: 'text' })
  result: string;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'received_at' })
  receivedAt: Date;
}
