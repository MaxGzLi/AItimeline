// 一次性存量压缩:把已结算(materializedAt 已标记)的终结任务 result 压成摘要,
// 同时处理 curation-jobs.json 与主快照 aitimeline.json 里的镜像副本。
// 新数据不需要本脚本(markMaterialized 落库时已自动瘦身),它只服务历史存量。
//
// 用法(必须先停掉本机 API,脚本会检查写锁):
//   node scripts/compact-curation-results.mjs [数据目录,默认 apps/api/data]
//
// 跑之前自动把两个文件整份备份到 <数据目录>/backup-<时间戳>/。

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { compactTerminalCurationResult, decodeBackgroundCurationJobStoreSnapshot, decodeAITimelinePersistenceSnapshot } =
  await import("../packages/core/dist/index.js");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(process.argv[2] ?? join(repoRoot, "apps/api/data"));
const snapshotPath = join(dataDir, "aitimeline.json");
const jobsPath = join(dataDir, "curation-jobs.json");

function assertNoWriterLock(filePath) {
  const lockPath = `${filePath}.lock`;

  if (existsSync(lockPath)) {
    console.error(`发现写锁 ${lockPath}:本机 API 可能还在运行。先停掉它(或确认残锁后手动删除)再跑。`);
    process.exit(1);
  }
}

function formatMb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const terminalStatuses = new Set(["succeeded", "failed", "skipped"]);

function compactRecords(records) {
  let compacted = 0;
  const next = records.map((record) => {
    if (!terminalStatuses.has(record.status) || !record.materializedAt || !record.result) {
      return record;
    }
    if (record.result.compactedAt) {
      return record;
    }
    compacted += 1;
    return { ...record, result: compactTerminalCurationResult(record.result, record.materializedAt) };
  });

  return { next, compacted };
}

for (const filePath of [snapshotPath, jobsPath]) {
  if (!existsSync(filePath)) {
    console.error(`找不到 ${filePath},确认数据目录参数。`);
    process.exit(1);
  }
  assertNoWriterLock(filePath);
}

const backupDir = join(dataDir, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);

mkdirSync(backupDir, { recursive: true });
for (const filePath of [snapshotPath, jobsPath]) {
  copyFileSync(filePath, join(backupDir, filePath.split("/").pop()));
}
console.log(`已备份两个文件到 ${backupDir}`);

// 队列文件:走真解码器(顺带做规范化迁移),压缩后原 revision 写回。
{
  const before = statSync(jobsPath).size;
  const decoded = decodeBackgroundCurationJobStoreSnapshot(readFileSync(jobsPath, "utf8"));

  for (const issue of decoded.issues) {
    console.warn(`[curation-jobs 解码提示] ${issue.jsonPath}: ${issue.message}`);
  }
  const { next, compacted } = compactRecords(decoded.snapshot.records);

  writeFileSync(jobsPath, `${JSON.stringify({ ...decoded.snapshot, records: next })}\n`);
  const after = statSync(jobsPath).size;

  console.log(`curation-jobs.json: 压缩 ${compacted} 条终结任务,${formatMb(before)} -> ${formatMb(after)}`);
}

// 主快照:只动 curationJobs 镜像,其余集合原样保留。
{
  const before = statSync(snapshotPath).size;
  const decoded = decodeAITimelinePersistenceSnapshot(readFileSync(snapshotPath, "utf8"));

  for (const issue of decoded.issues) {
    console.warn(`[snapshot 解码提示] ${issue.jsonPath ?? ""}: ${issue.message}`);
  }
  const { next, compacted } = compactRecords(decoded.snapshot.curationJobs);

  writeFileSync(snapshotPath, `${JSON.stringify({ ...decoded.snapshot, curationJobs: next })}\n`);
  const after = statSync(snapshotPath).size;

  console.log(`aitimeline.json: 压缩 ${compacted} 条镜像记录,${formatMb(before)} -> ${formatMb(after)}`);
}

console.log("完成。重启本机 API 后生效;确认无异常后可自行删除备份目录。");
