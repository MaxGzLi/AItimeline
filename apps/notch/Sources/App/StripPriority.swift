import Foundation

/// 静默条上该显示哪个面。
///
/// 用户问过:原版是不是靠一排小按钮切功能?是 —— 但那是**面板**上的切法。
/// 静默条只有两翼各 44 点,四个面挤上去谁都看不清。原版的办法是给每个扩展一个
/// 「优先级」,跑着的那个占条,不跑就让位(番茄钟在跑时优先级 1,停了是 0)。
/// 这里照抄这个思路。
///
/// 规矩是**「正在动的压过站着不动的」**,顺序:
///
/// 1. 番茄钟在跑 —— 一秒一跳,不看就白跑了;
/// 2. 一刻钟内有日程 —— 不看要迟到;
/// 3. 收集架上有东西在路上 —— 刚扔进去的,得让人看见它落没落地;
/// 4. 都没有,才是知识卡的数 —— 它是一堆**攒着的**,明天看也一样。
///
/// 知识卡排最后是有意的:静默条不是「文章栏」,是「现在有什么在动」。
/// 翻卡片是放大以后的事,静默条上一张卡都不许自己换。
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

        if ShelfStore.shared.inFlight > 0 { return .shelf }

        return .cards
    }
}
