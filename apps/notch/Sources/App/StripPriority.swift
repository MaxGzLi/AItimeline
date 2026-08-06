import Foundation

/// 静默条上该显示哪个面。
///
/// 用户问过:原版是不是靠一排小按钮切功能?是 —— 但那是**面板**上的切法。
/// 静默条只有两翼各 44 点,五个面挤上去谁都看不清。原版的办法是给每个扩展一个
/// 「优先级」,跑着的那个占条,不跑就让位(番茄钟在跑时优先级 1,停了是 0)。
/// 这里照抄这个思路。
///
/// 规矩是**「要你动手的,压过正在动的;正在动的,压过站着不动的」**:
///
/// 1. 一刻钟内有日程 —— 排头一个。会议是**过时不候**的,别的都可以晚看一会儿。
///    (排在 AI 进程前面是有意的:一个没人应的权限请求会一直挂着,
///    要是让它压在上面,就正好把会议提醒压死了。)
/// 2. Claude Code 要你动手 —— 停下来要权限,或者这一轮挂了。它卡着不动了;
/// 3. 番茄钟在跑 —— 一秒一跳,不看就白跑了;
/// 4. Claude Code 干完了、你还没看见 —— 轮到你了,但不急,白色数字安静挂着;
/// 5. 收集架上有东西在路上 —— 刚扔进去的,得让人看见它落没落地;
/// 6. 都没有,才是知识卡的数 —— 它是一堆**攒着的**,明天看也一样。
///
/// **「Claude 在干活」压根不在这张表里。** 它在跑是它的事,不是你的事;
/// 一天四百多个会话都来占条,这一条就成了骚扰。
///
/// 知识卡排最后是有意的:静默条不是「文章栏」,是「现在有什么需要你」。
/// 翻卡片是放大以后的事,静默条上一张卡都不许自己换。
@MainActor
enum StripPriority {
    /// 一刻钟以内的日程才值得占条。再早就是干扰,人还没打算动身。
    static let agendaWindow: TimeInterval = 15 * 60

    static var face: NotchFace {
        let agenda = AgendaStore.shared

        if let next = agenda.nextEvent, next.start > agenda.now,
           next.start.timeIntervalSince(agenda.now) <= agendaWindow {
            return .agenda
        }

        let agents = AgentStore.shared

        if agents.needsYou > 0 { return .agents }

        if FocusTimer.shared.running { return .focus }

        if agents.unseen > 0 { return .agents }

        if ShelfStore.shared.inFlight > 0 { return .shelf }

        return .cards
    }
}
