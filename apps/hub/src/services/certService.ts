import { computeCertFingerprint } from "@naisys/common-node";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generate } from "selfsigned";

export interface CertInfo {
  key: string;
  cert: string;
  /** 16-char fingerprint prefix + "+" + 16-char secret access key */
  hubAccessKey: string;
}

/**
 * Loads existing TLS cert/key from NAISYS_FOLDER/cert/ or generates a new
 * self-signed pair plus a random access key. Returns the PEM strings and
 * the hubAccessKey (fingerprint_prefix+secret) used for client auth.
 */
export async function loadOrCreateCert(): Promise<CertInfo> {
  const naisysFolder = process.env.NAISYS_FOLDER || "";
  const certDir = join(naisysFolder, "cert");
  const keyPath = join(certDir, "hub-key.pem");
  const certPath = join(certDir, "hub-cert.pem");
  const accessKeyPath = join(certDir, "hub-access-key");

  let key: string;
  let cert: string;

  if (existsSync(keyPath) && existsSync(certPath)) {
    key = readFileSync(keyPath, "utf-8");
    cert = readFileSync(certPath, "utf-8");
  } else {
    mkdirSync(certDir, { recursive: true });

    const attrs = [{ name: "commonName", value: "NAISYS Hub" }];
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);

    const pems = await generate(attrs, {
      keySize: 2048,
      algorithm: "sha256",
      notAfterDate,
    });

    key = pems.private;
    cert = pems.cert;

    writeFileSync(keyPath, key, { mode: 0o600 });
    writeFileSync(certPath, cert);
  }

  // Load or generate the secret access key
  let hubAccessKey: string;

  if (existsSync(accessKeyPath)) {
    hubAccessKey = readFileSync(accessKeyPath, "utf-8").trim();
  } else {
    const secretKey = randomBytes(8).toString("hex"); // 16 hex chars

    // Compute SHA-256 fingerprint from DER-encoded cert (first 16 hex chars)
    const derMatch = cert.match(
      /-----BEGIN CERTIFICATE-----\s*([\s\S]+?)\s*-----END CERTIFICATE-----/,
    );
    if (!derMatch) {
      throw new Error("Failed to parse PEM certificate");
    }
    const der = Buffer.from(derMatch[1].replace(/\s/g, ""), "base64");
    const fingerprint = computeCertFingerprint(der);
    const fingerprintPrefix = fingerprint.substring(0, 16);

    hubAccessKey = `${fingerprintPrefix}+${secretKey}`;

    writeFileSync(accessKeyPath, hubAccessKey, { mode: 0o600 });
  }

  return { key, cert, hubAccessKey };
}
