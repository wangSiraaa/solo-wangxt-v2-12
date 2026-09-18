import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Assignment,
  AssignmentState,
  Certificate,
  NodeEntity,
  Plan,
  PlanState,
  SwitchRecord,
} from '../entities';
import { coversDomain } from '../certificates/cert-analysis';

const FINAL_STATES: AssignmentState[] = ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'];
const ACTIVE_STATES: PlanState[] = ['CANARY', 'AWAITING_APPROVAL', 'ROLLING'];

@Injectable()
export class PlansService {
  /** How long a delivered assignment may go without a receipt. */
  readonly deliveryTimeoutMs = Number(process.env.DELIVERY_TIMEOUT_MS ?? 60_000);

  constructor(
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Certificate)
    private readonly certs: Repository<Certificate>,
    @InjectRepository(NodeEntity)
    private readonly nodes: Repository<NodeEntity>,
    @InjectRepository(SwitchRecord)
    private readonly switches: Repository<SwitchRecord>,
  ) {}

  // ---------------------------------------------------------------- creation

  async createPlan(input: {
    name: string;
    certId: string;
    nodeIds?: string[];
    canaryCount?: number;
  }): Promise<Plan> {
    const cert = await this.certs.findOne({ where: { id: input.certId } });
    if (!cert) throw new NotFoundException('certificate not found');
    if (cert.notAfter.getTime() < Date.now()) {
      throw new BadRequestException('cannot deploy an expired certificate');
    }

    let nodes: NodeEntity[];
    if (input.nodeIds?.length) {
      nodes = await this.nodes.find({ where: { id: In(input.nodeIds) } });
      if (nodes.length !== input.nodeIds.length) {
        throw new BadRequestException('some nodeIds do not exist');
      }
    } else {
      nodes = await this.nodes.find();
    }
    if (nodes.length === 0) throw new BadRequestException('no target nodes');

    const plan = await this.plans.save(
      this.plans.create({
        name: input.name,
        certId: cert.id,
        domains: cert.domains,
        canaryCount: Math.max(1, input.canaryCount ?? 1),
        state: 'DRAFT',
      }),
    );
    await this.createAssignments(plan, cert, nodes);
    return plan;
  }

  /** Canary-role nodes first (stable by name); batch 0 is the test batch. */
  private async createAssignments(
    plan: Plan,
    cert: Certificate,
    nodes: NodeEntity[],
  ) {
    const ordered = [...nodes].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'canary' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const rows = ordered.map((node, idx) =>
      this.assignments.create({
        planId: plan.id,
        nodeId: node.id,
        nodeName: node.name,
        targetCertId: cert.id,
        targetFingerprint: cert.fingerprint,
        batch: idx < plan.canaryCount ? 0 : 1,
      }),
    );
    await this.assignments.save(rows);
  }

  // ------------------------------------------------------------- transitions

  async start(planId: string): Promise<Plan> {
    const plan = await this.mustGet(planId);
    if (plan.state !== 'DRAFT') {
      throw new BadRequestException(`cannot start a plan in state ${plan.state}`);
    }
    plan.state = 'CANARY';
    return this.plans.save(plan);
  }

  async approve(planId: string): Promise<Plan> {
    const plan = await this.mustGet(planId);
    if (plan.state !== 'AWAITING_APPROVAL') {
      throw new BadRequestException(
        `plan is not waiting for approval (state ${plan.state})`,
      );
    }
    plan.state = 'ROLLING';
    const saved = await this.plans.save(plan);
    // A plan whose remaining batch is empty (e.g. canary-only rollback)
    // completes immediately without further receipts.
    await this.maybeAdvance(planId);
    return saved;
  }

  async pause(planId: string): Promise<Plan> {
    const plan = await this.mustGet(planId);
    if (!ACTIVE_STATES.includes(plan.state)) {
      throw new BadRequestException(`cannot pause a plan in state ${plan.state}`);
    }
    plan.stateBeforePause = plan.state;
    plan.state = 'PAUSED';
    return this.plans.save(plan);
  }

  async resume(planId: string): Promise<Plan> {
    const plan = await this.mustGet(planId);
    if (plan.state !== 'PAUSED' || !plan.stateBeforePause) {
      throw new BadRequestException(`cannot resume a plan in state ${plan.state}`);
    }
    plan.state = plan.stateBeforePause;
    plan.stateBeforePause = null;
    return this.plans.save(plan);
  }

  // ---------------------------------------------------------------- rollback

  /** Certificates a plan may roll back to: still valid and covering the domains. */
  async rollbackTargets(planId: string) {
    const plan = await this.mustGet(planId);
    const all = await this.certs.find({ order: { notAfter: 'DESC' } });
    const now = Date.now();
    return all
      .filter((c) => c.id !== plan.certId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        fingerprint: c.fingerprint,
        notAfter: c.notAfter,
        eligible:
          c.notAfter.getTime() > now &&
          plan.domains.every((d) => coversDomain(c.sanDomains, d)),
        expired: c.notAfter.getTime() <= now,
        coversDomains: plan.domains.every((d) => coversDomain(c.sanDomains, d)),
      }));
  }

  async rollback(planId: string, targetCertId: string): Promise<Plan> {
    const source = await this.mustGet(planId);
    const revertible: PlanState[] = [...ACTIVE_STATES, 'PAUSED', 'COMPLETED', 'COMPLETED_WITH_FAILURES'];
    if (!revertible.includes(source.state)) {
      throw new BadRequestException(
        `cannot roll back a plan in state ${source.state}`,
      );
    }
    const target = await this.certs.findOne({ where: { id: targetCertId } });
    if (!target) throw new NotFoundException('target certificate not found');
    if (target.id === source.certId) {
      throw new BadRequestException('rollback target is the plan certificate itself');
    }
    if (target.notAfter.getTime() <= Date.now()) {
      throw new BadRequestException('rollback target certificate has expired');
    }
    const uncovered = source.domains.filter(
      (d) => !coversDomain(target.sanDomains, d),
    );
    if (uncovered.length > 0) {
      throw new BadRequestException(
        `rollback target does not cover domain(s): ${uncovered.join(', ')}`,
      );
    }

    // Only nodes that actually switched need reverting; failed/never-delivered
    // nodes still run their previous version and stay untouched.
    const sourceAssignments = await this.assignments.find({
      where: { planId: source.id },
    });
    const switchedNodeIds = [
      ...new Set(
        sourceAssignments
          .filter((a) => a.state === 'SUCCESS')
          .map((a) => a.nodeId),
      ),
    ];
    if (switchedNodeIds.length === 0) {
      throw new BadRequestException('no node ever switched; nothing to roll back');
    }

    // Anything still in flight on the source plan is abandoned as-is.
    for (const a of sourceAssignments) {
      if (a.state === 'PENDING' || a.state === 'DELIVERED') {
        a.state = 'SKIPPED';
        a.completedAt = new Date();
      }
    }
    await this.assignments.save(sourceAssignments);

    source.state = 'ROLLED_BACK';
    source.stateBeforePause = null;
    await this.plans.save(source);

    const nodes = await this.nodes.find({ where: { id: In(switchedNodeIds) } });
    const rollbackPlan = await this.plans.save(
      this.plans.create({
        name: `rollback:${source.name}`,
        certId: target.id,
        domains: source.domains,
        canaryCount: Math.min(source.canaryCount, nodes.length),
        state: 'DRAFT',
        isRollback: true,
        rollbackOfPlanId: source.id,
      }),
    );
    await this.createAssignments(rollbackPlan, target, nodes);
    return rollbackPlan;
  }

  // ------------------------------------------------------------- agent facing

  /** Assignments a node agent should work on right now. */
  async pollForNode(nodeName: string) {
    const node = await this.nodes.findOne({ where: { name: nodeName } });
    if (!node) throw new NotFoundException(`unknown node "${nodeName}"`);
    await this.sweepTimeouts();

    const activePlans = await this.plans.find({
      where: [{ state: 'CANARY' }, { state: 'ROLLING' }],
    });
    const dispatchable = new Map(activePlans.map((p) => [p.id, p]));
    const pending = await this.assignments.find({
      where: [
        { nodeId: node.id, state: 'PENDING' },
        // re-deliver to agents that polled but (restarted and) never receipted
        { nodeId: node.id, state: 'DELIVERED' },
      ],
      order: { batch: 'ASC' },
    });
    const now = new Date();
    const out: Assignment[] = [];
    for (const a of pending) {
      const plan = dispatchable.get(a.planId);
      if (!plan) continue;
      if (plan.state === 'CANARY' && a.batch !== 0) continue;
      if (a.state === 'PENDING') {
        // First delivery starts the receipt timeout clock; re-deliveries to a
        // restarted agent keep the original deadline.
        a.state = 'DELIVERED';
        a.deliveredAt = now;
      }
      a.attempts += 1;
      out.push(a);
    }
    if (out.length) await this.assignments.save(out);
    return out.map((a) => ({
      assignmentId: a.id,
      planId: a.planId,
      targetCertId: a.targetCertId,
      targetFingerprint: a.targetFingerprint,
      attempt: a.attempts,
    }));
  }

  async submitReceipt(
    nodeName: string,
    input: {
      assignmentId: string;
      receiptKey: string;
      ok: boolean;
      fingerprint?: string;
      error?: string;
    },
  ) {
    const node = await this.nodes.findOne({ where: { name: nodeName } });
    if (!node) throw new NotFoundException(`unknown node "${nodeName}"`);
    const assignment = await this.assignments.findOne({
      where: { id: input.assignmentId },
    });
    if (!assignment || assignment.nodeId !== node.id) {
      throw new NotFoundException('assignment not found for this node');
    }

    // Idempotency: the same receipt key never applies twice, and any receipt
    // arriving after a final state is acknowledged but ignored.
    if (assignment.finalReceiptKey === input.receiptKey) {
      return { state: assignment.state, duplicate: true };
    }
    if (FINAL_STATES.includes(assignment.state)) {
      return { state: assignment.state, duplicate: true, late: true };
    }

    const matchesTarget = input.fingerprint === assignment.targetFingerprint;
    const success = input.ok && matchesTarget;
    assignment.state = success ? 'SUCCESS' : 'FAILED';
    assignment.reportedFingerprint = input.fingerprint ?? null;
    assignment.error = success
      ? null
      : input.ok
        ? `fingerprint mismatch: node reported ${input.fingerprint ?? 'none'}`
        : input.error || 'node reported failure';
    assignment.finalReceiptKey = input.receiptKey;
    assignment.completedAt = new Date();
    await this.assignments.save(assignment);

    // A failed node keeps whatever version it actually runs — only successes
    // move the node's current certificate pointer.
    if (success) {
      await this.switches.save(
        this.switches.create({
          nodeId: node.id,
          planId: assignment.planId,
          fromCertId: node.currentCertId,
          fromFingerprint: node.currentFingerprint,
          toCertId: assignment.targetCertId,
          toFingerprint: assignment.targetFingerprint,
          result: 'applied',
        }),
      );
      node.currentCertId = assignment.targetCertId;
      node.currentFingerprint = assignment.targetFingerprint;
      await this.nodes.save(node);
    } else {
      await this.switches.save(
        this.switches.create({
          nodeId: node.id,
          planId: assignment.planId,
          fromCertId: node.currentCertId,
          fromFingerprint: node.currentFingerprint,
          toCertId: assignment.targetCertId,
          toFingerprint: assignment.targetFingerprint,
          result: 'failed',
          error: assignment.error,
        }),
      );
    }

    await this.maybeAdvance(assignment.planId);
    return { state: assignment.state, duplicate: false };
  }

  // ------------------------------------------------------------------ sweep

  /** Delivered-but-silent assignments past the timeout become TIMEOUT. */
  async sweepTimeouts(now = new Date()) {
    const stale = await this.assignments.find({ where: { state: 'DELIVERED' } });
    const timedOut = stale.filter(
      (a) =>
        a.deliveredAt &&
        now.getTime() - a.deliveredAt.getTime() > this.deliveryTimeoutMs,
    );
    for (const a of timedOut) {
      a.state = 'TIMEOUT';
      a.error = `no receipt within ${this.deliveryTimeoutMs}ms`;
      a.completedAt = now;
    }
    if (timedOut.length) {
      await this.assignments.save(timedOut);
      for (const planId of new Set(timedOut.map((a) => a.planId))) {
        await this.maybeAdvance(planId);
      }
    }
    return timedOut.length;
  }

  private async maybeAdvance(planId: string) {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) return;
    const all = await this.assignments.find({ where: { planId } });
    const isFinal = (a: Assignment) => FINAL_STATES.includes(a.state);

    if (plan.state === 'CANARY') {
      const canary = all.filter((a) => a.batch === 0);
      if (canary.length > 0 && canary.every(isFinal)) {
        if (canary.every((a) => a.state === 'SUCCESS')) {
          plan.state = 'AWAITING_APPROVAL';
          await this.plans.save(plan);
        }
        // Canary failures keep the plan in CANARY so the operator can inspect,
        // pause or roll back; the remaining batch is never dispatched.
      }
    } else if (plan.state === 'ROLLING') {
      if (all.every(isFinal)) {
        plan.state = all.every((a) => a.state === 'SUCCESS')
          ? 'COMPLETED'
          : 'COMPLETED_WITH_FAILURES';
        await this.plans.save(plan);
      }
    }
  }

  // ------------------------------------------------------------------ reads

  async listPlans() {
    const plans = await this.plans.find({ order: { createdAt: 'DESC' } });
    const certs = await this.certs.find();
    const certName = new Map(certs.map((c) => [c.id, c.name]));
    return plans.map((p) => ({ ...p, certName: certName.get(p.certId) ?? null }));
  }

  async planDetail(planId: string) {
    await this.sweepTimeouts();
    await this.maybeAdvance(planId); // reconcile in case nothing triggers it later
    const plan = await this.mustGet(planId);
    const assignments = await this.assignments.find({
      where: { planId },
      order: { batch: 'ASC', nodeName: 'ASC' },
    });
    const cert = await this.certs.findOne({ where: { id: plan.certId } });
    return { plan, cert, assignments };
  }

  private async mustGet(planId: string): Promise<Plan> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('plan not found');
    return plan;
  }
}
