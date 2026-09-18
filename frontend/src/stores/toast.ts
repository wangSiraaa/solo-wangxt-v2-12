import { defineStore } from 'pinia';

export interface Toast {
  id: number;
  kind: 'ok' | 'err';
  message: string;
  details?: string[];
}

let seq = 0;

export const useToastStore = defineStore('toast', {
  state: () => ({ toasts: [] as Toast[] }),
  actions: {
    push(kind: Toast['kind'], message: string, details?: string[]) {
      const id = ++seq;
      this.toasts.push({ id, kind, message, details });
      setTimeout(() => this.dismiss(id), kind === 'err' ? 8000 : 3500);
    },
    ok(message: string) {
      this.push('ok', message);
    },
    fail(message: string, details?: string[]) {
      this.push('err', message, details);
    },
    fromError(e: unknown, fallback = '操作失败') {
      const err = e as { message?: string; details?: string[] };
      this.fail(err.message || fallback, err.details);
    },
    dismiss(id: number) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
  },
});
