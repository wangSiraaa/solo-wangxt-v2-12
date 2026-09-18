import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import {
  Assignment,
  Certificate,
  NodeEntity,
  Plan,
  SwitchRecord,
} from '../src/entities';
import { PlansService } from '../src/plans/plans.service';

const DOMAINS = ['api.example.com', 'www.example.com'];
const SAN = ['api.example.com', '*.example.com'];

let ds: DataSource;
let svc: PlansService;
let certOld: Certificate;
let certNew: Certificate;
let certExpired: Certificate;
let certWrongDomain: Certificate;

function certEntity(name: string, fingerprint: string, notAfter: Date, san = SAN) {
  return {
    name,
    domains: DOMAINS,
    sanDomains: san,
    pemBundle: 'PEM',
    fingerprint,
    chainFingerprints: [fingerprint],
    serial: '01',
    issuer: 'CN=CA',
    subject: 'CN=api.example.com',
    notBefore: new Date(Date.now() - 86400000),
    notAfter,
  };
}

beforeEach(async () => {
  ds = new DataSource({
    type: 'sqljs',
    entities: [Certificate, NodeEntity, Plan, Assignment, SwitchRecord],
    synchronize: true,
  });
  await ds.initialize();
  svc = new PlansService(
    ds.getRepository(Plan),
    ds.getRepository(Assignment),
    ds.getRepository(Certificate),
    ds.getRepository(NodeEntity),
    ds.getRepository(SwitchRecord),
  );
  const certs = ds.getRepository(Certificate);
  certOld = await certs.save(certs.create(certEntity('old', 'FP:OLD', new Date(Date.now() + 200 * 86400000))));
  certNew = await certs.save(certs.create(certEntity('new', 'FP:NEW', new Date(Date.now() + 300 * 86400000))));
  certExpired = await certs.save(certs.create(certEntity('expired', 'FP:EXP', new Date(Date.now() - 86400000))));
  certWrongDomain = await certs.save(
    certs.create(certEntity('wrong', 'FP:WRONG', new Date(Date.now() + 100 * 86400000), ['other.org'])),
  );
  const nodes = ds.getRepository(NodeEntity);
  await nodes.save([
    nodes.create({ name: 'canary-1', role: 'canary', currentCertId: certOld.id, currentFingerprint: certOld.fingerprint }),
    nodes.create({ name: 'prod-1', role: 'prod', currentCertId: certOld.id, currentFingerprint: certOld.fingerprint }),
    nodes.create({ name: 'prod-2', role: 'prod', currentCertId: certOld.id, currentFingerprint: certOld.fingerprint }),
    nodes.create({ name: 'prod-3', role: 'prod', currentCertId: certOld.id, currentFingerprint: certOld.fingerprint }),
  ]);
});

afterEach(async () => {
  await ds.destroy();
});

async function makeStartedPlan(canaryCount = 1) {
  const plan = await svc.createPlan({ name: 'rotate', certId: certNew.id, canaryCount });
  await svc.start(plan.id);
  return plan.id;
}

async function deliverAndAck(node: string, ok = true) {
  const tasks = await svc.pollForNode(node);
  for (const t of tasks) {
    await svc.submitReceipt(node, {
      assignmentId: t.assignmentId,
      receiptKey: `${t.assignmentId}:1`,
      ok,
      fingerprint: ok ? t.targetFingerprint : 'FP:STALE',
      error: ok ? undefined : 'apply failed',
    });
  }
  return tasks;
}

describe('canary-first rollout', () => {
  it('only dispatches the canary batch until approval, then completes', async () => {
    const planId = await makeStartedPlan(1);

    // canary gets work, prod does not
    expect((await svc.pollForNode('canary-1')).length).toBe(1);
    expect((await svc.pollForNode('prod-1')).length).toBe(0);

    await deliverAndAck('canary-1');
    let detail = await svc.planDetail(planId);
    expect(detail.plan.state).toBe('AWAITING_APPROVAL');
    // still nothing for prod while waiting for the operator
    expect((await svc.pollForNode('prod-1')).length).toBe(0);

    await svc.approve(planId);
    await deliverAndAck('prod-1');
    await deliverAndAck('prod-2');
    await deliverAndAck('prod-3');

    detail = await svc.planDetail(planId);
    expect(detail.plan.state).toBe('COMPLETED');
    expect(detail.assignments.every((a) => a.state === 'SUCCESS')).toBe(true);

    const nodes = await ds.getRepository(NodeEntity).find();
    expect(nodes.every((n) => n.currentFingerprint === 'FP:NEW')).toBe(true);

    const switches = await ds.getRepository(SwitchRecord).find();
    expect(switches).toHaveLength(4);
    expect(switches.every((s) => s.result === 'applied' && s.fromFingerprint === 'FP:OLD')).toBe(true);
  });

  it('pause stops dispatch, resume continues it', async () => {
    const planId = await makeStartedPlan(1);
    await deliverAndAck('canary-1');
    await svc.approve(planId);

    await svc.pause(planId);
    expect((await svc.pollForNode('prod-1')).length).toBe(0);

    await svc.resume(planId);
    expect((await svc.pollForNode('prod-1')).length).toBe(1);
  });
});

describe('failure handling', () => {
  it('a failed node keeps its version while others complete', async () => {
    const planId = await makeStartedPlan(1);
    await deliverAndAck('canary-1');
    await svc.approve(planId);
    await deliverAndAck('prod-1');
    await deliverAndAck('prod-2', false); // fails
    await deliverAndAck('prod-3');

    const detail = await svc.planDetail(planId);
    expect(detail.plan.state).toBe('COMPLETED_WITH_FAILURES');

    const nodes = await ds.getRepository(NodeEntity).find();
    const prod2 = nodes.find((n) => n.name === 'prod-2')!;
    expect(prod2.currentFingerprint).toBe('FP:OLD'); // untouched
    expect(nodes.filter((n) => n.currentFingerprint === 'FP:NEW')).toHaveLength(3);
  });

  it('duplicate receipts are idempotent; late flapping is ignored', async () => {
    const planId = await makeStartedPlan(1);
    const [task] = await svc.pollForNode('canary-1');

    const first = await svc.submitReceipt('canary-1', {
      assignmentId: task.assignmentId,
      receiptKey: 'key-1',
      ok: true,
      fingerprint: task.targetFingerprint,
    });
    expect(first).toMatchObject({ state: 'SUCCESS', duplicate: false });

    // exact duplicate (retry with the same key)
    const dup = await svc.submitReceipt('canary-1', {
      assignmentId: task.assignmentId,
      receiptKey: 'key-1',
      ok: true,
      fingerprint: task.targetFingerprint,
    });
    expect(dup).toMatchObject({ state: 'SUCCESS', duplicate: true });

    // contradictory late receipt with a new key must not flip the state
    const flap = await svc.submitReceipt('canary-1', {
      assignmentId: task.assignmentId,
      receiptKey: 'key-2',
      ok: false,
      error: 'buggy agent',
    });
    expect(flap).toMatchObject({ state: 'SUCCESS', duplicate: true });

    const switches = await ds.getRepository(SwitchRecord).find();
    expect(switches).toHaveLength(1); // exactly one applied record
    const detail = await svc.planDetail(planId);
    expect(detail.assignments[0].state).toBe('SUCCESS');
  });

  it('marks delivered-but-silent assignments as TIMEOUT', async () => {
    (svc as any).deliveryTimeoutMs = 30;
    const planId = await makeStartedPlan(1);
    await svc.pollForNode('canary-1'); // delivered, receipt never arrives
    await new Promise((r) => setTimeout(r, 60));
    expect(await svc.sweepTimeouts()).toBe(1);

    const detail = await svc.planDetail(planId);
    expect(detail.assignments[0].state).toBe('TIMEOUT');
    // canary never verified -> the rest is never dispatched
    expect((await svc.pollForNode('prod-1')).length).toBe(0);
  });
});

describe('rollback', () => {
  it('reverts only switched nodes to a valid, domain-covering certificate', async () => {
    const planId = await makeStartedPlan(1);
    await deliverAndAck('canary-1');
    await svc.approve(planId);
    await deliverAndAck('prod-1');
    await deliverAndAck('prod-2', false);
    await deliverAndAck('prod-3');

    const targets = await svc.rollbackTargets(planId);
    const byName = Object.fromEntries(targets.map((t) => [t.id, t]));
    expect(byName[certOld.id].eligible).toBe(true);
    expect(byName[certExpired.id].eligible).toBe(false);
    expect(byName[certWrongDomain.id].eligible).toBe(false);

    await expect(svc.rollback(planId, certExpired.id)).rejects.toThrow(/expired/);
    await expect(svc.rollback(planId, certWrongDomain.id)).rejects.toThrow(/does not cover/);

    const rb = await svc.rollback(planId, certOld.id);
    expect(rb.isRollback).toBe(true);
    expect((await svc.planDetail(planId)).plan.state).toBe('ROLLED_BACK');

    // only the 3 nodes that actually switched are targeted
    const rbDetail = await svc.planDetail(rb.id);
    expect(rbDetail.assignments).toHaveLength(3);
    expect(rbDetail.assignments.map((a) => a.nodeName).sort()).toEqual([
      'canary-1',
      'prod-1',
      'prod-3',
    ]);

    await svc.start(rb.id);
    // canary batch of the rollback goes first
    await deliverAndAck('canary-1');
    await svc.approve(rb.id);
    await deliverAndAck('prod-1');
    await deliverAndAck('prod-3');

    const nodes = await ds.getRepository(NodeEntity).find();
    expect(nodes.every((n) => n.currentFingerprint === 'FP:OLD')).toBe(true);
    expect((await svc.planDetail(rb.id)).plan.state).toBe('COMPLETED');
  });
});
