import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 拦截 node:fs 以统计真实磁盘读次数;其余行为全部透传真实实现。
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();

  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const { createFileStorageAdapter } = await import("../src/lib/fileStorage.mjs");

function serialized(revision, payload = "x") {
  return JSON.stringify({ version: 2, revision, payload });
}

function diskReadsOf(filePath) {
  return vi.mocked(readFileSync).mock.calls.filter(([path]) => path === filePath).length;
}

describe("createFileStorageAdapter read cache", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()();
    }
    vi.mocked(readFileSync).mockClear();
  });

  function createAdapter() {
    const dir = mkdtempSync(join(tmpdir(), "aitl-fs-"));
    const filePath = join(dir, "store.json");
    const adapter = createFileStorageAdapter(filePath, { ownerId: "unit-test" });

    cleanups.push(() => {
      adapter.close();
      rmSync(dir, { recursive: true, force: true });
    });

    return { adapter, filePath };
  }

  it("文件未变化时重复 read() 不重读磁盘", () => {
    const { adapter, filePath } = createAdapter();

    expect(adapter.compareAndSwap(0, serialized(1))).toBe(true);
    vi.mocked(readFileSync).mockClear();

    const first = adapter.read();
    const second = adapter.read();

    expect(first).toBe(second);
    expect(JSON.parse(first).revision).toBe(1);
    expect(diskReadsOf(filePath)).toBe(0);
  });

  it("compareAndSwap 成功后 read() 立刻返回新内容,且不需要重读磁盘", () => {
    const { adapter, filePath } = createAdapter();

    expect(adapter.compareAndSwap(0, serialized(1))).toBe(true);
    adapter.read();
    expect(adapter.compareAndSwap(1, serialized(2, "updated"))).toBe(true);
    vi.mocked(readFileSync).mockClear();

    expect(JSON.parse(adapter.read()).revision).toBe(2);
    expect(JSON.parse(adapter.read()).payload).toBe("updated");
    expect(diskReadsOf(filePath)).toBe(0);
  });

  it("文件被外部改写后缓存失效,read() 返回磁盘上的新内容", () => {
    const { adapter, filePath } = createAdapter();

    expect(adapter.compareAndSwap(0, serialized(1))).toBe(true);
    adapter.read();

    // 模拟外部进程直接改文件(长度不同,stat 必然变化)。
    writeFileSync(filePath, `${serialized(7, "externally-rewritten-content")}\n`);

    expect(JSON.parse(adapter.read()).revision).toBe(7);
  });

  it("外部改写后 compareAndSwap 用磁盘上的真实 revision 判定", () => {
    const { adapter, filePath } = createAdapter();

    expect(adapter.compareAndSwap(0, serialized(1))).toBe(true);
    adapter.read();

    writeFileSync(filePath, `${serialized(5, "external")}\n`);

    // 按缓存的 revision(1)提交必须失败,按真实 revision(5)提交必须成功。
    expect(adapter.compareAndSwap(1, serialized(2))).toBe(false);
    expect(adapter.compareAndSwap(5, serialized(6))).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf8")).revision).toBe(6);
  });

  it("缓存不改变空文件语义:不存在的文件 read() 返回空串", () => {
    const { adapter } = createAdapter();

    expect(adapter.read()).toBe("");
    expect(adapter.read()).toBe("");
  });
});
