import Foundation

/// 静默条上该显示哪个面。
///
/// 用户问过:原版是不是靠一排小按钮切功能?是 —— 但那是**面板**上的切法。
/// 静默条只有两翼各 44 点,四个面挤上去谁都看不清。原版的办法是给每个扩展一个
/// 「优先级」,跑着的那个占条,不跑就让位(番茄钟在跑时优先级 1,停了是 0)。
/// 这里照抄这个思路,把顺序钉死成一句话:
///
/// **番茄钟在跑 > 一刻钟内有日程 > 有卡等着复习。**
///
/// 理由是「过期作废的排前面」:番茄钟错过一秒就白跑了,日程错过就迟到了,
/// 知识卡明天看也一样。
@MainActor
enum StripPriority {
    /// 一刻钟以内的日程才值得占条。再早就是干扰,人还没打算动身。
    static let agendaWindow: TimeInterval = 15 * 60

    static var face: NotchFace {
        if FocusTimer.shared.running { return .focus }

        let agenda = AgendaStore.shared

        if let next = agenda.nextEvent, next.start > agenda.now,
           next.start.timeIntervalSince(agenda.now) <= agendaWindow {
            return .agenda
        }

        return .cards
    }
}
