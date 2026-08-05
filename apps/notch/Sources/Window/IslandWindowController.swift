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
    private var cancellables = Set<AnyCancellable>()

    init(appState: AppState) {
        self.appState = appState
    }

    func start() {
        guard let screen = ScreenDetector.preferredScreen else { return }

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
        guard let screen = currentScreen else { return }

        applyFrame(size: size, screen: screen)
    }

    private var currentScreen: NSScreen? {
        panel?.screen ?? ScreenDetector.preferredScreen
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
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let screen = ScreenDetector.preferredScreen else { return }

                self.appState.updateScreen(screen)
                self.applyFrame(size: self.appState.windowSize, screen: screen)
            }
        }
    }
}
