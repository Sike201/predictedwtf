/** Codes returned to the client and logged when devnet pipeline steps fail. */
export type PipelineFailureStage =
  | "FAILED_AT_PINATA"
  | "FAILED_AT_SUPABASE_INSERT"
  | "FAILED_AT_YES_MINT"
  | "FAILED_AT_NO_MINT"
  | "FAILED_AT_OUTCOME_ATA"
  | "FAILED_AT_OUTCOME_FUNDING"
  | "FAILED_AT_OMNIPAIR_PRE_INIT"
  | "FAILED_AT_OMNIPAIR_INIT"
  | "FAILED_AT_LIQUIDITY_SEED"
  | "FAILED_AT_SUPABASE_FINAL"
  | "FAILED_AT_PRECONDITION"
  | "FAILED_AT_PMAMM_INIT"
  | "FAILED_AT_PMAMM_DEPOSIT";

export class PipelineStageError extends Error {
  readonly missingProgramId?: string;
  /** Filled for `FAILED_AT_OUTCOME_ATA` — server/client debugging (mint, ATA, owner, programs). */
  readonly outcomeAtaContext?: Record<string, string>;

  constructor(
    public readonly stage: PipelineFailureStage,
    message: string,
    options?: {
      cause?: unknown;
      missingProgramId?: string;
      outcomeAtaContext?: Record<string, string>;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PipelineStageError";
    if (options?.missingProgramId) this.missingProgramId = options.missingProgramId;
    if (options?.outcomeAtaContext) this.outcomeAtaContext = options.outcomeAtaContext;
  }
}

export function isPipelineStageError(e: unknown): e is PipelineStageError {
  return e instanceof PipelineStageError;
}

export function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
