import type { Direction, PipelineResult } from './types';
import { translateDvToEn } from './dvToEn';
import { translateEnToDv } from './enToDv';

export * from './types';
export * from './dvToEn';
export * from './enToDv';

export async function translate(text: string, direction: Direction): Promise<PipelineResult> {
  return direction === 'dv-en' ? translateDvToEn(text) : translateEnToDv(text);
}
