export class RoomError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function fail(status, code, message) { throw new RoomError(status, code, message) }
