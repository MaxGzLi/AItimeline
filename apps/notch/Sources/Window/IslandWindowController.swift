import AppKit
import Combine
import SwiftUI

/// 把窗口摆在刘海底下,并且跟着状态改尺寸。
///
/// 尺寸这件事有个顺序要求:**变大要先改窗口再放动画,变小要先放动画再改窗口**。
/// 反过来的话,动画画到一半就被窗口边缘裁掉了。所以变大在状态回调里立刻做,
/// 变小等动画放完(0.55 秒)再做。
@MainActor
final class IslandWindowController {
    private let appState: AppState
    private var panel: IslandPanel?
    private var shrinkWork: DispatchWorkItem?
    private var screenObserver: NSObjectProtocol?
    private var wakeObserver: NSObjectProtocol?
    private var cancellables = Set<AnyCancellable>()

    init(appState: AppState) {
        self.appState = appState
    }

    func start() {
        ScreenDetector.dropStaleDisplayPreference()

        guard let screen = targetScreen else { return }

        appState.updateScreen(screen)

        let panel = IslandPanel(initialSize: appState.windowSize)
        panel.contentView = FirstClickHostingView(
            rootView: AnyView(IslandContainerView().environmentObject(appState))
        )
        self.panel = panel

        applyFrame(size: appState.windowSize, screen: screen)
        panel.orderFrontRegardless()

        appState.didChangeState = { [weak self] old, new in
            self?.handleStateChange(from: old, to: new)
        }

        appState.startHoverAudit()
        observeScreenChanges()
    }

    // MARK: - 摆位

    /// 窗口的锚点是刘海的中线和顶边:面板从刘海底下长出来,左右对称。
    /// 没有刘海的屏上锚在屏幕顶边中线,那颗药丸从菜单栏正中挂下来。
    ///
    /// 纵向一律用 `screen.frame.maxY`(物理顶边)而**不是** `visibleFrame` ——
    /// 窗口层级在菜单栏之上,菜单栏自动隐藏、变高变矮都不用管,位置恒定。
    private func applyFrame(size: CGSize, screen: NSScreen) {
        guard let panel else { return }

        let notch = ScreenDetector.notchRect(screen: screen)
        let anchorX = notch?.midX ?? screen.frame.midX
        let anchorY = notch?.maxY ?? screen.frame.maxY

        panel.setFrame(
            NSRect(x: anchorX - size.width / 2, y: anchorY - size.height, width: size.width, height: size.height),
            display: true
        )
    }

    private func applyFrame(size: CGSize) {
        guard let screen = targetScreen else { return }

        applyFrame(size: size, screen: screen)
    }

    /// 该画在哪块屏。**不用 `panel.screen`** —— 那是「窗口现在在哪」,
    /// 用户改了选择或者屏幕拔插之后它还是旧的,面板会赖在原地不走。
    private var targetScreen: NSScreen? {
        ScreenDetector.preferredScreen
    }

    /// 换屏:屏幕的几何、有没有刘海、静默条多大都要跟着换,所以先更新状态再摆位。
    func relocate() {
        ScreenDetector.dropStaleDisplayPreference()

        guard let screen = targetScreen else { return }

        appState.updateScreen(screen)
        applyFrame(size: appState.windowSize, screen: screen)
        refreshTrackingAreas()
        panel?.orderFrontRegardless()
    }

    // MARK: - 状态变化

    private func handleStateChange(from old: IslandState, to new: IslandState) {
        shrinkWork?.cancel()
        shrinkWork = nil

        let oldSize = appState.windowSize(for: old)
        let newSize = appState.windowSize(for: new)

        if newSize.width > oldSize.width || newSize.height > oldSize.height {
            // 变大:先把窗口开到目标尺寸,动画才有地方放,不然画到一半被边缘裁掉。
            // 只开到目标那一档、不是一律开到最大 —— 悬停出的小条只有 408 宽,
            // 却支起一个 1004 宽的透明窗口,等于在屏幕顶上铺了一大片看不见的东西。
            applyFrame(size: appState.windowSize(for: new))
            refreshTrackingAreas()
            return
        }

        // 变小:等动画放完再收窗口。收早了动画会被裁。
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.appState.currentState == new else { return }
            self.applyFrame(size: self.appState.windowSize)
            self.refreshTrackingAreas()
        }

        shrinkWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Constants.shrinkDelay, execute: work)
    }

    /// 窗口尺寸一变,鼠标跟踪区还停在旧尺寸上,不刷新的话悬停会失灵。
    private func refreshTrackingAreas() {
        panel?.contentView?.subviews.forEach { $0.updateTrackingAreas() }
    }

    // MARK: - 屏幕拔插

    private func observeScreenChanges() {
        // 插拔、合盖、改分辨率、改显示器排列都走这一条。合盖没有专门的通知 ——
        // 合盖会让内建屏从 NSScreen.screens 里消失,发的就是这条。
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.relocate() }
        }

        // 睡醒之后屏幕几何有时要过一会儿才稳,立刻算会摆错位置,所以缓一下再来一次。
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                MainActor.assumeIsolated { self?.relocate() }
            }
        }
    }
}
