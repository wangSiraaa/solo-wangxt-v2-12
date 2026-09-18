/**
 * Local node agent simulator.
 *
 * Each simulated node polls the workbench for assignments, "applies" the
 * certificate locally (in memory only — no private keys exist in this system)
 * and posts a receipt. Chaos knobs reproduce the failure modes the platform
 * must survive:
 *
 *   --timeout-rate 0.2   assignment is picked up but the receipt never comes
 *   --fail-rate 0.3      node reports a failed apply (keeps its old version)
 *   --dup 2              every receipt is sent N times (idempotency check)
 *   --flap               send a second, contradictory receipt after success
 *   --delay 300          ms to "apply" a certificate
 *
 * Usage:
 *   npm run simulator -- --nodes canary-1,canary-2,prod-1,prod-2 \
 *       --server http://localhost:3000 --fail-rate 0.2 --dup 2
 */

interface Args {
  server: string;
  nodes: string[];
  timeoutRate: number;
  failRate: number;
  dup: number;
  flap: boolean;
  delay: number;
  pollMs: number;
  register: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, dflt: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  return {
    server: get('server', 'http://localhost:3000'),
    nodes: get('nodes', 'canary-1,canary-2,prod-1,prod-2,prod-3,prod-4').split(','),
    timeoutRate: Number(get('timeout-rate', '0')),
    failRate: Number(get('fail-rate', '0')),
    dup: Number(get('dup', '1')),
    flap: has('flap'),
    delay: Number(get('delay', '250')),
    pollMs: Number(get('poll-ms', '1000')),
    register: !has('no-register'),
  };
}

interface Task {
  assignmentId: string;
  planId: string;
  targetCertId: string;
  targetFingerprint: string;
  attempt: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SimulatedNode {
  /** The fingerprint this node actually runs — its ground truth. */
  private currentFingerprint: string | null = null;
  /** Assignments already applied (the server may re-deliver on each poll). */
  private seen = new Set<string>();

  constructor(
    private name: string,
    private role: 'canary' | 'prod',
    private args: Args,
  ) {}

  async register() {
    await fetch(`${this.args.server}/api/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: this.name, role: this.role }),
    });
  }

  async run() {
    for (;;) {
      try {
        await this.tick();
      } catch (e) {
        console.log(`[${this.name}] poll error: ${(e as Error).message}`);
      }
      await sleep(this.args.pollMs);
    }
  }

  private async tick() {
    const res = await fetch(
      `${this.args.server}/api/agent/poll?node=${encodeURIComponent(this.name)}`,
    );
    if (!res.ok) return;
    const tasks = (await res.json()) as Task[];
    for (const task of tasks) {
      if (this.seen.has(task.assignmentId)) continue;
      this.seen.add(task.assignmentId);
      // Fire-and-forget so several assignments can be "applied" concurrently.
      void this.apply(task);
    }
  }

  private async apply(task: Task) {
    const a = this.args;
    if (Math.random() < a.timeoutRate) {
      console.log(`[${this.name}] ${task.assignmentId.slice(0, 8)} TIMEOUT (receipt suppressed)`);
      return; // never talk back — the server will mark it TIMEOUT
    }
    await sleep(a.delay + Math.random() * a.delay);

    const fails = Math.random() < a.failRate;
    const receiptKey = `${task.assignmentId}:${task.attempt}:${this.name}`;
    const body = fails
      ? {
          assignmentId: task.assignmentId,
          receiptKey,
          ok: false,
          fingerprint: this.currentFingerprint ?? undefined,
          error: 'simulated apply failure (kept previous version)',
        }
      : {
          assignmentId: task.assignmentId,
          receiptKey,
          ok: true,
          fingerprint: task.targetFingerprint,
        };

    if (!fails) this.currentFingerprint = task.targetFingerprint;

    for (let i = 0; i < Math.max(1, a.dup); i++) {
      const res = await fetch(
        `${this.args.server}/api/agent/receipt?node=${encodeURIComponent(this.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { state?: string; duplicate?: boolean };
      console.log(
        `[${this.name}] ${task.assignmentId.slice(0, 8)} receipt#${i + 1} ` +
          `${fails ? 'FAIL' : 'OK'} -> ${JSON.stringify(json)}`,
      );
    }

    if (a.flap && !fails) {
      // A buggy agent changing its answer afterwards must not corrupt state.
      await fetch(
        `${this.args.server}/api/agent/receipt?node=${encodeURIComponent(this.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            assignmentId: task.assignmentId,
            receiptKey: `${receiptKey}:flap`,
            ok: false,
            error: 'late contradictory receipt',
          }),
        },
      );
    }
  }
}

async function main() {
  const args = parseArgs();
  const nodes = args.nodes.map((name, i) => {
    const role: 'canary' | 'prod' = name.includes('canary') ? 'canary' : 'prod';
    return new SimulatedNode(name.trim(), role, args);
  });
  if (args.register) {
    for (const n of nodes) await n.register();
    console.log(`registered ${nodes.length} node(s) at ${args.server}`);
  }
  console.log(
    `chaos: timeout=${args.timeoutRate} fail=${args.failRate} dup=${args.dup} flap=${args.flap}`,
  );
  await Promise.all(nodes.map((n) => n.run()));
}

void main();
