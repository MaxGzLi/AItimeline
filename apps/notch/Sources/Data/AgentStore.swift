import Darwin
import Foundation
import SwiftUI

/// 一个正在跑的 Claude Code 会话。
struct AgentSession: Identifiable, Equatable {
    enum State: Int, Comparable {
        /// 停在那儿等你回话 —— 要权限、要你填东西。**卡着不动了。**
        case waiting = 0
        /// 这一轮挂了。也是要你动手的一档。
        case failed = 1
        /// 在干活。
        case working = 2
        /// 闲着,等你下一句。
        case idle = 3

        static func < (a: State, b: State) -> Bool { a.rawValue < b.rawValue }

        /// 要不要你现在动手。静默条只认这个。
        var needsYou: Bool { self == .waiting || self == .failed }

        var title: String {
            switch self {
            case .waiting: return "等你回话"
            case .failed: return "这轮挂了"
            case .working: return "在干活"
            case .idle: return "闲着"
            }
        }
    }

    let id: String
    var state: State
    var cwd: String
    var updatedAt: Date
    /// claude 本体的进程号。用来判断终端是不是已经没了 —— 按 ESC 打断、kill、直接关窗口
    /// 都**不发任何结束事件**(实测),只能靠看进程还在不在。
    var pid: pid_t
    /// 干完了但你还没看见。**这不是一个定时窗口**,是一块没揭的牌:
    /// 你真的把面板打开看过那一行,它才消。
    var unseen: Bool

    var project: String {
        let name = (cwd as NSString).lastPathComponent

        return name.isEmpty ? cwd : name
    }

    /// 家目录缩成 `~`,不然一行全是 `/Users/xxx/`。
    var shortPath: String {
        let home = NSHomeDirectory()

        return cwd.hasPrefix(home) ? "~" + cwd.dropFirst(home.count) : cwd
    }

    /// 上一声动静是多久以前。
    func silence(at now: Date) -> String {
        let seconds = Int(now.timeIntervalSince(updatedAt))

        if seconds < 10 { return "刚刚" }
        if seconds < 60 { return "\(seconds) 秒前" }
        if seconds < 3600 { return "\(seconds / 60) 分钟前" }

        return "\(seconds / 3600) 小时前"
    }

    /// 进程还在不在。`kill(pid, 0)` 不发信号,只问一句「这个进程号还有人吗」。
    /// `EPERM` 是「在,但不归你管」,也算活着。
    var alive: Bool {
        guard pid > 0 else { return true }

        return kill(pid, 0) == 0 || errno == EPERM
    }
}

/// 盯着 Claude Code 在干什么。
///
/// **这一版的全部设计都在回答一个问题:什么时候才配打扰你。** 上一版的答案是
/// 「只要它在跑就占着刘海」,那是错的 —— 实测这台机器一天有四百多个会话,
/// 真正需要你动手的不到百分之二。
///
/// 三条闸门,从上游往下游依次收窄:
///
/// 1. **脚本层**:机器自己跑的会话根本不写文件。`claude -p` / SDK 起的一次性会话
///    你从头到尾没参与,它干完了跟你没关系。这一刀砍掉了九成的量。
/// 2. **解析层**:`Notification` 是个大杂烩口子,十二种事件走同一个钩子。
///    只有四种是真要你动手的,其余一律不当回事 —— 尤其 `idle_prompt`,
///    它的意思是「你走开了」,不是「我卡住了」,回合结束满 60 秒必发。
///    上一版把它当成「等你回话」,等于给自己造了一条全天亮着的假警报。
/// 3. **占位层**:「在干活」永远不占静默条。占条的只有两种:要你动手的,
///    和干完了你还没看见的。
///
/// 通路:
/// ```
/// Claude Code 钩子 --写文件--> ~/Library/.../AITimelineNotch/agents/ --看目录--> 刘海
/// ```
/// 不照原版起 Python HTTP 桥:原生应用能读文件,少一个进程、一个端口、一个故障档。
@MainActor
final class AgentStore: ObservableObject {
    static let shared = AgentStore()

    @Published private(set) var sessions: [AgentSession] = []
    /// 钩子装没装。
    @Published private(set) var hooked = false
    @Published private(set) var lastError: String?
    /// 每轮扫一次往前挪一下,「3 分钟前」这种话得有人推它才会变。
    @Published private(set) var now = Date()

    /// AI 进程面正露在半屏面板上。这时候来的「干完了」直接算已看 ——
    /// 你人就在这儿看着,不需要事后再提醒一次。
    var faceVisible = false {
        didSet { if faceVisible { markSeen() } }
    }

    /// 多久没消息就把会话划掉。进程存活轮询才是主力,这个只是兜底。
    private let sessionTTL: TimeInterval = 30 * 60

    private let inbox: URL
    /// 钩子脚本落在这里,**不放在应用包里**:应用挪个位置,写进 settings.json 的路径就断了。
    private let script: URL
    private let settings = URL(fileURLWithPath: NSHomeDirectory() + "/.claude/settings.json")

    /// 认领标记。拆的时候只删带这个记号的,不碰用户自己配的钩子。
    private static let marker = "# aitimeline-notch"

    /// 装哪几个钩子。**一个回合最多各触发一次**,没有工具级的高频钩子。
    ///
    /// 上一版装了 `PreToolUse` / `PostToolUse`,那是每次工具调用各写一个文件 ——
    /// 实测一个会话 1713 次工具调用,就是三千多个文件,而且钩子是**卡着主循环**跑的,
    /// 等于给 Claude Code 的每一次工具调用都加一笔开销。砍掉。
    ///
    /// 砍掉之后没有心跳了,靠三样补回来:`StopFailure`(报错结束不走 `Stop`)、
    /// `Stop` 自带的 `background_tasks`(后台子 agent 还在跑时不算结束)、
    /// 以及进程存活轮询(按 ESC、崩溃、关窗口都不发任何事件)。
    private static let events: [(event: String, label: String)] = [
        ("SessionStart", "Start"),
        ("UserPromptSubmit", "Working"),
        ("Notification", "Notify"),
        ("Stop", "Stop"),
        ("StopFailure", "Failed"),
        ("SessionEnd", "Ended")
    ]

    /// `Notification` 十二种类型里,**只有这四种是真要你动手的**。
    ///
    /// 特别点名 `idle_prompt`:它在回合结束满 60 秒、且这 60 秒你没碰过键盘时必发,
    /// 文案是「Claude is waiting for your input」。字面像「在等你」,实际意思是
    /// 「你走开了」—— 活早干完了,没人卡着。把它当成等你回话,刘海就会常年亮着琥珀。
    private static let needsYouNotifications: Set<String> = [
        "permission_prompt",
        "agent_needs_input",
        "elicitation_dialog",
        "worker_permission_prompt"
    ]

    /// 这几种 `SessionStart` 不是新会话,是同一个会话在半路重开:
    /// `resume` 是接着上次跑,`compact` 是上下文满了自动压缩 —— **压缩发生在回合中间**,
    /// 当成「闲下来了」就会在人家干得正欢的时候报一次「干完了」。
    private static let midSessionStarts: Set<String> = ["resume", "compact"]

    private var watcher: DispatchSourceFileSystemObject?
    private var sweeper: Timer?
    /// 开机把积压的文件补放一遍时不算数:那都是几小时前的事,不该弹「干完了」。
    private var replaying = false

    private init() {
        let support = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AITimelineNotch", isDirectory: true)

        inbox = support.appendingPathComponent("agents", isDirectory: true)
        script = support.appendingPathComponent("claude-hook.sh")

        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        hooked = readHookState()

        replaying = true
        drain()
        replaying = false

        watch()
        retimeSweeper()
    }

    // MARK: - 给别人看的几个数

    var needsYou: Int { sessions.filter { $0.state.needsYou }.count }
    var working: Int { sessions.filter { $0.state == .working }.count }
    var unseen: Int { sessions.filter { $0.unseen }.count }

    /// 配不配占静默条。**「在干活」不在里面** —— 那是它的事,不是你的事。
    var deservesStrip: Bool { needsYou > 0 || unseen > 0 }

    /// 最该看的那一个。
    var headline: AgentSession? { sessions.first }

    /// 静默条上那一个记号加一个数。
    ///
    /// 琥珀只给「要你动手」。干完了是白的 —— 它可以等,你什么时候抬头看都行。
    var strip: (symbol: String, text: String, urgent: Bool)? {
        if needsYou > 0 { return ("hand.raised", "\(needsYou)", true) }
        if unseen > 0 { return ("checkmark", "\(unseen)", false) }

        return nil
    }

    /// 悬停条和肩栏上的那句话。**先报静默条数的那个数**,会话总数放后面 ——
    /// 三档口径不一样的话,条上写 1、悬停写 5、点开又是一组,看着像数据在乱跳。
    var summary: String {
        guard !sessions.isEmpty else { return hooked ? "" : "还没接上" }

        var parts: [String] = []

        if needsYou > 0 { parts.append("\(needsYou) 个等你") }
        if unseen > 0 { parts.append("\(unseen) 个干完了") }
        if working > 0 { parts.append("\(working) 个在跑") }

        parts.append("共 \(sessions.count)")

        return parts.joined(separator: " · ")
    }

    /// 用户真的看见了。只在半屏面板上的 AI 进程面露脸时调。
    func markSeen() {
        guard sessions.contains(where: { $0.unseen }) else { return }

        var next = sessions

        for index in next.indices { next[index].unseen = false }

        sessions = next
    }

    // MARK: - 收事件

    /// 目录一变就来收,收完把文件删掉 —— 这是收件箱不是日志。
    ///
    /// **按文件的修改时间排,不按文件名排。** 文件名里的时间戳只到秒,后面跟的是
    /// `mktemp` 的随机串;同一秒里落地的两个事件,按名字排出来的顺序是随机的。
    /// 实测 `Stop` 和 `SessionEnd` 常常只差零点几秒,排反了会话就诈尸。
    private func drain() {
        let manager = FileManager.default

        guard let urls = try? manager.contentsOfDirectory(
            at: inbox,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            return
        }

        let files = urls
            .filter { $0.pathExtension == "json" }
            .map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast) }
            .sorted { $0.1 < $1.1 }

        guard !files.isEmpty else { return }

        // 一轮里改完再写回去。**一条条改会让常驻屏幕的静默条重算好多遍** ——
        // 一个事件本来就会让目录变三次(建、改名、删),再乘以每条属性各发一次通知。
        var next = sessions
        let horizon = Date().addingTimeInterval(-sessionTTL)

        for (file, stamp) in files {
            defer { try? manager.removeItem(at: file) }

            // 太老的直接扔,连解析都不必 —— 应用关了一整夜,收件箱里全是昨天的事。
            guard stamp > horizon else { continue }
            guard let raw = try? String(contentsOf: file, encoding: .utf8) else { continue }

            apply(raw, at: stamp, into: &next)
        }

        commit(next)
    }

    /// 文件的形状:**第一行是事件标签,第二行是进程号,剩下是钩子原样的 JSON**。
    /// 标签由脚本参数给,不从 JSON 里猜 —— 少依赖一个字段就少一处会坏的地方。
    private func apply(_ raw: String, at stamp: Date, into list: inout [AgentSession]) {
        var lines = raw.split(separator: "\n", omittingEmptySubsequences: false)

        guard lines.count >= 2 else { return }

        let label = lines.removeFirst().trimmingCharacters(in: .whitespaces)
        let pid = pid_t(lines.removeFirst().trimmingCharacters(in: .whitespaces)) ?? 0

        guard let data = lines.joined(separator: "\n").data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = payload["session_id"] as? String else {
            return
        }

        // 子 agent 里发出来的事件跟主线程**共用同一个会话号**,只有它带 agent_id。
        // 不挡掉的话,子 agent 一结束就会被当成「这一轮干完了」。
        guard payload["agent_id"] == nil else { return }

        if label == "Ended" {
            list.removeAll { $0.id == id }
            return
        }

        let cwd = payload["cwd"] as? String ?? ""
        let existing = list.firstIndex { $0.id == id }

        // 临时目录里跑的基本都是脚本起的,不是你坐在终端前敲的。
        if existing == nil, cwd.isEmpty || Self.isScratch(cwd) { return }

        guard let state = resolve(label, payload, current: existing.map { list[$0].state }) else { return }

        // 干完了才算一块没揭的牌:上一刻还在干活,这一刻停了。
        // 开机补放旧事件、以及面板正开着的时候,都不算。
        let wasWorking = existing.map { list[$0].state == .working } ?? false
        let finished = wasWorking && state == .idle && !replaying && !faceVisible

        if let index = existing {
            list[index].state = state
            list[index].updatedAt = stamp
            list[index].unseen = list[index].unseen || finished

            if !cwd.isEmpty { list[index].cwd = cwd }
            if pid > 0 { list[index].pid = pid }
        } else {
            list.append(AgentSession(
                id: id, state: state, cwd: cwd, updatedAt: stamp, pid: pid, unseen: false
            ))
        }
    }

    /// 事件标签 + 事件内容 → 状态。**这里是全部的判断力所在。**
    /// 返回 nil 表示「这条不改状态」—— 不是所有事件都值得动状态机。
    private func resolve(
        _ label: String,
        _ payload: [String: Any],
        current: AgentSession.State?
    ) -> AgentSession.State? {
        switch label {
        case "Working":
            return .working

        case "Failed":
            return .failed

        case "Start":
            // resume / compact 是同一个会话半路重开,状态维持原样。
            let source = payload["source"] as? String ?? "startup"

            return Self.midSessionStarts.contains(source) ? current : .idle

        case "Stop":
            // **后台子 agent 还在跑的时候会先 Stop 一次。** 实测一条人类消息产生两次 Stop:
            // 头一次 background_tasks 里躺着 running 的子 agent,最后一次才是空的。
            // 只看 Stop 不看这个字段,就会在活还没干完的时候报一次「干完了」。
            let pending = (payload["background_tasks"] as? [[String: Any]])?.isEmpty == false

            return pending ? .working : .idle

        case "Notify":
            let kind = payload["notification_type"] as? String ?? ""

            if Self.needsYouNotifications.contains(kind) { return .waiting }

            // idle_prompt 的意思是「你走开了」,活早干完了。其余(登录成功、
            // 后台 agent 干完了、开始/结束操控电脑……)一概不需要你动手,状态不动。
            return kind == "idle_prompt" ? .idle : nil

        default:
            return nil
        }
    }

    /// 临时目录里的会话不收:那是脚本起的 `claude -p`,你从头到尾没参与。
    private static func isScratch(_ path: String) -> Bool {
        path.hasPrefix("/private/var/folders/")
            || path.hasPrefix("/var/folders/")
            || path.hasPrefix("/tmp/")
            || path.hasPrefix("/private/tmp/")
    }

    /// 排好序写回去,**没变就不写** —— 每写一次,常驻屏幕的静默条就重算一次。
    private func commit(_ list: [AgentSession]) {
        let sorted = list.sorted {
            $0.state == $1.state ? $0.updatedAt > $1.updatedAt : $0.state < $1.state
        }

        guard sorted != sessions else { return }

        sessions = sorted
        retimeSweeper()
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

    /// 有会话才起这只表,没会话就停掉。
    ///
    /// 上一版是 `init` 里无条件起一只 5 秒的表、永不停 —— 没装钩子、零会话、
    /// 应用没露脸,照跑。一天一万七千次目录扫描,全落在一个大部分时候压根不显示的面上。
    private func retimeSweeper() {
        guard !sessions.isEmpty else {
            sweeper?.invalidate()
            sweeper = nil
            return
        }

        guard sweeper == nil else { return }

        let timer = Timer(timeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sweep() }
        }

        RunLoop.main.add(timer, forMode: .common)
        sweeper = timer
    }

    /// 兜底那一轮:补收漏掉的事件、清掉终端已经没了的会话、把「几分钟前」往前推。
    private func sweep() {
        drain()

        let stamp = Date()

        now = stamp

        // 进程没了就划掉。**按 ESC 打断、kill、直接关窗口,一个结束事件都不发**(实测),
        // 只有问进程还在不在能兜住。不留着显示「在干活」骗人。
        let survivors = sessions.filter {
            $0.alive && stamp.timeIntervalSince($0.updatedAt) <= sessionTTL
        }

        commit(survivors)
    }

    // MARK: - 接线

    /// 往 `~/.claude/settings.json` 里加钩子。**用户按了按钮才走这儿。**
    func connect() {
        lastError = nil

        do {
            try writeScript()

            var root = try readSettings()
            // 先把旧的全扫干净再写新的,不然改过事件表之后会留下删不掉的孤儿。
            var hooks = strip(marker: root["hooks"] as? [String: Any] ?? [:])

            for (event, label) in Self.events {
                var entries = hooks[event] as? [[String: Any]] ?? []

                entries.append([
                    "hooks": [[
                        "type": "command",
                        "command": "'\(script.path)' \(label) \(Self.marker)"
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

    /// 拆干净:配置、脚本、收件箱、还在盯着的那只手,一起收。
    ///
    /// 上一版只改了配置就把 `hooked` 置假,结果是已经开着的会话照旧写文件、照旧被收进来,
    /// 列表几秒后自己长回来,而按钮因为 `hooked` 是假的已经藏起来了 —— 一个都按不动。
    func disconnect() {
        lastError = nil

        do {
            var root = try readSettings()
            let hooks = strip(marker: root["hooks"] as? [String: Any] ?? [:])

            if hooks.isEmpty {
                root.removeValue(forKey: "hooks")
            } else {
                root["hooks"] = hooks
            }

            try backup()
            try write(root)

            watcher?.cancel()
            watcher = nil

            try? FileManager.default.removeItem(at: script)
            try? FileManager.default.removeItem(at: inbox)
            try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

            commit([])
            watch()

            hooked = false
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// 把所有带我们记号的钩子条目摘掉,**遍历整张表,不只看我们现在认识的那几个事件**。
    /// 事件表以后还会变,按固定表扫的话,改一次表就在用户配置里留一批删不掉的孤儿。
    private func strip(marker hooks: [String: Any]) -> [String: Any] {
        var kept: [String: Any] = [:]

        for (event, value) in hooks {
            guard let entries = value as? [[String: Any]] else {
                kept[event] = value
                continue
            }

            let mine = entries.filter { entry in
                guard let inner = entry["hooks"] as? [[String: Any]] else { return false }

                return inner.contains { ($0["command"] as? String)?.contains(Self.marker) == true }
            }

            let rest = entries.filter { entry in !mine.contains { $0 as NSDictionary == entry as NSDictionary } }

            if !rest.isEmpty { kept[event] = rest }
        }

        return kept
    }

    /// 系统设置里改过、或者用户手工编辑过配置,面板每次露脸重新看一眼。
    func refresh() {
        hooked = readHookState()
        drain()
    }

    private func readHookState() -> Bool {
        guard let raw = try? String(contentsOf: settings, encoding: .utf8) else { return false }

        return raw.contains(Self.marker)
    }

    private func readSettings() throws -> [String: Any] {
        guard let data = try? Data(contentsOf: settings), !data.isEmpty else { return [:] }

        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Failure.badSettings
        }

        return root
    }

    /// **备份只存一次。** 上一版每次接线都覆盖一遍,于是「接上 → 拆掉 → 再接上」
    /// 三步之后,那份号称「原样」的备份其实是上一步带钩子的版本 —— 界面上的承诺不成立了。
    private func backup() throws {
        let copy = settings.appendingPathExtension("aitimeline-bak")

        guard FileManager.default.fileExists(atPath: settings.path),
              !FileManager.default.fileExists(atPath: copy.path) else {
            return
        }

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

    /// 钩子脚本本体。做两件事:**先把机器自己跑的会话挡在门外,再把标准输入原样落成文件**。
    ///
    /// 第一刀是全套设计里最要紧的一刀。实测这台机器一天四百多个会话,九成是
    /// 自己的管线在跑 `claude -p` —— 那些你从头到尾没参与,它们干完了跟你没关系。
    /// 不在这儿挡掉,后面做多少节流都是白搭。
    ///
    /// JSON 一个字都不解析,留给 Swift:shell 里拆 JSON 要么靠 python(机器上不一定有),
    /// 要么靠 sed(遇到转义就错)。
    ///
    /// 先写临时文件再改名(改名是原子的,应用读不到写了一半的),无论如何 `exit 0`
    /// (钩子返回非零会打断 Claude Code,看个状态不值得)。
    private func writeScript() throws {
        let body = """
        #!/bin/sh
        # AITimeline 刘海:把 Claude Code 的事件落成文件。应用自己生成的,改了会被覆盖。

        # 只收你自己坐在终端前敲出来的会话。claude -p 和 SDK 起的一次性会话不收。
        [ "${CLAUDE_CODE_ENTRYPOINT:-cli}" = "cli" ] || exit 0

        d="\(inbox.path)"
        [ -d "$d" ] || exit 0
        f=$(mktemp "$d/e.XXXXXXXX" 2>/dev/null) || exit 0
        printf '%s\\n%s\\n' "${1:-Working}" "${CLAUDE_PID:-0}" > "$f" 2>/dev/null
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
