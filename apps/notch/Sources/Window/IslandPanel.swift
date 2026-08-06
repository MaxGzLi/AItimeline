import AppKit
import SwiftUI

/// 承载 SwiftUI 的视图,唯一的作用是**让第一下点击就算数**。
///
/// 默认情况下,窗口不是当前焦点时的第一次点击会被系统吃掉,只用来切焦点,不传给视图。
/// 刘海面板永远不是焦点(它是个不抢焦点的面板),所以不重写这个方法的话,
/// 用户每次都要点两下才有反应 —— 实测过,第一下确实丢了。
final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    @MainActor required init(rootView: Content) {
        super.init(rootView: rootView)
    }

    @MainActor required dynamic init?(coder: NSCoder) {
        super.init(coder: coder)
    }
}

/// 刘海那个窗口。
///
/// 要点全在这些开关上:
/// - `.borderless` 没有标题栏和边框;`.nonactivatingPanel` 点它不会把当前应用踢到后台。
/// - `level = .statusBar` 才盖得住菜单栏(刘海就在菜单栏那一行)。
/// - `canJoinAllSpaces` + `stationary`:切桌面、进全屏应用,它都跟着在。
/// - 背景透明 + 不画阴影:黑色面板是 SwiftUI 自己画的,窗口只是个透明的画布,
///   面板之外的透明部分不接鼠标事件,底下的东西照样点得到。
final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    init(initialSize: CGSize) {
        super.init(
            contentRect: NSRect(origin: .zero, size: initialSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        isMovableByWindowBackground = false
        animationBehavior = .none
        becomesKeyOnlyIfNeeded = false
        // 允许被截图。SuperIsland 默认关掉了这个,导致它自己的窗口截不下来,
        // 排版只能靠算不能靠看 —— 我们要能截图验收。
        sharingType = .readOnly
    }
}
