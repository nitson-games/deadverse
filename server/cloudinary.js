import crypto from 'node:crypto';

/**
 * Images upload straight from the browser to Cloudinary. The server only signs
 * the request, so a 2 MB file never passes through the (body-limited) API.
 */
function signParams(params, apiSecret) {
  const canonical = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(canonical + apiSecret).digest('hex');
}

export function isCloudinaryConfigured(cfg) {
  return Boolean(cfg.cloudName && cfg.apiKey && cfg.apiSecret);
}

export function buildUploadSignature(cfg, { key }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${cfg.folder}/${key}`;
  const toSign = { folder, timestamp };
  return {
    cloud_name: cfg.cloudName,
    api_key: cfg.apiKey,
    timestamp,
    folder,
    signature: signParams(toSign, cfg.apiSecret),
    max_size: 2 * 1024 * 1024,
    resource_type: 'image'
  };
}

export function endpoint(cfg) {
  return `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`;
}

/** Only assets under our own folder may be removed, and only via stored ids. */
export function isOwnedPublicId(cfg, publicId) {
  return typeof publicId === 'string' && publicId.startsWith(`${cfg.folder}/`);
}

export async function destroyAsset(cfg, publicId) {
  if (!isCloudinaryConfigured(cfg) || !isOwnedPublicId(cfg, publicId)) {
    return { skipped: true, publicId };
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ public_id: publicId, timestamp }, cfg.apiSecret);
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: cfg.apiKey,
    signature
  });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, result: json.result, publicId };
}
