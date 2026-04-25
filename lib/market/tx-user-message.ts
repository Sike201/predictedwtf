const SOL_FEE_USER_MESSAGE =
  "Not enough SOL in wallet to pay transaction fees. Please add devnet SOL and try again.";

const GENERIC_USER_MESSAGE = "Transaction failed. Please try again.";

const ALREADY_PROCESSED_MESSAGE =
  "This order was already submitted. Please refresh the page.";

const SPL_WITHDRAW_SHORT =
  "Insufficient token balance for this withdraw. Refresh balances and try Max.";

const WITHDRAW_USDC_TOKEN_MISMATCH =
  "USDC withdraw failed because the estimated token amounts changed. Try withdrawing as YES + NO or refresh and try again.";

const RESOLVED_NEED_SETTLE_BEFORE_WITHDRAW =
  "Market is resolved. Please settle/redeem before withdrawing.";

function isWithdrawBlockedPendingSettlementMessage(fullText: string): boolean {
  const lower = fullText.toLowerCase();
  return (
    lower.includes("settlement required") ||
    lower.includes("must settle") ||
    lower.includes("please settle") ||
    lower.includes("needs to be settled") ||
    lower.includes("not settled") ||
    lower.includes("unsettled liquidity") ||
    lower.includes("redeem first") ||
    lower.includes("must redeem") ||
    lower.includes("pending settlement")
  );
}

function isAlreadyProcessedErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already been processed") ||
    m.includes("already processed") ||
    m.includes("transactionalreadyprocessed")
  );
}

/** Collect message + any embedded program logs for classification. */
function collectErrorText(error: unknown): string {
  if (error instanceof Error) {
    let s = error.message;
    const logs = (error as { logs?: string[] }).logs;
    if (Array.isArray(logs) && logs.length > 0) {
      s += "\n" + logs.join("\n");
    }
    return s;
  }
  return String(error);
}

/**
 * SPL Token program (Tokenkeg) transfer/burn "insufficient funds" — not native SOL fee payer.
 * Do not treat bare "Tokenkeg" mentions as this; pair with insufficient-funds / token error codes.
 */
export function isSplTokenInsufficientFundsMessage(fullText: string): boolean {
  const lower = fullText.toLowerCase();
  if (lower.includes("tokenkeg") && lower.includes("insufficient funds")) {
    return true;
  }
  if (lower.includes("program log: error: insufficient funds")) return true;
  if (
    lower.includes("custom program error: 0x1") ||
    lower.includes("custom program error: '0x1'")
  ) {
    return true;
  }
  return false;
}

/**
 * Native SOL / fee-payer balance (lamports), not SPL token balance.
 */
export function isNativeSolInsufficientMessage(fullText: string): boolean {
  const lower = fullText.toLowerCase();
  if (lower.includes("insufficient lamports")) return true;
  if (lower.includes("insufficient funds for fee")) return true;
  if (
    lower.includes("attempt to debit an account but found no record of a prior credit")
  ) {
    return true;
  }
  if (lower.includes("insufficient funds")) {
    if (isSplTokenInsufficientFundsMessage(fullText)) return false;
    return true;
  }
  return false;
}

function isComputeBudgetExhaustedMessage(lower: string): boolean {
  return (
    lower.includes("compute units") ||
    lower.includes("computationalbudgetexceeded") ||
    lower.includes("exceeded maximum compute units")
  );
}

export type TxUserMessageContext =
  | string
  | "withdraw-usdc"
  | "withdraw-pool"
  | "deposit"
  | "trade"
  | "withdraw";

/**
 * Map wallet / RPC errors to a short user-facing string. Always logs the full error
 * to the console for debugging.
 */
export function logAndFormatUserTxError(
  error: unknown,
  context?: TxUserMessageContext,
): string {
  const prefix = context
    ? `[predicted][tx-user-message] ${context}`
    : "[predicted][tx-user-message]";
  console.error(prefix, error);

  const raw = collectErrorText(error);
  const lower = raw.toLowerCase();

  if (isAlreadyProcessedErrorMessage(raw)) {
    return ALREADY_PROCESSED_MESSAGE;
  }

  if (isSplTokenInsufficientFundsMessage(raw)) {
    if (context === "withdraw-usdc") {
      return WITHDRAW_USDC_TOKEN_MISMATCH;
    }
    return SPL_WITHDRAW_SHORT;
  }

  if (isNativeSolInsufficientMessage(raw)) {
    return SOL_FEE_USER_MESSAGE;
  }

  if (isComputeBudgetExhaustedMessage(lower)) {
    return SOL_FEE_USER_MESSAGE;
  }

  if (
    (context === "withdraw-usdc" ||
      context === "withdraw-pool" ||
      context === "withdraw") &&
    isWithdrawBlockedPendingSettlementMessage(raw)
  ) {
    return RESOLVED_NEED_SETTLE_BEFORE_WITHDRAW;
  }

  return GENERIC_USER_MESSAGE;
}
