import AppKit
import SwiftUI

/// 刘海界面的排版语法:明度、材质、唯一的一个彩色。
///
/// 这几张表是从 SuperIsland 源码里量出来的,不是随手取的值。它的纪律是三条:
/// 字号只有七档、全篇只有白色加透明度台阶、唯一的彩色只绑一件事。
/// 新界面只许从这里挑;挑不到就说明那个东西不该出现在刘海上。
enum NotchInk {
    /// 面板大标题
    static let title = Color.white.opacity(0.95)
    /// 悬停档那一句结论
    static let body = Color.white.opacity(0.92)
    static let takeaway = Color.white.opacity(0.86)
    static let review = Color.white.opacity(0.82)
    /// 概念名
    static let read = Color.white.opacity(0.76)
    /// 正文段
    static let prose = Color.white.opacity(0.68)
    static let source = Color.white.opacity(0.58)
    /// 来源名、底栏动作
    static let meta = Color.white.opacity(0.55)
    /// 小节标题 —— 比它底下的正文更淡,视线先落在正文上,标题只当路牌
    static let sectionTag = Color.white.opacity(0.52)
    static let weak = Color.white.opacity(0.42)
    /// 侧栏区块标签
    static let label = Color.white.opacity(0.36)
    static let faint = Color.white.opacity(0.30)
    static let ghost = Color.white.opacity(0.26)
}

enum NotchSurface {
    /// 卡片壳常态
    static let fill = Color.white.opacity(0.045)
    /// 卡片壳重点态
    static let fillHi = Color.white.opacity(0.06)
    static let stroke = Color.white.opacity(0.07)
    static let strokeHi = Color.white.opacity(0.10)
    /// 一切分隔线
    static let hairline = Color.white.opacity(0.08)
    static let tile = Color.white.opacity(0.07)
    static let tileEdge = Color.white.opacity(0.09)
}

/// 全篇唯一的彩色,只绑「该复习」。多一个颜色,界面就开始有模板味。
enum NotchAccent {
    static let amber = Color(red: 1.0, green: 0.72, blue: 0.20)
}

extension View {
    /// 鼠标移上去变成手型。可点的东西都要挂,不可点的一个都不许挂。
    func hoverPointer() -> some View {
        onHover { inside in
            if inside {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }
}
