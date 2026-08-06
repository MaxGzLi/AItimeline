import EventKit
import Foundation
import SwiftUI

/// 系统日历里的一件事,摘成我们要显示的那几样。
///
/// 不直接拿 `EKEvent` 往界面上传:那是个会变的对象,拿到主线程之外就不安全。
struct AgendaEvent: Identifiable, Equatable {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let allDay: Bool
    let location: String?
    /// 日历自己的颜色。原版就是直接用它,不做调色板映射。
    let tint: Color

    var timeLabel: String {
        guard !allDay else { return "全天" }

        return "\(AgendaStore.hhmm(start))–\(AgendaStore.hhmm(end))"
    }

    /// 还有多久开始。已经开始了就说「进行中」。
    func countdown(from now: Date) -> String {
        if start <= now { return end > now ? "进行中" : "已过" }

        let minutes = Int((start.timeIntervalSince(now) / 60).rounded(.up))

        if minutes < 60 { return "\(minutes) 分钟后" }

        return "\(minutes / 60) 小时 \(minutes % 60) 分后"
    }
}

/// 读系统日历。**只读事件,不读提醒事项**,照原版。
///
/// 权限是拦路虎:没给权限就老老实实说没给,不装作日历是空的 ——
/// 「今天没安排」和「我没权限看」是两件完全不同的事。
@MainActor
final class AgendaStore: ObservableObject {
    static let shared = AgendaStore()

    enum Access {
        case unknown
        case granted
        case denied
    }

    @Published private(set) var access: Access = .unknown
    /// 选中那天的事。默认是今天。
    @Published private(set) var dayEvents: [AgendaEvent] = []
    /// 明天起往后 7 天。
    @Published private(set) var upcoming: [AgendaEvent] = []
    /// 这个月哪几天有事,用来在月历格子上点点。
    @Published private(set) var busyDays: Set<Date> = []
    @Published private(set) var selectedDay = Calendar.current.startOfDay(for: Date())
    @Published private(set) var visibleMonth = Calendar.current.startOfDay(for: Date())
    /// 秒针不走,分针走。刘海上没人盯着秒。
    @Published private(set) var now = Date()

    /// 往后看几天。原版默认 7,可调 1…30;我们不做设置面板,就钉死 7。
    private let lookaheadDays = 7

    private let store = EKEventStore()
    private var clock: Timer?

    private init() {
        startClock()

        NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: store,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    // MARK: - 权限

    func requestAccess() async {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized:
            access = .granted
            reload()
            return
        case .denied, .restricted:
            access = .denied
            return
        default:
            break
        }

        let granted = (try? await store.requestFullAccessToEvents()) ?? false

        access = granted ? .granted : .denied

        if granted { reload() }
    }

    /// 系统设置里改了权限之后要能自己回来 —— 面板每次露脸都重新问一遍状态。
    func refreshAccess() {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized:
            if access != .granted {
                access = .granted
            }

            reload()
        case .denied, .restricted:
            access = .denied
        default:
            access = .unknown
        }
    }

    // MARK: - 选日子

    func select(day: Date) {
        selectedDay = Calendar.current.startOfDay(for: day)
        reload()
    }

    func stepMonth(_ delta: Int) {
        guard let moved = Calendar.current.date(byAdding: .month, value: delta, to: visibleMonth) else { return }

        visibleMonth = moved
        reload()
    }

    func backToToday() {
        let today = Calendar.current.startOfDay(for: Date())

        selectedDay = today
        visibleMonth = today
        reload()
    }

    // MARK: - 取数

    private func reload() {
        guard access == .granted else { return }

        let calendar = Calendar.current
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: selectedDay) ?? selectedDay

        dayEvents = fetch(from: selectedDay, to: dayEnd)

        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date())) ?? Date()
        let horizon = calendar.date(byAdding: .day, value: lookaheadDays, to: tomorrow) ?? tomorrow

        upcoming = fetch(from: tomorrow, to: horizon)

        // 月历上多抓半个月,免得翻月的时候前后几天的点是空的。
        let gridStart = calendar.date(byAdding: .day, value: -14, to: monthStart) ?? monthStart
        let gridEnd = calendar.date(byAdding: .day, value: 63, to: gridStart) ?? gridStart

        busyDays = Set(fetch(from: gridStart, to: gridEnd).map { calendar.startOfDay(for: $0.start) })
    }

    private func fetch(from: Date, to: Date) -> [AgendaEvent] {
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)

        return store.events(matching: predicate)
            .filter { !$0.isAllDay || Calendar.current.isDate($0.startDate, inSameDayAs: from) || from < $0.startDate }
            .map { event in
                AgendaEvent(
                    id: event.eventIdentifier ?? UUID().uuidString,
                    title: event.title ?? "(没写标题)",
                    start: event.startDate,
                    end: event.endDate,
                    allDay: event.isAllDay,
                    location: event.location?.isEmpty == false ? event.location : nil,
                    tint: event.calendar.map { Color(cgColor: $0.cgColor) } ?? .white
                )
            }
            .sorted { $0.start < $1.start }
    }

    // MARK: - 月历格子

    var monthStart: Date {
        let parts = Calendar.current.dateComponents([.year, .month], from: visibleMonth)

        return Calendar.current.date(from: parts) ?? visibleMonth
    }

    /// 一屏月历的格子。开头补空是为了让 1 号落在正确的星期几那一列。
    var monthGrid: [Date?] {
        let calendar = Calendar.current
        let start = monthStart

        guard let count = calendar.range(of: .day, in: .month, for: start)?.count else { return [] }

        // `weekday` 是 1…7,`firstWeekday` 中国是周一(2)、美国是周日(1),两边都得对。
        let lead = (calendar.component(.weekday, from: start) - calendar.firstWeekday + 7) % 7
        var cells: [Date?] = Array(repeating: nil, count: lead)

        for offset in 0..<count {
            cells.append(calendar.date(byAdding: .day, value: offset, to: start))
        }

        while cells.count % 7 != 0 {
            cells.append(nil)
        }

        return cells
    }

    /// 星期几那一行的字头,按系统的一周起始日转好。
    var weekdaySymbols: [String] {
        let calendar = Calendar.current
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let shift = calendar.firstWeekday - 1

        return Array(symbols[shift...] + symbols[..<shift])
    }

    /// 眼下正在进行或者最近要开始的那一件。静默条和悬停条都看它。
    var nextEvent: AgendaEvent? {
        let today = Calendar.current.startOfDay(for: Date())

        guard Calendar.current.isDate(selectedDay, inSameDayAs: today) else { return nil }

        return dayEvents.first { $0.end > now }
    }

    // MARK: - 表和格式

    private func startClock() {
        // 20 秒对一次,分钟跳变最多晚 20 秒 —— 刘海上够用,不值得每秒唤醒一次。
        let timer = Timer(timeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date() }
        }

        RunLoop.main.add(timer, forMode: .common)
        clock = timer
    }

    /// 时间和日期一律走**系统当前语言**,不写死格式。
    /// 原版把 `h:mm a` 写死,在设了 24 小时制的机器上是错的;
    /// 模板里的 `j` 会自己选 12 还是 24。
    ///
    /// 语言是靠 `Info.plist` 的 `CFBundleLocalizations` 声明成中文的 ——
    /// 不声明的话 `Locale.current` 会退回英文,星期就成了 "Thursday"。
    nonisolated static func hhmm(_ date: Date) -> String {
        label(date, "jmm")
    }

    nonisolated static func label(_ date: Date, _ template: String) -> String {
        let formatter = DateFormatter()

        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate(template)

        return formatter.string(from: date)
    }
}
