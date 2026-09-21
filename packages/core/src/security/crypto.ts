import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex-encoded key (64 chars) — see .env.example.");
  }
  return Buffer.from(hex, "hex");
}

export interface EncryptedBlob {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/** Encrypts arbitrary JSON (e.g. ConnectedAccount OAuth tokens) at the application layer before storage. */
export function encryptJson(value: unknown): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function decryptJson<T>(blob: EncryptedBlob): T {
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(blob.iv, "hex"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "hex")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
