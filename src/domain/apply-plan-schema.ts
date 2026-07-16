// src/domain/apply-plan-schema.ts
//
// Zod schemas for the wire representation of an ApplyPlan. These are the
// canonical definitions used by the runtime-messages module and by the
// `buildApplyPlan` validator. Keep the schema version in sync with
// `src/autofill/apply-plan.ts`.

import { z } from 'zod';

export const ApplyStepKindSchema = z.enum(['radio', 'checkbox', 'short_text', 'long_text', 'select']);
export type ApplyStepKindSchemaT = z.infer<typeof ApplyStepKindSchema>;

export const ApplyStepSchema = z.object({
  questionFingerprint: z.string().length(64),
  questionNumber: z.number().int().positive(),
  kind: ApplyStepKindSchema,
  // Either string[] (for choices) or string (for text). Discriminated by `kind`.
  value: z.union([z.array(z.string().min(1).max(3)), z.string()]),
  sourceLine: z.number().int().positive(),
});
export type ApplyStepSchemaT = z.infer<typeof ApplyStepSchema>;

export const ApplyPlanSchema = z.object({
  schemaVersion: z.literal('1.0'),
  steps: z.array(ApplyStepSchema),
  warnings: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      questionNumber: z.number().int().positive().optional(),
      sourceLine: z.number().int().positive().optional(),
    }),
  ),
});
export type ApplyPlanSchemaT = z.infer<typeof ApplyPlanSchema>;