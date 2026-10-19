import crypto from "crypto";
import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM

function getKey(): Buffer {
  const hex = config.encryptionKey.trim();
  if (hex.length === 64) {
    return Buffer.from(hex, "hex");
  }
  // If not 64 hex characters, hash it to 32 bytes
  return crypto.createHash("sha256").update(hex).digest();
}

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns string in format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${ciphertext}`;
}

/**
 * Decrypt string encrypted with AES-256-GCM
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format. Expected iv:tag:ciphertext");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash API key or token using SHA-256
 */
export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Generate a new API key: `gw_` + 32 random bytes (64 hex characters)
 */
export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const randomHex = crypto.randomBytes(32).toString("hex");
  const rawKey = `gw_${randomHex}`;
  const keyPrefix = rawKey.substring(0, 11) + "..."; // e.g. gw_a1b2c3d4...
  const keyHash = sha256(rawKey);

  return { rawKey, keyPrefix, keyHash };
}
