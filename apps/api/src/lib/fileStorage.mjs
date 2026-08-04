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
  statSync,
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
  // 读缓存:大文件(快照几十 MB)按 stat(ino+mtime+size)判断未变化就复用上次
  // 读到的内容,避免每个请求整读整file;revision 惰性求值,免去只为取 revision
  // 的整篇 JSON.parse。写锁保证本进程是唯一写者,外部手改文件会改变 stat,
  // 缓存自动失效。
  /** @type {{ ino: number, mtimeMs: number, size: number, content: string, revision: number | undefined } | null} */
  let cache = null;
  const statTarget = () => {
    try {
      return statSync(targetPath);
    } catch (error) {
      if (error && /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
      throw error;
    }
  };
  const cacheMatches = (stat) =>
    cache !== null && stat !== null && cache.ino === stat.ino && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size;
  mkdirSync(dirname(targetPath), { recursive: true });
  acquireWriterLock(lockPath, lockOwner);

  const adapter = {
    read() {
      // 先 stat 后读:两步之间文件被外部改写只会导致下次多读一遍,不会读到旧值。
      const stat = statTarget();
      if (!stat) {
        cache = null;
        return "";
      }
      if (cacheMatches(stat)) return cache.content;
      const content = readFileSync(targetPath, "utf8");
      cache = { ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size, content, revision: undefined };
      return content;
    },
    compareAndSwap(expectedRevision, serialized) {
      if (closed) throw new Error(`Storage adapter is closed: ${targetPath}`);
      const tempPath = `${targetPath}.tmp-${process.pid}-${ownerId}-${++counter}`;
      try {
        writeAndSyncFile(tempPath, `${serialized}\n`);
        const current = adapter.read();
        let actualRevision;
        if (cache !== null && cache.content === current && cache.revision !== undefined) {
          actualRevision = cache.revision;
        } else {
          actualRevision = readSerializedRevision(current);
          if (cache !== null && cache.content === current) cache.revision = actualRevision;
        }
        if (actualRevision !== expectedRevision) return false;
        if (current) createRollingBackup(targetPath, current, backupCount, ownerId, ++counter);
        renameSync(tempPath, targetPath);
        fsyncDirectory(dirname(targetPath));
        const written = `${serialized}\n`;
        const writtenStat = statTarget();
        // revision 记 expectedRevision + 1:revisioned 存储的提交契约是每次成功
        // 提交把 revision 恰好推进 1(commitWithRetry 负责写入该值)。stat 大小
        // 对不上说明 rename 后又被外部改过,放弃缓存退回重读。
        cache =
          writtenStat !== null && writtenStat.size === Buffer.byteLength(written, "utf8")
            ? {
                ino: writtenStat.ino,
                mtimeMs: writtenStat.mtimeMs,
                size: writtenStat.size,
                content: written,
                revision: expectedRevision + 1
              }
            : null;
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
