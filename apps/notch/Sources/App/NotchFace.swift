import SwiftUI

/// 刘海上的「面」。一个面回答一件事,面与面之间靠肩上那排图标切。
///
/// 照原版的做法(`FullExpandedView.swift` 的 `FullExpandedTopBarView`):切换器是
/// 全展开档左肩上一排图标标签。这样番茄钟、日程、收集就不用和知识卡抢静默条右边
/// 那 34 点宽 —— 静默条只显示**当下最该看的那个面**,谁最该看由优先级定。
enum NotchFace: String, CaseIterable, Identifiable {
    /// 知识回流:该复习的卡。
    case cards
    /// 收集:拖进来的链接、文字、截图。
    case shelf
    /// 专注:番茄钟。
    case focus
    /// 日程:今天的安排和时间。
    case agenda

    var id: String { rawValue }

    /// 已经做出来的面。**做一个开一个** —— 点开是空的标签比没有标签更糟。
    static let available: [NotchFace] = allCases

    var symbol: String {
        switch self {
        case .cards: return "book.closed"
        case .shelf: return "tray"
        case .focus: return "timer"
        case .agenda: return "calendar"
        }
    }

    var title: String {
        switch self {
        case .cards: return "知识"
        case .shelf: return "收集"
        case .focus: return "专注"
        case .agenda: return "日程"
        }
    }
}
