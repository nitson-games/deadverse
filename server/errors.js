export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'نیاز به ورود') => new ApiError(401, 'unauthorized', message);
export const notFound = (message = 'یافت نشد') => new ApiError(404, 'not_found', message);
export const conflict = (message) => new ApiError(409, 'conflict', message);

/** Wraps async handlers so a rejected promise becomes a 500 instead of a hang. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'endpoint not found' } });
}

export function errorHandler(env) {
  return (err, req, res, next) => {
    if (err instanceof ApiError) {
      return res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
    }

    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'مدل داده بیش از حد بزرگ است' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'بدنه‌ی درخواست JSON معتبر نیست' } });
    }
    // Unique constraint violation (e.g. duplicate newsletter email).
    if (err?.code === '23505') {
      return res.status(409).json({ error: { code: 'duplicate', message: 'این رکورد از قبل وجود دارد' } });
    }
    if (err?.code === '23514') {
      return res.status(400).json({ error: { code: 'invalid_value', message: 'یکی از مقادیر مورد اجازه نیست' } });
    }

    console.error('[api] unhandled error:', err?.stack || err);
    const message = env.nodeEnv === 'development' ? String(err?.message || err) : 'خطای سرور';
    return res.status(500).json({ error: { code: 'server_error', message } });
  };
}
