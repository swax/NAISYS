import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import tls from "tls";

/**
 * Read the hub access key from the local cert file at NAISYS_FOLDER/cert/hub-access-key.
 * Returns undefined if the file does not exist.
 */
export function readHubAccessKeyFile(): string | undefined {
  const naisysFolder = process.env.NAISYS_FOLDER || "";
  const accessKeyPath = join(naisysFolder, "cert", "hub-access-key");
  if (!existsSync(accessKeyPath)) return undefined;
  return readFileSync(accessKeyPath, "utf-8").trim();
}

/**
 * Resolve the hub access key from environment variable or local cert file.
 * Returns undefined if neither is available.
 */
export function resolveHubAccessKey(): string | undefined {
  return process.env.HUB_ACCESS_KEY || readHubAccessKeyFile();
}

/** Parse a hub access key in format "<fingerprintPrefix>+<secret>" */
export function parseHubAccessKey(accessKey: string): {
  fingerprintPrefix: string;
  secret: string;
} {
  const plusIndex = accessKey.indexOf("+");
  if (plusIndex === -1) {
    throw new Error(
      "Invalid hub access key format, expected <fingerprint>+<secret>",
    );
  }
  return {
    fingerprintPrefix: accessKey.substring(0, plusIndex),
    secret: accessKey.substring(plusIndex + 1),
  };
}

/** Compute SHA-256 fingerprint of a DER-encoded certificate */
export function computeCertFingerprint(derCert: Buffer): string {
  return createHash("sha256").update(derCert).digest("hex");
}

/**
 * Connect to a TLS server and verify that the certificate fingerprint
 * starts with the expected prefix. Rejects if the fingerprint doesn't match.
 */
export async function verifyHubCertificate(
  host: string,
  port: number,
  fingerprintPrefix: string,
): Promise<void> {
  const fingerprint = await new Promise<string>((resolve, reject) => {
    const sock = tls.connect(port, host, { rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate(true);
      sock.destroy();
      if (!cert?.raw) {
        reject(new Error("No certificate received from hub"));
        return;
      }
      resolve(computeCertFingerprint(cert.raw));
    });
    sock.on("error", reject);
  });

  if (!fingerprint.startsWith(fingerprintPrefix)) {
    throw new Error(
      `Hub certificate fingerprint mismatch: expected prefix ${fingerprintPrefix}, got ${fingerprint.substring(0, fingerprintPrefix.length)}`,
    );
  }
}
