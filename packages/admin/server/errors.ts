/** An error that already knows its HTTP status. The message is the sentence the caller reads. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}
