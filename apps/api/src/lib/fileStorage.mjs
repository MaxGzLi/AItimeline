// @ts-check

import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { readSerializedRevision } from "../../../../packages/core/dist/index.js";

export function createFileStorageAdapter(filePath, { ownerId, backupCount = 3 }) {
  if (!ownerId) throw new Error("File storage adapter requires ownerId.");
  const targetPath = resolve(filePath);
  const lockPath = `${targetPath}.lock`;
  const localHostname = hostname();
  const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const lockOwner = {
    format: 1,
    targetPath,
    pid: process.pid,
    hostname: localHostname,
    ownerId,
    processStartedAt,
    acquiredAt: new Date().toISOString()
  };
  let closed = false;
  let counter = 0;
  mkdirSync(dirname(targetPath), { recursive: true });
  acquireWriterLock(lockPath, lockOwner);

  const adapter = {
    read() {
      return existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
    },
    compareAndSwap(expectedRevision, serialized) {
      if (closed) throw new Error(`Storage adapter is closed: ${targetPath}`);
      const tempPath = `${targetPath}.tmp-${process.pid}-${ownerId}-${++counter}`;
      try {
        writeAndSyncFile(tempPath, `${serialized}\n`);
        const current = adapter.read();
        const actualRevision = readSerializedRevision(current);
        if (actualRevision !== expectedRevision) return false;
        if (current) createRollingBackup(targetPath, current, backupCount, ownerId, ++counter);
        renameSync(tempPath, targetPath);
        fsyncDirectory(dirname(targetPath));
        return true;
      } finally {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        const current = JSON.parse(readFileSync(lockPath, "utf8"));
        if (current.ownerId === ownerId && current.targetPath === targetPath) unlinkSync(lockPath);
      } catch (error) {
        if (existsSync(lockPath) && error?.code !== "ENOENT") throw error;
      }
    }
  };
  return adapter;
}

function acquireWriterLock(lockPath, owner) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, `${JSON.stringify(owner)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      fsyncDirectory(dirname(lockPath));
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    let existing;
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      throw writerLockError(lockPath, "malformed lock; manual cleanup required");
    }
    if (!existing || existing.format !== 1 || typeof existing.pid !== "number" || typeof existing.hostname !== "string" || typeof existing.ownerId !== "string" || typeof existing.targetPath !== "string") {
      throw writerLockError(lockPath, "malformed lock; manual cleanup required");
    }
    if (existing.hostname !== owner.hostname) {
      throw writerLockError(lockPath, `lock belongs to foreign host ${existing.hostname}; manual verification required`);
    }
    try {
      process.kill(existing.pid, 0);
      throw writerLockError(lockPath, `live writer pid ${existing.pid} (${existing.ownerId})`);
    } catch (error) {
      if (error?.code === "EPERM") throw writerLockError(lockPath, `live writer pid ${existing.pid} cannot be probed`);
      if (error?.code !== "ESRCH") throw error;
    }

    const reapPath = `${lockPath}.reap-${process.pid}-${owner.ownerId}-${attempt}`;
    try {
      linkSync(lockPath, reapPath);
      const currentStat = lstatSync(lockPath);
      const reapStat = lstatSync(reapPath);
      if (currentStat.dev !== reapStat.dev || currentStat.ino !== reapStat.ino) {
        throw writerLockError(lockPath, "lock changed during stale-owner recovery");
      }
      unlinkSync(lockPath);
    } finally {
      if (existsSync(reapPath)) unlinkSync(reapPath);
    }
  }
  throw writerLockError(lockPath, "could not acquire lock after stale-owner recovery");
}

function writerLockError(lockPath, detail) {
  /** @type {Error & { code?: string }} */
  const error = new Error(`Writer lock rejected for ${lockPath}: ${detail}`);
  error.code = "AITIMELINE_WRITER_LOCKED";
  return error;
}

function createRollingBackup(targetPath, current, backupCount, ownerId, counter) {
  const backupTemp = `${targetPath}.bak.tmp-${process.pid}-${ownerId}-${counter}`;
  try {
    writeAndSyncFile(backupTemp, current.endsWith("\n") ? current : `${current}\n`);
    for (let index = backupCount; index >= 2; index -= 1) {
      const older = `${targetPath}.bak.${index - 1}`;
      const destination = `${targetPath}.bak.${index}`;
      if (existsSync(destination)) unlinkSync(destination);
      if (existsSync(older)) renameSync(older, destination);
    }
    if (existsSync(`${targetPath}.bak.1`)) unlinkSync(`${targetPath}.bak.1`);
    renameSync(backupTemp, `${targetPath}.bak.1`);
    fsyncDirectory(dirname(targetPath));
  } finally {
    if (existsSync(backupTemp)) unlinkSync(backupTemp);
  }
}

function writeAndSyncFile(path, contents) {
  const fd = openSync(path, "wx");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
