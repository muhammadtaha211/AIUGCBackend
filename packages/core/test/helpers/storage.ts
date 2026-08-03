import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { missingObjectError, type Storage } from "../../src/storage";

/** Temp-dir storage backend so tests never touch the repo's .storage/. */
export function tempStorage(): { storage: Storage; root: string; cleanup: () => void } {
  const root = path.join(
    tmpdir(),
    `aiugc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const resolve = (storagePath: string) => path.join(root, storagePath);
  const storage: Storage = {
    async put(bucket, key, source) {
      const dest = resolve(`${bucket}/${key}`);
      mkdirSync(path.dirname(dest), { recursive: true });
      if (typeof source === "string") copyFileSync(source, dest);
      else writeFileSync(dest, source);
      return `${bucket}/${key}`;
    },
    async download(storagePath, localFile) {
      if (!existsSync(resolve(storagePath))) throw missingObjectError(storagePath);
      mkdirSync(path.dirname(localFile), { recursive: true });
      copyFileSync(resolve(storagePath), localFile);
    },
    async remove(storagePath) {
      rmSync(resolve(storagePath), { force: true });
    },
    async signedUrl(storagePath) {
      if (!existsSync(resolve(storagePath))) throw missingObjectError(storagePath);
      return `file://${resolve(storagePath).replaceAll("\\", "/")}`;
    },
    async createSignedUploadUrl(storagePath) {
      return `upload://${resolve(storagePath).replaceAll("\\", "/")}`;
    },
  };
  return { storage, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
