/** A business-rule failure with a message that is safe to show to the user. */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
