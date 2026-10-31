import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

export const applicationSchema = z
  .object({
    clientId: z.string().trim().min(1).max(256),
    clientSecret: z.string().trim().min(1).max(4096),
    redirectUri: z.url().max(2048),
  })
  .strict();
export type ApplicationSettings = z.infer<typeof applicationSchema>;

export function createSettingsStore(directory: string, keyHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error("HH_CONFIG_KEY must be 32 random hex-encoded bytes");
  const key = Buffer.from(keyHex, "hex");
  const file = path.join(directory, "application.enc");
  return {
    load(): ApplicationSettings | null {
      if (!fs.existsSync(file)) return null;
      const payload = fs.readFileSync(file, "utf8");
      if (!/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i.test(payload)) {
        throw new Error("Invalid encrypted HH settings");
      }
      const [version, iv, tag, ciphertext] = payload.split(":");
      if (version !== "v1" || !iv || !tag || !ciphertext)
        throw new Error("Invalid encrypted HH settings");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "hex"),
      );
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      return applicationSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "hex")),
            decipher.final(),
          ]).toString("utf8"),
        ),
      );
    },
    save(settings: ApplicationSettings): void {
      const validated = applicationSchema.parse(settings);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(validated), "utf8"),
        cipher.final(),
      ]);
      const payload = [
        "v1",
        iv.toString("hex"),
        cipher.getAuthTag().toString("hex"),
        ciphertext.toString("hex"),
      ].join(":");
      const temporary = file + "." + randomBytes(8).toString("hex") + ".tmp";
      try {
        fs.writeFileSync(temporary, payload, { mode: 0o600, flag: "wx" });
        fs.renameSync(temporary, file);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}
