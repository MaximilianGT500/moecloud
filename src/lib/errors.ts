export type Params = Record<string, string | number>;

export class HttpError extends Error {
  status: number;
  code: string;
  params?: Params;
  extra?: Record<string, unknown>;

  constructor(status: number, message: string, code = 'error', params?: Params, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
    this.extra = extra;
  }
}

export const badRequest = (message: string, params?: Params) => new HttpError(400, message, 'bad_request', params);
export const unauthorized = (message = 'Bitte melde dich an') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'Dafür fehlen dir die Rechte') => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Nicht gefunden') => new HttpError(404, message, 'not_found');
export const conflict = (message: string, params?: Params, extra?: Record<string, unknown>) =>
  new HttpError(409, message, 'conflict', params, extra);
export const tooLarge = (message = 'Die Datei ist zu groß', params?: Params) => new HttpError(413, message, 'too_large', params);
export const insufficientStorage = (message = 'Dein Speicher ist voll') => new HttpError(507, message, 'quota', undefined);
export const tooMany = (message = 'Zu viele Versuche, warte kurz und versuch es dann noch mal') =>
  new HttpError(429, message, 'rate_limited');
