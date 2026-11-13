import crypto from 'node:crypto';

export const SESSION_COOKIE_NAME = 'salig_session';
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

/** Generate a cryptographically random 6-digit numeric OTP code. */
export function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/** Hash an email + 6-digit OTP code using HMAC-SHA256 keyed by auth secret. */
export function hashOtpCode(email, otpCode, secret) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(otpCode || '').trim();
  return crypto
    .createHmac('sha256', String(secret || 'salig-otp-fallback'))
    .update(`otp:${normalizedEmail}:${cleanCode}`)
    .digest('hex');
}

/** Verify a 6-digit OTP code against its stored HMAC digest in constant time. */
export function verifyOtpHash(email, otpCode, expectedHash, secret) {
  const cleanCode = String(otpCode || '').trim();
  if (!/^\d{6}$/.test(cleanCode) || !expectedHash) return false;
  const actualBuf = Buffer.from(hashOtpCode(email, cleanCode, secret), 'hex');
  const expectedBuf = Buffer.from(String(expectedHash), 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export const USER_PROVINCE_OPTIONS = [
  'Biliran',
  'Eastern Samar',
  'Leyte',
  'Northern Samar',
  'Samar (Western Samar)',
  'Southern Leyte',
  'Region VIII Hub'
];

export const PROVINCE_NAME_TO_CODE = {
  Biliran: 'BIL',
  'Eastern Samar': 'ESA',
  Leyte: 'LEY',
  'Northern Samar': 'NSA',
  'Samar (Western Samar)': 'SAM',
  'Southern Leyte': 'SLE'
};

export const DEFAULT_ADMIN_EMAIL = process.env.SALIG_ADMIN_EMAIL || 'admin@dar8.gov.ph';
export const DEFAULT_ADMIN_PASSWORD = process.env.SALIG_ADMIN_PASSWORD || 'SaligAdmin2026!';

/** Hash a plaintext password with a random per-user salt using Node scrypt. */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/** Verify a plaintext password against a stored `salt:hash` string in constant time. */
export function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const actualBuf = crypto.scryptSync(String(password), salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/** Sign a stateless HMAC-SHA256 session token for an authenticated user. */
export function signSessionToken(user, secret, ttlMs = DEFAULT_SESSION_TTL_MS) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    province: user.province,
    role: user.role,
    exp: Date.now() + ttlMs
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', String(secret)).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/** Verify an HMAC-SHA256 session token and return its payload if valid and unexpired. */
export function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', String(secret)).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.id || !payload?.email || !payload?.exp || Date.now() > Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Parse HTTP Cookie header into a key/value map. */
export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

/** Strip sensitive password hash fields before returning user records to clients. */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    province: user.province,
    contactNumber: user.contactNumber,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || user.createdAt,
    approvedAt: user.approvedAt || null,
    approvedBy: user.approvedBy || null
  };
}

/**
 * Resolve province-level data scope for a signed-in user.
 * Returns null for Regional Admins or Region VIII Hub accounts (full access),
 * or `{ code, provinceName }` for confirmed provincial accounts.
 */
export function resolveUserProvinceScope(user) {
  if (!user || user.role === 'admin' || user.province === 'Region VIII Hub') {
    return null;
  }
  const provinceName = String(user.province || '').trim();
  const code = PROVINCE_NAME_TO_CODE[provinceName] || null;
  if (!code) return null;
  return { code, provinceName };
}

