import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('deployments')
export class Deployment {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'cert_id' })
  certId: string;

  /** "test:0", "canary:1", ... — currently executing batch */
  @Column({ type: 'int', name: 'batch_index', default: 0 })
  batchIndex: number;

  /** test | canary | prod */
  @Column({ type: 'text', name: 'current_env', default: 'test' })
  currentEnv: string;

  /**
   * draft | running | paused | completed | failed | rolled_back
   * "paused" = waiting at a batch gate for manual promotion.
   */
  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
