/** RPC / wallet errors that indicate the same signed transaction was submitted twice. */
export function isDuplicateSolanaSubmitError(message: string): boolean {
  return /already been processed|duplicate transaction|duplicate signature|this transaction has already been processed/i.test(
    message,
  );
}
