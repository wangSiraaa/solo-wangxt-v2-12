import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type CertChainState = 'ok' | 'invalid';

@Entity('certificates')
export class Certificate {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  label: string;

  @Index({ unique: true })
  @Column({ type: 'text', name: 'fingerprint_sha256' })
  fingerprintSha256: string;

  @Column({ type: 'text', name: 'subject_cn' })
  subjectCn: string;

  @Column({ type: 'text', name: 'issuer_cn' })
  issuerCn: string;

  @Column({ type: 'text', nullable: true })
  serial: string | null;

  @Column({ type: 'text', name: 'signature_algorithm' })
  signatureAlgorithm: string;

  @Column({ type: 'timestamptz', name: 'not_before' })
  notBefore: Date;

  @Column({ type: 'timestamptz', name: 'not_after' })
  notAfter: Date;

  /** DNS names from SAN (fallback CN) */
  @Column({ type: 'text', name: 'san_domains', array: true })
  sanDomains: string[];

  /** Full chain PEM exactly as accepted (leaf -> intermediate -> root) */
  @Column({ type: 'text', name: 'chain_pem' })
  chainPem: string;

  @Column({ type: 'int', name: 'chain_length' })
  chainLength: number;

  @Column({ type: 'boolean', name: 'chain_valid' })
  chainValid: boolean;

  @Column({ type: 'text', name: 'source_filename', nullable: true })
  sourceFilename: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'uploaded_at' })
  uploadedAt: Date;
}
