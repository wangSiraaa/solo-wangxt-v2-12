import { randomUUID } from 'crypto';

export function uuid(): string {
  return randomUUID();
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function now(): Date {
  return new Date();
}
