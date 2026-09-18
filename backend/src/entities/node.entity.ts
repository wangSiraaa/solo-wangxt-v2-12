import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export interface NodeSettings {
  /** extra latency applied to every simulated request */
  baseDelayMs: number;
}

@Entity('nodes')
export class Node {
  @PrimaryColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'text' })
  name: string;

  /** test | canary | prod — also defines the rollout order */
  @Column({ type: 'text' })
  env: string;

  @Column({ type: 'text' })
  region: string;

  @Column({ type: 'text' })
  domain: string;

  /** normal | fail | flaky | timeout | duplicate */
  @Column({ type: 'text', name: 'sim_mode', default: 'normal' })
  simMode: string;

  @Column({ type: 'jsonb', name: 'settings_json', default: '{}' })
  settings: NodeSettings;

  @Column({ type: 'uuid', name: 'active_cert_id', nullable: true })
  activeCertId: string | null;

  @Column({ type: 'timestamptz', name: 'active_since', nullable: true })
  activeSince: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
