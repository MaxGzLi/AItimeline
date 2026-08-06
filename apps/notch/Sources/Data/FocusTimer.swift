import AppKit
import Foundation

/// 番茄钟。照原版的规矩来:专注 25 分钟、休息 5 分钟,专注结束**自动**接休息,
/// 休息结束**不**自动接下一轮 —— 歇完要不要再来一轮,得人自己说了算。
/// 长休息、四轮一循环这些原版没有,我们也不加。
///
/// 有一处**故意跟原版不一样**:原版只存「还剩多少秒」,不存到点的时刻,
/// 所以退出应用期间倒计时是冻住的 —— 关机一小时回来还剩 24 分 59 秒。
/// 这里存的是**到点的绝对时刻**,关了再开就是真的少了那么多。
@MainActor
final class FocusTimer: ObservableObject {
    static let shared = FocusTimer()

    enum Phase: String, Codable {
        case focus
        case rest

        var title: String { self == .focus ? "专注" : "休息" }
        var symbol: String { self == .focus ? "brain.head.profile" : "cup.and.saucer.fill" }
    }

    static let focusLength: TimeInterval = 25 * 60
    static let restLength: TimeInterval = 5 * 60

    @Published private(set) var phase: Phase = .focus
    @Published private(set) var running = false
    @Published private(set) var remaining: TimeInterval = FocusTimer.focusLength
    /// 今天完成了几轮专注。跨天自动归零。
    @Published private(set) var roundsToday = 0

    private var ticker: Timer?
    private var roundsDate = ""
    private let store = UserDefaults.standard
    private let key = "notch.focus"

    private init() {
        restore()
    }

    var phaseLength: TimeInterval {
        phase == .focus ? Self.focusLength : Self.restLength
    }

    /// 走完了多少。进度条和环都用它。
    var progress: Double {
        max(0, min(1, 1 - remaining / phaseLength))
    }

    /// `25:00`。分钟不补零,原版也不补。
    var clock: String {
        let total = Int(max(0, remaining.rounded()))

        return String(format: "%d:%02d", total / 60, total % 60)
    }

    /// 静默条上只放得下这么点:`25:00` 或者停着的时候什么都不放。
    var stripLabel: String? { running ? clock : nil }

    // MARK: - 操作

    func toggle() {
        running ? pause() : start()
    }

    func start() {
        guard !running else { return }

        running = true
        schedule()
        persist()
    }

    func pause() {
        guard running else { return }

        running = false
        ticker?.invalidate()
        ticker = nil
        persist()
    }

    /// 重来:回到这一档的开头,并且停住。
    func reset() {
        running = false
        ticker?.invalidate()
        ticker = nil
        remaining = phaseLength
        persist()
    }

    /// 跳过这一档,直接换到另一档 —— 不算完成,不加轮数。
    func skip() {
        flip(counting: false)
    }

    // MARK: - 走表

    private func schedule() {
        ticker?.invalidate()

        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }

        // 面板在做动画时 runloop 会切到 tracking 模式,不加这一句秒表会卡住。
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func tick() {
        guard running else { return }

        remaining -= 1

        if remaining <= 0 {
            flip(counting: true)
            return
        }

        // 每 15 秒落一次盘,照原版。每秒写一次没必要。
        if Int(remaining) % 15 == 0 {
            persist()
        }
    }

    /// 换档。`counting` 为真表示这一档是走完的,专注走完才记一轮。
    private func flip(counting: Bool) {
        if counting, phase == .focus {
            rolloverDay()
            roundsToday += 1
        }

        phase = phase == .focus ? .rest : .focus
        remaining = phaseLength

        // 专注完了自动进休息;休息完了停下等人。
        running = counting && phase == .rest

        if running {
            schedule()
        } else {
            ticker?.invalidate()
            ticker = nil
        }

        persist()

        guard counting else { return }

        NSSound(named: "Glass")?.play()
        AppState.shared.announceFocus()
    }

    // MARK: - 落盘

    private func rolloverDay() {
        let today = Self.dayKey(Date())

        if roundsDate != today {
            roundsDate = today
            roundsToday = 0
        }
    }

    private static func dayKey(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)

        return "\(parts.year ?? 0)-\(parts.month ?? 0)-\(parts.day ?? 0)"
    }

    private func persist() {
        var payload: [String: Any] = [
            "phase": phase.rawValue,
            "running": running,
            "remaining": remaining,
            "roundsToday": roundsToday,
            "roundsDate": roundsDate
        ]

        // 跑着的时候只认「到点的时刻」,重开算差值。
        if running {
            payload["endsAt"] = Date().addingTimeInterval(remaining).timeIntervalSince1970
        }

        store.set(payload, forKey: key)
    }

    private func restore() {
        roundsDate = Self.dayKey(Date())

        guard let payload = store.dictionary(forKey: key) else { return }

        phase = (payload["phase"] as? String).flatMap(Phase.init) ?? .focus

        if let saved = payload["roundsDate"] as? String, saved == roundsDate {
            roundsToday = payload["roundsToday"] as? Int ?? 0
        }

        let wasRunning = payload["running"] as? Bool ?? false

        if wasRunning, let endsAt = payload["endsAt"] as? TimeInterval {
            let left = endsAt - Date().timeIntervalSince1970

            // 关着的时候走完了:不补记轮数(说不准是几天前的事),回到起点等人。
            guard left > 0 else {
                remaining = phaseLength
                return
            }

            remaining = min(left, phaseLength)
            running = true
            schedule()
            return
        }

        remaining = min(payload["remaining"] as? TimeInterval ?? phaseLength, phaseLength)
    }
}
