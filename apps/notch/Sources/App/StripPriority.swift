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
/// 6. 有卡到复习期了 —— 这是知识卡唯一能占条的情形;
/// 7. 以上一件都没有 —— 显示时间。
///
/// **「Claude 在干活」压根不在这张表里。** 它在跑是它的事,不是你的事;
/// 一天四百多个会话都来占条,这一条就成了骚扰。
///
/// **「攒了几张卡」也不在这张表里。** 之前这一条兜底,结果是条上常年挂着一个
/// 谁也说不清含义的数,亮着还是灭着都不影响你今天干什么 —— 那就不是信息,是装饰。
/// 现在只有「该复习了」这种有时效的事才配占条,攒着的那堆等你自己点开看。
///
/// 第 7 条的时间是**兜底,不是一个面**:它没有内页,悬停展开时按 `face` 退回知识卡。
/// 屏幕右上角的菜单栏本来就有一个钟,这里再写一遍是重复的 —— 但一条空着的黑边
/// 更让人以为它坏了,两害相权取一个不会误导的。
@MainActor
enum StripPriority {
    /// 一刻钟以内的日程才值得占条。再早就是干扰,人还没打算动身。
    static let agendaWindow: TimeInterval = 15 * 60

    /// 此刻站在静默条上的是谁。
    enum Subject: Equatable {
        case face(NotchFace)
        /// 没有任何一件事需要你 —— 报个时间。
        case clock
    }

    static var subject: Subject {
        let agenda = AgendaStore.shared

        if let next = agenda.nextEvent, next.start > agenda.now,
           next.start.timeIntervalSince(agenda.now) <= agendaWindow {
            return .face(.agenda)
        }

        let agents = AgentStore.shared

        if agents.needsYou > 0 { return .face(.agents) }

        if FocusTimer.shared.running { return .face(.focus) }

        if agents.unseen > 0 { return .face(.agents) }

        if ShelfStore.shared.inFlight > 0 { return .face(.shelf) }

        if CardStore.shared.dueCount > 0 { return .face(.cards) }

        return .clock
    }

    /// 悬停或点开时该翻到哪一面。条上站着时钟的时候退回知识卡 ——
    /// 时钟没有内页,而知识卡是这个应用的主页。
    static var face: NotchFace {
        guard case .face(let face) = subject else { return .cards }

        return face
    }
}
