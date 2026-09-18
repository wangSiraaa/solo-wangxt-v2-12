import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Column types are declared explicitly (rather than inferred from decorator
 * metadata) so the schema works identically on PostgreSQL and the embedded
 * sqljs driver used for local development and tests.
 */
const DATE_COLUMN =
  process.env.DB_TYPE === 'postgres' ? 'timestamp' : 'datetime';

@Entity('certificates')
export class Certificate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  /** Domains this cert is expected to serve (operator-declared, validated against SAN). */
  @Column('simple-json')
  domains: string[];

  /** Domains actually present in the leaf SAN/CN. */
  @Column('simple-json')
  sanDomains: string[];

  @Column('text')
  pemBundle: string;

  @Column({ type: 'varchar' })
  fingerprint: string; // sha256 of leaf, hex, colon-separated

  @Column('simple-json')
  chainFingerprints: string[];

  @Column({ type: 'varchar' })
  serial: string;

  @Column({ type: 'varchar' })
  issuer: string;

  @Column({ type: 'varchar' })
  subject: string;

  @Column({ type: DATE_COLUMN })
  notBefore: Date;

  @Column({ type: DATE_COLUMN })
  notAfter: Date;

  @CreateDateColumn()
  uploadedAt: Date;
}

export type NodeRole = 'canary' | 'prod';

@Entity('nodes')
export class NodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  name: string;

  @Column({ type: 'varchar', default: 'prod' })
  role: NodeRole;

  /** The certificate version actually running on the node right now. */
  @Column({ type: 'varchar', nullable: true })
  currentCertId: string | null;

  @Column({ type: 'varchar', nullable: true })
  currentFingerprint: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

export type PlanState =
  | 'DRAFT'
  | 'CANARY' // canary batch is being delivered
  | 'AWAITING_APPROVAL' // canary all green, waiting for operator to roll the rest
  | 'ROLLING' // remaining batches in flight
  | 'PAUSED'
  | 'COMPLETED'
  | 'COMPLETED_WITH_FAILURES'
  | 'ROLLED_BACK';

export type AssignmentState =
  | 'PENDING' // created, not yet picked up by the node agent
  | 'DELIVERED' // agent polled it, waiting for receipt
  | 'SUCCESS' // receipt ok + fingerprint matches target
  | 'FAILED' // receipt reported failure
  | 'TIMEOUT' // no receipt within the delivery timeout
  | 'SKIPPED'; // superseded (e.g. plan rolled back before delivery)

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  certId: string;

  /** Domains the plan must keep covered (copied from the cert at creation). */
  @Column('simple-json')
  domains: string[];

  @Column({ type: 'varchar', default: 'DRAFT' })
  state: PlanState;

  /** State to return to when resuming from PAUSED. */
  @Column({ type: 'varchar', nullable: true })
  stateBeforePause: PlanState | null;

  /** How many nodes form the canary (test) batch. */
  @Column({ type: 'int', default: 1 })
  canaryCount: number;

  /** True when this plan reverts nodes to an older certificate. */
  @Column({ type: 'boolean', default: false })
  isRollback: boolean;

  /** For rollback plans: the plan this one reverts. */
  @Column({ type: 'varchar', nullable: true })
  rollbackOfPlanId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('plan_assignments')
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  planId: string;

  @Column({ type: 'varchar' })
  nodeId: string;

  @Column({ type: 'varchar' })
  nodeName: string;

  /** Certificate the node should end up running. */
  @Column({ type: 'varchar' })
  targetCertId: string;

  @Column({ type: 'varchar' })
  targetFingerprint: string;

  /** 0 = canary batch, 1 = everything else. */
  @Column({ type: 'int', default: 1 })
  batch: number;

  @Column({ type: 'varchar', default: 'PENDING' })
  state: AssignmentState;

  @Column({ type: 'varchar', nullable: true })
  reportedFingerprint: string | null;

  @Column({ type: 'varchar', nullable: true })
  error: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Idempotency key of the receipt that moved this assignment to a final state. */
  @Column({ type: 'varchar', nullable: true })
  finalReceiptKey: string | null;

  @Column({ type: DATE_COLUMN, nullable: true })
  deliveredAt: Date | null;

  @Column({ type: DATE_COLUMN, nullable: true })
  completedAt: Date | null;
}

@Entity('switch_records')
export class SwitchRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  nodeId: string;

  @Column({ type: 'varchar' })
  planId: string;

  @Column({ type: 'varchar', nullable: true })
  fromCertId: string | null;

  @Column({ type: 'varchar', nullable: true })
  fromFingerprint: string | null;

  @Column({ type: 'varchar' })
  toCertId: string;

  @Column({ type: 'varchar' })
  toFingerprint: string;

  @Column({ type: 'varchar' })
  result: 'applied' | 'failed';

  @Column({ type: 'varchar', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
