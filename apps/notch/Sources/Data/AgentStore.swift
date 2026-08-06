import Foundation
import SwiftUI

/// 一个正在跑的 Claude Code 会话。
struct AgentSession: Identifiable, Equatable {
    enum State: Int, Comparable {
        /// 停在那儿等你回话 —— 问你问题、要你批准。**这是唯一需要你立刻动手的状态。**
        case waiting = 0
        /// 在干活。
        case working = 1
        /// 闲着,等你下一句。
        case idle = 2

        static func < (a: State, b: State) -> Bool { a.rawValue < b.rawValue }

        var title: String {
            switch self {
            case .waiting: return "等你回话"
            case .working: return "在干活"
            case .idle: return "闲着"
            }
        }
    }

    let id: String
    var state: State
    /// 在哪个目录跑的。列表上显示最后一段就够,全路径留给副行。
    var cwd: String
    var updatedAt: Date

    var project: String {
        let name = (cwd as NSString).lastPathComponent

        return name.isEmpty ? cwd : name
    }

    /// 家目录缩成 `~`,不然一行全是 `/Users/xxx/`。
    var shortPath: String {
        let home = NSHomeDirectory()

        return cwd.hasPrefix(home) ? "~" + cwd.dropFirst(home.count) : cwd
    }

    /// 上一声动静是多久以前。列表右边那一小行。
    func silence(at now: Date) -> String {
        let seconds = Int(now.timeIntervalSince(updatedAt))

        if seconds < 10 { return "刚刚" }
        if seconds < 60 { return "\(seconds) 秒前" }
        if seconds < 3600 { return "\(seconds / 60) 分钟前" }

        return "\(seconds / 3600) 小时前"
    }
}

/// 盯着 Claude Code 在干什么。
///
/// **为什么不照原版那样起一个本地服务**:原版的扩展跑在 JS 沙箱里,碰不到文件系统,
/// 所以它得拿 Python 起一个 HTTP 桥,钩子用 curl 往 `127.0.0.1:7823` 发。
/// 我们这边是原生应用,文件随便读 —— 钩子直接把事件写成一个文件,这边看着目录收,
/// 省掉一整个 Python 进程、一个端口、和「桥没起来」这个故障档。
///
/// 通路:
/// ```
/// Claude Code 钩子 --写文件--> ~/Library/.../AITimelineNotch/agents/ --看目录--> 刘海
/// ```
///
/// **不自己往 `~/.claude/settings.json` 里写东西。** 那是用户自己的配置,
/// 得他按了「接上」才动,而且动之前先备份一份。
@MainActor
final class AgentStore: ObservableObject {
    static let shared = AgentStore()

    @Published private(set) var sessions: [AgentSession] = []
    /// 钩子装没装。没装的话这个面只能显示一句「还没接上」,不能装作没有会话。
    @Published private(set) var hooked = false
    /// 上一次接线失败的原因。成功就是 nil。
    @Published private(set) var lastError: String?
    /// 每轮扫一次就往前挪一下。**「3 分钟前」这种话得有人推它才会变** ——
    /// 会话本身半天不动,只看 `sessions` 的话那一行会一直写着「刚刚」。
    @Published private(set) var now = Date()

    /// 干着活但半分钟没动静的,当它闲了。钩子崩了不能让一个会话永远挂着「在干活」。
    private let workingDecay: TimeInterval = 30
    /// 半小时没消息的会话从列表里划掉。
    private let sessionTTL: TimeInterval = 30 * 60

    /// 钩子写事件的地方。
    private let inbox: URL
    /// 钩子脚本自己落在这里 —— **不放在应用包里**:用户把应用挪个位置,
    /// 写进 `settings.json` 的路径就断了。这个路径不会变。
    private let script: URL
    private let settings = URL(fileURLWithPath: NSHomeDirectory() + "/.claude/settings.json")

    /// 认领标记。卸载的时候只删带这个记号的那几条,不碰用户自己配的钩子。
    private static let marker = "# aitimeline-notch"

    /// 钩子事件名 → 状态。照原版的对法。
    private static let events: [(event: String, state: String)] = [
        ("SessionStart", "Idle"),
        ("UserPromptSubmit", "Working"),
        ("PreToolUse", "Working"),
        ("PostToolUse", "Working"),
        ("Notification", "Waiting"),
        ("Stop", "Idle"),
        ("SessionEnd", "Ended")
    ]

    private var watcher: DispatchSourceFileSystemObject?
    private var sweeper: Timer?

    private init() {
        let support = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AITimelineNotch", isDirectory: true)

        inbox = support.appendingPathComponent("agents", isDirectory: true)
        script = support.appendingPathComponent("claude-hook.sh")

        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        hooked = readHookState()
        drain()
        watch()
        sweep()
    }

    // MARK: - 给别人看的几个数

    var waiting: Int { sessions.filter { $0.state == .waiting }.count }
    var working: Int { sessions.filter { $0.state == .working }.count }

    /// 有没有值得占静默条的事。闲着的会话不算 —— 静默条只报「正在动的」。
    var busy: Bool { waiting > 0 || working > 0 }

    /// 最该看的那一个:先等你回话的,再干活的,同档里挑最近有动静的。
    var headline: AgentSession? { sessions.first }

    /// 静默条上那句话。等你回话的优先报,因为那一档是卡着的。
    var strip: (symbol: String, text: String, urgent: Bool) {
        if waiting > 0 { return ("hand.raised", "\(waiting)", true) }
        if working > 0 { return ("chevron.left.forwardslash.chevron.right", "\(working)", false) }

        return ("chevron.left.forwardslash.chevron.right", "\(sessions.count)", false)
    }

    // MARK: - 收事件

    /// 目录一变就来收。收完就把文件删掉 —— 这是收件箱不是日志,留着只会越攒越多。
    private func drain() {
        let manager = FileManager.default

        guard let names = try? manager.contentsOfDirectory(atPath: inbox.path) else { return }

        // 按文件名排序 = 按写入先后排序(名字里带时间戳),乱序会让状态倒着盖。
        for name in names.sorted() where name.hasSuffix(".json") {
            let file = inbox.appendingPathComponent(name)

            defer { try? manager.removeItem(at: file) }

            guard let raw = try? String(contentsOf: file, encoding: .utf8) else { continue }

            apply(raw)
        }

        resort()
    }

    /// 文件的形状是:**头一行是状态,剩下的是钩子原样的 JSON**。
    /// 状态由脚本的参数给,不从 JSON 里猜 —— 少依赖一个字段就少一处会坏的地方。
    private func apply(_ raw: String) {
        var lines = raw.split(separator: "\n", omittingEmptySubsequences: false)

        guard !lines.isEmpty else { return }

        let label = lines.removeFirst().trimmingCharacters(in: .whitespaces)
        let body = lines.joined(separator: "\n")

        guard let data = body.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = payload["session_id"] as? String else {
            return
        }

        if label == "Ended" {
            sessions.removeAll { $0.id == id }
            return
        }

        let state: AgentSession.State = switch label {
        case "Waiting": .waiting
        case "Working": .working
        default: .idle
        }

        let cwd = payload["cwd"] as? String ?? ""

        if let index = sessions.firstIndex(where: { $0.id == id }) {
            sessions[index].state = state
            sessions[index].updatedAt = Date()

            if !cwd.isEmpty { sessions[index].cwd = cwd }
        } else {
            sessions.append(AgentSession(id: id, state: state, cwd: cwd, updatedAt: Date()))
        }
    }

    /// 等你回话的排最前,然后是干活的,同一档里最近有动静的在上面。
    private func resort() {
        sessions.sort {
            $0.state == $1.state ? $0.updatedAt > $1.updatedAt : $0.state < $1.state
        }
    }

    private func watch() {
        let descriptor = open(inbox.path, O_EVTONLY)

        guard descriptor >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write],
            queue: .main
        )

        source.setEventHandler { [weak self] in
            Task { @MainActor in self?.drain() }
        }

        source.setCancelHandler { close(descriptor) }
        source.resume()

        watcher = source
    }

    /// 看目录会漏(目录被替换、事件挤在一起),所以还是每 5 秒兜一次底,
    /// 顺手把该降级的降级、该划掉的划掉。
    private func sweep() {
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }

                self.drain()

                let now = Date()

                self.now = now

                var changed = false

                for index in self.sessions.indices {
                    let idle = now.timeIntervalSince(self.sessions[index].updatedAt)

                    if self.sessions[index].state == .working, idle > self.workingDecay {
                        self.sessions[index].state = .idle
                        changed = true
                    }
                }

                let before = self.sessions.count

                self.sessions.removeAll { now.timeIntervalSince($0.updatedAt) > self.sessionTTL }

                if changed || self.sessions.count != before { self.resort() }
            }
        }

        RunLoop.main.add(timer, forMode: .common)
        sweeper = timer
    }

    // MARK: - 接线

    /// 往 `~/.claude/settings.json` 里加钩子。**用户按了按钮才走这儿。**
    ///
    /// 动别人配置文件的三条规矩:先备份、只加自己那几条、认得出自己加的好卸干净。
    func connect() {
        lastError = nil

        do {
            try writeScript()

            var root = try readSettings()
            var hooks = root["hooks"] as? [String: Any] ?? [:]

            for (event, state) in Self.events {
                var entries = hooks[event] as? [[String: Any]] ?? []

                entries.removeAll { mine($0) }
                entries.append([
                    "hooks": [[
                        "type": "command",
                        "command": "'\(script.path)' \(state) \(Self.marker)"
                    ]]
                ])

                hooks[event] = entries
            }

            root["hooks"] = hooks

            try backup()
            try write(root)

            hooked = true
        } catch {
            lastError = error.localizedDescription
            hooked = readHookState()
        }
    }

    /// 卸干净:只删带记号的那几条,用户自己配的钩子一条不动。
    func disconnect() {
        lastError = nil

        do {
            var root = try readSettings()

            guard var hooks = root["hooks"] as? [String: Any] else {
                hooked = false
                return
            }

            for (event, _) in Self.events {
                guard var entries = hooks[event] as? [[String: Any]] else { continue }

                entries.removeAll { mine($0) }

                if entries.isEmpty {
                    hooks.removeValue(forKey: event)
                } else {
                    hooks[event] = entries
                }
            }

            if hooks.isEmpty {
                root.removeValue(forKey: "hooks")
            } else {
                root["hooks"] = hooks
            }

            try backup()
            try write(root)

            sessions.removeAll()
            hooked = false
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// 这一条是不是我们加的。认命令里的记号,不认位置 —— 用户可能重排过。
    private func mine(_ entry: [String: Any]) -> Bool {
        guard let inner = entry["hooks"] as? [[String: Any]] else { return false }

        return inner.contains { ($0["command"] as? String)?.contains(Self.marker) == true }
    }

    private func readHookState() -> Bool {
        guard let raw = try? String(contentsOf: settings, encoding: .utf8) else { return false }

        return raw.contains(Self.marker)
    }

    private func readSettings() throws -> [String: Any] {
        guard let data = try? Data(contentsOf: settings) else { return [:] }
        guard !data.isEmpty else { return [:] }

        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Failure.badSettings
        }

        return root
    }

    private func backup() throws {
        guard FileManager.default.fileExists(atPath: settings.path) else { return }

        let copy = settings.appendingPathExtension("aitimeline-bak")

        try? FileManager.default.removeItem(at: copy)
        try FileManager.default.copyItem(at: settings, to: copy)
    }

    private func write(_ root: [String: Any]) throws {
        try FileManager.default.createDirectory(
            at: settings.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let data = try JSONSerialization.data(
            withJSONObject: root,
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        )

        try data.write(to: settings, options: .atomic)
    }

    /// 钩子脚本本体。做的事只有一件:**把标准输入原样落成一个文件**。
    ///
    /// 解析留给 Swift 那边 —— shell 里拆 JSON 要么靠 python(机器上不一定有),
    /// 要么靠 sed(遇到转义就错)。这里一行 JSON 都不碰。
    ///
    /// 先写临时文件再改名:改名是原子的,应用永远读不到写了一半的文件。
    /// 无论如何 `exit 0` —— 钩子返回非零会打断 Claude Code,看个状态不值得。
    private func writeScript() throws {
        let body = """
        #!/bin/sh
        # AITimeline 刘海:把 Claude Code 的事件落成文件。这个文件是应用自己生成的,改了会被覆盖。
        d="\(inbox.path)"
        mkdir -p "$d" 2>/dev/null || exit 0
        f=$(mktemp "$d/e.$(date +%Y%m%d%H%M%S).XXXXXX" 2>/dev/null) || exit 0
        printf '%s\\n' "${1:-Working}" > "$f" 2>/dev/null
        cat >> "$f" 2>/dev/null
        mv "$f" "$f.json" 2>/dev/null
        exit 0

        """

        try body.write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
    }

    enum Failure: LocalizedError {
        case badSettings

        var errorDescription: String? {
            switch self {
            case .badSettings: return "~/.claude/settings.json 不是一份能读的 JSON,没敢动它"
            }
        }
    }
}
